export const SUPPORTED_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'gbk', 'shift_jis'];
export const DEFAULT_MAX_PREVIEW_MATCHES = 500;
export const DEFAULT_MAX_FILE_BYTES = '2M';
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_ACTIVE_SESSIONS = 10;
export const ENCODING_HINT = `Supported encodings: ${SUPPORTED_ENCODINGS.join(', ')}. Auto-detect handles utf-8 and BOM-tagged utf-16.`;
