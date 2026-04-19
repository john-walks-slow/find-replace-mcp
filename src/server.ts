import { randomUUID } from 'node:crypto';

import { promises as fs } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildConfig } from './config.js';
import { readTextFileStrict, encodeTextFile } from './encoding.js';
import { writeFileAtomically } from './file-io.js';
import {
  buildFileSummaries,
  buildPrepareNextStep,
  buildSearchSummary,
  buildSessionNextStep,
  buildSessionSummary,
  fail,
  formatApplyText,
  formatFindText,
  formatInspectSessionText,
  formatPrepareText,
  ok,
  serializeMatch,
  serializeSearchResult
} from './output.js';
import { ensureFilesUnchanged, executeSearch } from './search.js';
import { groupByFile, selectMatches, SessionStore } from './sessions.js';
import {
  ENCODING_HINT,
  SESSION_TTL_MS,
  SUPPORTED_ENCODINGS,
  type PreparedSession,
  type SelectionMode,
  type SupportedEncoding
} from './types.js';
import { fileUriToPath } from './utils.js';

const sessionStore = new SessionStore();

const commonFindSchema = {
  query: z.string().min(1),
  basePath: z.string().optional(),
  filePath: z.string().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  regex: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  useGitIgnore: z.boolean().optional(),
  maxPreviewMatches: z.number().int().positive().max(5000).optional(),
  encoding: z.enum(SUPPORTED_ENCODINGS).optional()
};

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'smart-find-replace-mcp', version: '0.7.2' },
    {
      instructions: [
        'This server provides simple but strong IDE-grade find and staged replace across files.',
        'Replace is always two-step: prepare_replace_in_files first, then apply_replace_in_files with the returned sessionId.',
        'Literal and regex modes both use one text-semantic pipeline end-to-end for find, preview, and apply.',
        `Text decoding keeps the original encoding for supported files and writes back in that same encoding. ${ENCODING_HINT}`,
        'Ripgrep is used only for file discovery and ignore rules, not as the find/replace truth source.',
        'Never attempt replacement without a valid preview session.',
        'If prepare_replace_in_files says previewComplete is false or applyAllowed is false, you must refine the query or scope first.'
      ].join(' ')
    }
  );

  const resolveDefaultBasePath = async (): Promise<string> => {
    try {
      const rootsResult = await server.server.listRoots();
      const firstRoot = rootsResult.roots[0]?.uri;
      if (firstRoot?.startsWith('file://')) {
        return fileUriToPath(firstRoot);
      }
    } catch {
      // fall back to cwd
    }
    return process.cwd();
  };

  server.registerTool(
    'find_in_files',
    {
      title: 'Find In Files',
      description:
        'Search from the current directory by default, or a specific basePath/filePath. Supports include, exclude, regex, whole-word, and case-sensitive search.',
      inputSchema: commonFindSchema,
      annotations: { title: 'Find In Files', readOnlyHint: true, idempotentHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const config = await buildConfig(args, resolveDefaultBasePath);
        const result = await executeSearch(config, args.query, '');
        return ok(formatFindText(result), {
          kind: 'find_result',
          status: result.totalMatches > 0 ? 'matches_found' : 'no_matches',
          ...serializeSearchResult(result)
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'prepare_replace_in_files',
    {
      title: 'Prepare Replace In Files',
      description: 'Preview every replace candidate first. Replacement is blocked unless the preview is complete.',
      inputSchema: { ...commonFindSchema, replacement: z.string() },
      annotations: { title: 'Prepare Replace In Files', readOnlyHint: true, idempotentHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const config = await buildConfig(args, resolveDefaultBasePath);
        const result = await executeSearch(config, args.query, args.replacement);
        const status = result.previewComplete && result.replacementPreviewReady ? 'ready' : 'requires_refinement';
        const applyAllowed = status === 'ready';

        let sessionId: string | null = null;
        let expiresAt: string | null = null;

        if (applyAllowed) {
          sessionId = randomUUID();
          expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
          const session: PreparedSession = {
            sessionId,
            createdAt: new Date().toISOString(),
            expiresAt,
            basePath: result.resolvedBasePath,
            filePath: result.filePath,
            query: result.query,
            replacement: result.replacement,
            regex: result.regex,
            wholeWord: result.wholeWord,
            caseSensitive: result.caseSensitive,
            include: result.include,
            exclude: result.exclude,
            engine: result.mode,
            previewComplete: result.previewComplete,
            applyAllowed,
            matches: result.matches,
            fileFingerprints: result.fileFingerprints
          };
          sessionStore.store(session);
        }

        return ok(formatPrepareText(result, status, sessionId, expiresAt), {
          kind: 'replace_preview',
          status,
          summary: buildSearchSummary(result, { status, applyAllowed }),
          session: sessionId && expiresAt ? { sessionId, expiresAt } : null,
          files: buildFileSummaries(result.matches),
          matches: result.matches.map((match) => serializeMatch(match, true)),
          nextStep: buildPrepareNextStep(status, sessionId)
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'inspect_replace_session',
    {
      title: 'Inspect Replace Session',
      description: 'Return the prepared replace session and all of its matches.',
      inputSchema: { sessionId: z.string().min(1) },
      annotations: { title: 'Inspect Replace Session', readOnlyHint: true, idempotentHint: true, destructiveHint: false }
    },
    async ({ sessionId }) => {
      try {
        const session = sessionStore.getOrThrow(sessionId);
        return ok(formatInspectSessionText(session), {
          kind: 'replace_session',
          status: session.applyAllowed ? 'ready' : 'blocked',
          summary: buildSessionSummary(session),
          session: { sessionId: session.sessionId, createdAt: session.createdAt, expiresAt: session.expiresAt },
          files: buildFileSummaries(session.matches),
          matches: session.matches.map((match) => serializeMatch(match, true)),
          nextStep: buildSessionNextStep(session)
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'apply_replace_in_files',
    {
      title: 'Apply Replace In Files',
      description: 'Apply a previously prepared replace session. This tool only accepts a sessionId from prepare_replace_in_files and refuses direct replace.',
      inputSchema: {
        sessionId: z.string().min(1),
        selectionMode: z.enum(['all', 'include_ids', 'exclude_ids']).optional(),
        matchIds: z.array(z.string()).optional(),
        createBackup: z.boolean().optional()
      },
      annotations: { title: 'Apply Replace In Files', readOnlyHint: false, idempotentHint: false, destructiveHint: true }
    },
    async ({ sessionId, selectionMode = 'all', matchIds = [], createBackup = false }) => {
      try {
        const session = sessionStore.getOrThrow(sessionId);
        if (!session.previewComplete || !session.applyAllowed) {
          throw new Error('This replace session is not applyable. Prepare a complete and valid preview first.');
        }

        const selectedMatches = selectMatches(session, selectionMode as SelectionMode, matchIds);
        if (selectedMatches.length === 0) {
          throw new Error('No matches were selected for replacement.');
        }

        await ensureFilesUnchanged(session);

        const changedFiles: Array<{ filePath: string; replacementsApplied: number; backupPath: string | null }> = [];
        for (const fileMatches of Object.values(groupByFile(selectedMatches))) {
          const targetPath = fileMatches[0]!.absolutePath;
          const fingerprint = session.fileFingerprints[fileMatches[0]!.filePath];
          const originalFile = await readTextFileStrict(targetPath, fileMatches[0]!.filePath, fingerprint?.encoding, true);
          const original = originalFile.content;
          let next = original;
          const ordered = [...fileMatches].sort((a, b) => b.startOffset - a.startOffset);
          for (const match of ordered) {
            next = next.slice(0, match.startOffset) + match.replacementPreview + next.slice(match.endOffset);
          }

          let backupPath: string | null = null;
          if (next !== original) {
            if (createBackup) {
              backupPath = `${targetPath}.bak.${Date.now()}`;
              await writeFileAtomically(backupPath, originalFile.raw);
            }
            const output = encodeTextFile(next, {
              encoding: originalFile.encoding,
              bomKind: originalFile.bomKind,
              bomBytes: originalFile.bomBytes
            });
            await writeFileAtomically(targetPath, output);
            changedFiles.push({ filePath: fileMatches[0]!.filePath, replacementsApplied: fileMatches.length, backupPath });
          }
        }

        sessionStore.delete(sessionId);
        const replacementsApplied = changedFiles.reduce((sum, item) => sum + item.replacementsApplied, 0);
        return ok(formatApplyText(sessionId, changedFiles, replacementsApplied, createBackup), {
          kind: 'replace_apply_result',
          status: 'applied',
          summary: { sessionId, filesChanged: changedFiles.length, replacementsApplied, createBackup },
          files: changedFiles,
          nextStep: { action: 'done', reason: 'Replace has already been applied. Re-run find_in_files to verify final state if needed.' }
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  return server;
}
