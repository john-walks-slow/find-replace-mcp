import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import picomatch from 'picomatch';

import { DEFAULT_MAX_FILE_BYTES, type CandidateFile, type SearchConfig } from './types.js';
import { normalizePath } from './utils.js';

const MAX_FILE_BYTES = parseMaxFileBytes(DEFAULT_MAX_FILE_BYTES);

type IgnoreFile = {
  directory: string;
  matcher: Ignore;
};

type WalkFrame = {
  directory: string;
  inheritedIgnores: IgnoreFile[];
};

export async function discoverCandidateFiles(config: SearchConfig): Promise<CandidateFile[]> {
  if (config.filePath) {
    return [
      {
        filePath: normalizePath(path.relative(config.basePath, config.filePath)),
        absolutePath: config.filePath
      }
    ];
  }

  const files: CandidateFile[] = [];
  const stack: WalkFrame[] = [{ directory: config.basePath, inheritedIgnores: [] }];
  const includeMatchers = config.include.map((pattern) => picomatch(pattern));
  const excludeMatchers = config.exclude.map((pattern) => picomatch(pattern));

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const localIgnore = config.useGitIgnore ? await loadIgnoreFile(frame.directory) : null;
    const activeIgnores = localIgnore ? [...frame.inheritedIgnores, localIgnore] : frame.inheritedIgnores;
    const entries = await fs.readdir(frame.directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.gitignore' || entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(frame.directory, entry.name);
      const relativePath = normalizePath(path.relative(config.basePath, absolutePath));

      if (entry.isDirectory()) {
        if (config.useGitIgnore && isIgnoredByGitignore(activeIgnores, absolutePath, true)) {
          continue;
        }
        stack.push({ directory: absolutePath, inheritedIgnores: activeIgnores });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      if (config.useGitIgnore && isIgnoredByGitignore(activeIgnores, absolutePath, false)) {
        continue;
      }
      if (!matchesIncludeExclude(relativePath, includeMatchers, excludeMatchers)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }

      files.push({ filePath: relativePath, absolutePath });
    }
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return files;
}

async function loadIgnoreFile(directory: string): Promise<IgnoreFile | null> {
  const ignorePath = path.join(directory, '.gitignore');
  const content = await fs.readFile(ignorePath, 'utf8').catch(() => null);
  if (content === null) {
    return null;
  }

  return {
    directory,
    matcher: ignore().add(content)
  };
}

function isIgnoredByGitignore(ignoreStack: IgnoreFile[], absolutePath: string, isDirectory: boolean): boolean {
  for (let index = ignoreStack.length - 1; index >= 0; index -= 1) {
    const ignoreFile = ignoreStack[index]!;
    const relativeToIgnoreDir = normalizePath(path.relative(ignoreFile.directory, absolutePath));
    if (!relativeToIgnoreDir || relativeToIgnoreDir.startsWith('../')) {
      continue;
    }

    const candidate = isDirectory ? `${relativeToIgnoreDir}/` : relativeToIgnoreDir;
    if (ignoreFile.matcher.ignores(candidate)) {
      return true;
    }
  }

  return false;
}

function matchesIncludeExclude(
  filePath: string,
  include: Array<(input: string) => boolean>,
  exclude: Array<(input: string) => boolean>
): boolean {
  if (include.length > 0 && !include.some((matcher) => matcher(filePath))) {
    return false;
  }
  if (exclude.some((matcher) => matcher(filePath))) {
    return false;
  }
  return true;
}

function parseMaxFileBytes(value: string): number {
  const match = /^(\d+)([kmg])?$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Unsupported DEFAULT_MAX_FILE_BYTES format: ${value}`);
  }

  const base = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === 'k' ? 1024 : suffix === 'm' ? 1024 * 1024 : suffix === 'g' ? 1024 * 1024 * 1024 : 1;
  return base * multiplier;
}
