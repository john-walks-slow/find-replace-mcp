import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function groupByFile<T extends { filePath: string }>(matches: T[]): Record<string, T[]> {
  return matches.reduce<Record<string, T[]>>((acc, match) => {
    acc[match.filePath] ??= [];
    acc[match.filePath]!.push(match);
    return acc;
  }, {});
}

export function cleanPatterns(values?: string[]): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

export function fileUriToPath(uri: string): string {
  return fileURLToPath(uri);
}
