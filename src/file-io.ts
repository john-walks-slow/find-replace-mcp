import { promises as fs } from 'node:fs';
import path from 'node:path';

const trackedTempPaths = new Set<string>();

function createTempPath(targetPath: string): string {
  const directory = path.dirname(targetPath);
  return path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

function trackTempPath(tempPath: string): void {
  trackedTempPaths.add(tempPath);
}

function untrackTempPath(tempPath: string): void {
  trackedTempPaths.delete(tempPath);
}

export async function writeFileAtomically(targetPath: string, content: Buffer): Promise<void> {
  const tempPath = createTempPath(targetPath);
  trackTempPath(tempPath);

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
      handle = null;
    }

    await fs.rename(tempPath, targetPath);
    untrackTempPath(tempPath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Best-effort close only.
      }
    }
    await safeUnlink(tempPath);
    untrackTempPath(tempPath);
    throw error;
  }
}

export async function cleanupTrackedTempFiles(): Promise<void> {
  const tempPaths = [...trackedTempPaths];
  await Promise.all(tempPaths.map(async (tempPath) => {
    await safeUnlink(tempPath);
    untrackTempPath(tempPath);
  }));
}
