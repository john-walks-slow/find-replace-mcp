import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
}
export function groupByFile(matches) {
    return matches.reduce((acc, match) => {
        acc[match.filePath] ??= [];
        acc[match.filePath].push(match);
        return acc;
    }, {});
}
export function cleanPatterns(values) {
    return (values ?? []).map((value) => value.trim()).filter(Boolean);
}
export function fileUriToPath(uri) {
    return fileURLToPath(uri);
}
