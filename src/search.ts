import { createHash } from 'node:crypto';

import { readTextFileStrict, tryReadTextFile } from './encoding.js';
import { discoverCandidateFiles } from './discovery.js';
import { createMatcher } from './matching.js';
import { computeLineStarts, offsetToLineAndColumn } from './text-ops.js';
import type { FileFingerprint, SearchConfig, SearchExecution } from './types.js';

export async function executeSearch(config: SearchConfig, query: string, replacement: string): Promise<SearchExecution> {
  const matcher = createMatcher(config, query);
  const candidates = await discoverCandidateFiles(config);
  const matches = [] as SearchExecution['matches'];
  const fileFingerprints: Record<string, FileFingerprint> = {};

  let searchedFiles = 0;
  let skippedFiles = 0;
  let filesWithMatches = 0;
  let totalMatches = 0;

  for (const candidate of candidates) {
    searchedFiles += 1;
    const fileData = await tryReadTextFile(candidate.absolutePath, candidate.filePath, config.requestedEncoding, Boolean(config.filePath));
    if (!fileData) {
      skippedFiles += 1;
      continue;
    }

    const regex = matcher.createGlobalRegex();
    const lineStarts = computeLineStarts(fileData.content);
    let fileMatched = false;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(fileData.content)) !== null) {
      const matchText = match[0] ?? '';
      const startOffset = match.index;
      const endOffset = startOffset + matchText.length;
      totalMatches += 1;
      fileMatched = true;

      if (matches.length < config.maxPreviewMatches) {
        const location = offsetToLineAndColumn(lineStarts, startOffset, endOffset);
        const replacementPreview = matcher.renderReplacement(match, fileData.content, replacement);
        const before = fileData.content.slice(Math.max(0, startOffset - 40), startOffset).replace(/\n/g, '⏎');
        const after = fileData.content.slice(endOffset, Math.min(fileData.content.length, endOffset + 80)).replace(/\n/g, '⏎');
        matches.push({
          id: createHash('sha256')
            .update(`${candidate.filePath}:${startOffset}:${endOffset}:${matchText}`)
            .digest('hex')
            .slice(0, 16),
          filePath: candidate.filePath,
          absolutePath: candidate.absolutePath,
          line: location.line,
          columnStart: location.columnStart,
          columnEnd: location.columnEnd,
          startOffset,
          endOffset,
          matchText,
          replacementPreview,
          before,
          after
        });
      }

      if (matchText === '') {
        regex.lastIndex += 1;
      }
    }

    if (fileMatched) {
      filesWithMatches += 1;
      fileFingerprints[candidate.filePath] = {
        filePath: candidate.filePath,
        absolutePath: candidate.absolutePath,
        sha256: fileData.sha256,
        size: fileData.size,
        mtimeMs: fileData.mtimeMs,
        encoding: fileData.encoding,
        encodingSource: fileData.encodingSource,
        bomKind: fileData.bomKind,
        bomBytes: fileData.bomBytes
      };
    }
  }

  const previewComplete = totalMatches <= config.maxPreviewMatches;
  const limitationCode = previewComplete ? 'apply_via_session_only' : 'preview_incomplete';
  const limitation =
    limitationCode === 'apply_via_session_only'
      ? 'Replace is allowed only through apply_replace_in_files with the returned sessionId.'
      : 'Replace is blocked because the preview is incomplete. Narrow the scope, file set, or query and prepare again.';

  return {
    resolvedBasePath: config.basePath,
    query,
    replacement,
    regex: config.regex,
    wholeWord: config.wholeWord,
    caseSensitive: config.caseSensitive,
    include: config.include,
    exclude: config.exclude,
    filePath: config.filePath,
    mode: matcher.mode,
    requestedEncoding: config.requestedEncoding ?? 'auto',
    resultEncoding: resolveResultEncoding(config, fileFingerprints),
    encodingSource: resolveEncodingSource(config, fileFingerprints),
    searchedFiles,
    skippedFiles,
    filesWithMatches,
    totalMatches,
    returnedMatches: matches.length,
    previewComplete,
    replacementPreviewReady: true,
    limitationCode,
    limitation,
    matches,
    fileFingerprints
  };
}

export async function ensureFilesUnchanged(session: { fileFingerprints: Record<string, FileFingerprint> }): Promise<void> {
  for (const [filePath, fingerprint] of Object.entries(session.fileFingerprints)) {
    const current = await readTextFileStrict(fingerprint.absolutePath, filePath, fingerprint.encoding, true);
    if (
      current.encoding !== fingerprint.encoding ||
      current.bomKind !== fingerprint.bomKind ||
      current.bomBytes !== fingerprint.bomBytes
    ) {
      throw new Error(`File encoding changed since preview for ${filePath}. Re-run prepare_replace_in_files before applying replacement.`);
    }
    if (current.sha256 !== fingerprint.sha256 || current.size !== fingerprint.size) {
      throw new Error(`File changed since preview for ${filePath}. Re-run prepare_replace_in_files before applying replacement.`);
    }
  }
}

function resolveResultEncoding(config: SearchConfig, fileFingerprints: Record<string, FileFingerprint>) {
  if (config.requestedEncoding) {
    return config.requestedEncoding;
  }
  const unique = new Set(Object.values(fileFingerprints).map((item) => item.encoding));
  return unique.size === 1 ? [...unique][0]! : 'auto';
}

function resolveEncodingSource(config: SearchConfig, fileFingerprints: Record<string, FileFingerprint>) {
  if (config.requestedEncoding) {
    return 'explicit';
  }
  const values = Object.values(fileFingerprints);
  if (values.length === 0) {
    return 'auto';
  }
  const unique = new Set(values.map((item) => item.encodingSource));
  return unique.size === 1 ? [...unique][0]! : 'mixed';
}
