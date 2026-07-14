import { promises as fs } from 'node:fs';
import path from 'node:path';
const trackedTempPaths = new Set();
function createTempPath(targetPath) {
    const directory = path.dirname(targetPath);
    return path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
}
async function safeUnlink(filePath) {
    try {
        await fs.unlink(filePath);
    }
    catch {
        // Best-effort cleanup only.
    }
}
function trackTempPath(tempPath) {
    trackedTempPaths.add(tempPath);
}
function untrackTempPath(tempPath) {
    trackedTempPaths.delete(tempPath);
}
export async function writeFileAtomically(targetPath, content) {
    const tempPath = createTempPath(targetPath);
    trackTempPath(tempPath);
    let handle = null;
    try {
        handle = await fs.open(tempPath, 'w');
        try {
            await handle.writeFile(content);
            await handle.sync();
        }
        finally {
            await handle.close();
            handle = null;
        }
        await fs.rename(tempPath, targetPath);
        untrackTempPath(tempPath);
    }
    catch (error) {
        if (handle) {
            try {
                await handle.close();
            }
            catch {
                // Best-effort close only.
            }
        }
        await safeUnlink(tempPath);
        untrackTempPath(tempPath);
        throw error;
    }
}
export async function cleanupTrackedTempFiles() {
    const tempPaths = [...trackedTempPaths];
    await Promise.all(tempPaths.map(async (tempPath) => {
        await safeUnlink(tempPath);
        untrackTempPath(tempPath);
    }));
}
