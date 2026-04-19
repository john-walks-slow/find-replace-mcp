import type { MatchRecord, PreparedSession, SearchExecution } from './types.js';
import { groupByFile } from './utils.js';

export function serializeMatch(match: MatchRecord, includeReplacement: boolean): Record<string, unknown> {
  return {
    id: match.id,
    filePath: match.filePath,
    line: match.line,
    columnStart: match.columnStart,
    columnEnd: match.columnEnd,
    matchText: match.matchText,
    context: `${match.before}[${match.matchText}]${match.after}`,
    ...(includeReplacement ? { replacementPreview: match.replacementPreview } : {})
  };
}

export function buildFileSummaries(matches: MatchRecord[]): Array<Record<string, unknown>> {
  return Object.entries(groupByFile(matches))
    .map(([filePath, fileMatches]) => ({
      filePath,
      matchCount: fileMatches.length,
      lines: Array.from(new Set(fileMatches.map((match) => match.line))).sort((a, b) => a - b),
      firstMatchId: fileMatches[0]?.id ?? null
    }))
    .sort((a, b) => Number(b.matchCount) - Number(a.matchCount) || String(a.filePath).localeCompare(String(b.filePath)));
}

export function buildSearchSummary(
  result: SearchExecution,
  options: { status?: string; applyAllowed?: boolean } = {}
): Record<string, unknown> {
  return {
    query: result.query,
    replacement: result.replacement || null,
    mode: result.mode,
    encoding: result.resultEncoding,
    encodingSource: result.encodingSource,
    requestedEncoding: result.requestedEncoding,
    dialect: result.mode,
    scope: {
      basePath: result.resolvedBasePath,
      filePath: result.filePath ?? null,
      include: result.include,
      exclude: result.exclude
    },
    flags: {
      wholeWord: result.wholeWord,
      caseSensitive: result.caseSensitive
    },
    counts: {
      searchedFiles: result.searchedFiles,
      skippedFiles: result.skippedFiles,
      filesWithMatches: result.filesWithMatches,
      totalMatches: result.totalMatches,
      previewedMatches: result.returnedMatches
    },
    previewComplete: result.previewComplete,
    replacementPreviewReady: result.replacementPreviewReady,
    applyAllowed: options.applyAllowed ?? false,
    status: options.status ?? (result.totalMatches > 0 ? 'matches_found' : 'no_matches'),
    limitationCode: result.limitationCode,
    limitation: result.limitation
  };
}

export function buildSessionSummary(session: PreparedSession): Record<string, unknown> {
  const fingerprintList = Object.values(session.fileFingerprints);
  const uniqueEncodings = new Set(fingerprintList.map((item) => item.encoding));
  const uniqueSources = new Set(fingerprintList.map((item) => item.encodingSource));
  return {
    query: session.query,
    replacement: session.replacement,
    mode: session.engine,
    encoding: uniqueEncodings.size === 1 ? [...uniqueEncodings][0] : 'auto',
    encodingSource: uniqueSources.size === 1 ? [...uniqueSources][0] : 'mixed',
    dialect: session.engine,
    scope: {
      basePath: session.basePath,
      filePath: session.filePath ?? null,
      include: session.include,
      exclude: session.exclude
    },
    flags: {
      wholeWord: session.wholeWord,
      caseSensitive: session.caseSensitive
    },
    counts: {
      filesWithMatches: new Set(session.matches.map((match) => match.filePath)).size,
      totalMatches: session.matches.length,
      previewedMatches: session.matches.length
    },
    previewComplete: session.previewComplete,
    applyAllowed: session.applyAllowed
  };
}

export function serializeSearchResult(result: SearchExecution): Record<string, unknown> {
  return {
    summary: buildSearchSummary(result),
    files: buildFileSummaries(result.matches),
    matches: result.matches.map((match) => serializeMatch(match, Boolean(result.replacement))),
    nextStep: buildFindNextStep()
  };
}

export function buildFindNextStep(): Record<string, unknown> {
  return {
    action: 'prepare_replace_in_files',
    reason: 'If replacement is intended, call prepare_replace_in_files with the same search options plus a replacement string.'
  };
}

export function buildPrepareNextStep(status: 'ready' | 'requires_refinement', sessionId: string | null): Record<string, unknown> {
  if (status === 'ready' && sessionId) {
    return {
      action: 'apply_replace_in_files',
      sessionId,
      selectionModes: ['all', 'include_ids', 'exclude_ids'],
      reason: 'Choose all matches or pass explicit match ids.'
    };
  }

  return {
    action: 'prepare_replace_in_files',
    reason: 'Refine query, filePath, include, exclude, or maxPreviewMatches, then prepare again.'
  };
}

export function buildSessionNextStep(session: PreparedSession): Record<string, unknown> {
  return session.applyAllowed
    ? {
        action: 'apply_replace_in_files',
        sessionId: session.sessionId,
        selectionModes: ['all', 'include_ids', 'exclude_ids'],
        reason: 'Apply the stored session directly, or choose a subset with match ids.'
      }
    : {
        action: 'prepare_replace_in_files',
        reason: 'Session is not applyable anymore. Prepare a new replace preview.'
      };
}

