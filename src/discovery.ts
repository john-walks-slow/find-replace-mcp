import { spawn } from 'node:child_process';
import path from 'node:path';

import { DEFAULT_MAX_FILE_BYTES, type CandidateFile, type SearchConfig } from './types.js';
import { normalizePath } from './utils.js';

export async function discoverCandidateFiles(config: SearchConfig): Promise<CandidateFile[]> {
  if (config.filePath) {
    return [
      {
        filePath: normalizePath(path.relative(config.basePath, config.filePath)),
        absolutePath: config.filePath
      }
    ];
  }

  const args = ['--files', '--no-config'];
  if (!config.useGitIgnore) {
    args.push('--no-ignore');
  }
  args.push('--max-filesize', DEFAULT_MAX_FILE_BYTES);
  for (const pattern of config.include) {
    args.push('--glob', pattern);
  }
  for (const pattern of config.exclude) {
    args.push('--glob', `!${pattern}`);
  }
  args.push('.');

  return new Promise((resolve, reject) => {
    const child = spawn('rg', args, {
      cwd: config.basePath,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const files: CandidateFile[] = [];
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(new Error(`Failed to start ripgrep: ${error.message}`)));
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`));
        return;
      }
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const filePath = normalizePath(trimmed.replace(/^\.\//, ''));
        files.push({ filePath, absolutePath: path.resolve(config.basePath, trimmed) });
      }
      resolve(files);
    });
  });
}
