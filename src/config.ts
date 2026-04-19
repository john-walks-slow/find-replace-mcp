import { promises as fs } from 'node:fs';
import path from 'node:path';

import { cleanPatterns } from './utils.js';
import { DEFAULT_MAX_PREVIEW_MATCHES, type SearchConfig, type SupportedEncoding } from './types.js';

export type BuildConfigArgs = {
  basePath?: string;
  filePath?: string;
  include?: string[];
  exclude?: string[];
  regex?: boolean;
  wholeWord?: boolean;
  caseSensitive?: boolean;
  useGitIgnore?: boolean;
  maxPreviewMatches?: number;
  encoding?: SupportedEncoding;
};

export async function buildConfig(
  args: BuildConfigArgs,
  resolveDefaultBasePath: () => Promise<string>
): Promise<SearchConfig> {
  const defaultBase = await resolveDefaultBasePath();
  const basePath = path.resolve(args.basePath ?? defaultBase);
  const filePath = args.filePath ? path.resolve(basePath, args.filePath) : undefined;

  const baseStat = await fs.stat(basePath).catch(() => null);
  if (!baseStat || !baseStat.isDirectory()) {
    throw new Error(`basePath does not exist or is not a directory: ${basePath}`);
  }

  if (filePath) {
    const fileStat = await fs.stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      throw new Error(`filePath does not exist or is not a file: ${filePath}`);
    }
  }

  return {
    basePath,
    filePath,
    include: cleanPatterns(args.include),
    exclude: cleanPatterns(args.exclude),
    regex: args.regex ?? false,
    wholeWord: args.wholeWord ?? false,
    caseSensitive: args.caseSensitive ?? false,
    useGitIgnore: args.useGitIgnore ?? true,
    maxPreviewMatches: args.maxPreviewMatches ?? DEFAULT_MAX_PREVIEW_MATCHES,
    requestedEncoding: args.encoding
  };
}