function formatScope(result: SearchExecution): string {
  const parts: string[] = [result.mode, `encoding=${result.resultEncoding}`];
  if (result.wholeWord) {
    parts.push('whole-word');
  }
  parts.push(result.caseSensitive ? 'case-sensitive' : 'case-insensitive');
  return parts.join(', ');
}

function formatMatchLine(match: MatchRecord, includeReplacement: boolean): string {
  return includeReplacement
    ? `- [${match.id}] ${match.filePath}:${match.line}:${match.columnStart} ${JSON.stringify(match.matchText)} -> ${JSON.stringify(match.replacementPreview)}`
    : `- ${match.filePath}:${match.line}:${match.columnStart} ${JSON.stringify(match.matchText)} | ${JSON.stringify(`${match.before}[${match.matchText}]${match.after}`)}`;
}

function formatFileSummaryLines(matches: MatchRecord[], limit = 8): string[] {
  const files = buildFileSummaries(matches);
  const lines = files.slice(0, limit).map((file) => `- ${String(file.filePath)} (${String(file.matchCount)})`);
  if (files.length > limit) {
    lines.push(`- ... ${files.length - limit} more files`);
  }
  return lines;
}

function formatMatchLines(matches: MatchRecord[], includeReplacement: boolean, limit = 12): string[] {
  const lines = matches.slice(0, limit).map((match) => formatMatchLine(match, includeReplacement));
  if (matches.length > limit) {
    lines.push(`- ... ${matches.length - limit} more matches in structuredContent.matches`);
  }
  return lines;
}

export function formatFindText(result: SearchExecution): string {
  const lines = [
    `status=${result.totalMatches > 0 ? 'matches_found' : 'no_matches'} | query=${JSON.stringify(result.query)}`,
    `counts: matches=${result.totalMatches}, files=${result.filesWithMatches}, previewed=${result.returnedMatches}, complete=${result.previewComplete}`,
    `mode: ${formatScope(result)}`
  ];

  if (result.filesWithMatches > 0) {
    lines.push('files:');
    lines.push(...formatFileSummaryLines(result.matches, 6));
    lines.push('samples:');
    lines.push(...formatMatchLines(result.matches, false, 6));
  }

  lines.push(`next: ${String(buildFindNextStep().action)}`);
  return lines.join('\n');
}

export function formatPrepareText(
  result: SearchExecution,
  status: 'ready' | 'requires_refinement',
  sessionId: string | null,
  expiresAt: string | null
): string {
  const lines = [
    `status=${status} | replace ${JSON.stringify(result.query)} -> ${JSON.stringify(result.replacement)}`,
    `counts: matches=${result.totalMatches}, files=${result.filesWithMatches}, previewed=${result.returnedMatches}, complete=${result.previewComplete}`,
    `rule: ${result.limitationCode} | ${result.limitation}`
  ];

  if (sessionId && expiresAt) {
    lines.push(`session: ${sessionId} (expires ${expiresAt})`);
    lines.push('next: apply_replace_in_files');
  } else {
    lines.push('next: prepare_replace_in_files');
  }

  if (result.filesWithMatches > 0) {
    lines.push('files:');
    lines.push(...formatFileSummaryLines(result.matches, 6));
    lines.push('samples:');
    lines.push(...formatMatchLines(result.matches, true, 6));
  }

  return lines.join('\n');
}

export function formatInspectSessionText(session: PreparedSession): string {
  const lines = [
    `status=${session.applyAllowed ? 'ready' : 'blocked'} | session=${session.sessionId}`,
    `mode: ${session.engine}, encoding=${Object.values(session.fileFingerprints)[0]?.encoding ?? 'auto'}`,
    `replace ${JSON.stringify(session.query)} -> ${JSON.stringify(session.replacement)}`,
    `counts: matches=${session.matches.length}, files=${new Set(session.matches.map((match) => match.filePath)).size}, complete=${session.previewComplete}`,
    `expires: ${session.expiresAt}`,
    `next: ${String(buildSessionNextStep(session).action)}`
  ];

  if (session.matches.length > 0) {
    lines.push('files:');
    lines.push(...formatFileSummaryLines(session.matches, 6));
    lines.push('samples:');
    lines.push(...formatMatchLines(session.matches, true, 6));
  }
  return lines.join('\n');
}

export function formatApplyText(
  sessionId: string,
  changedFiles: Array<{ filePath: string; replacementsApplied: number; backupPath: string | null }>,
  replacementsApplied: number,
  createBackup: boolean
): string {
  const lines = [
    `status=applied | session=${sessionId}`,
    `counts: replacements=${replacementsApplied}, files=${changedFiles.length}`,
    `backup: ${createBackup ? 'created' : 'not_created'}`,
    'next: done'
  ];

  if (changedFiles.length > 0) {
    lines.push('files:');
    for (const item of changedFiles.slice(0, 8)) {
      lines.push(`- ${item.filePath} (${item.replacementsApplied})`);
    }
    if (changedFiles.length > 8) {
      lines.push(`- ... ${changedFiles.length - 8} more files`);
    }
  }

  return lines.join('\n');
}

export function ok(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent
  };
}

export function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true
  };
}
