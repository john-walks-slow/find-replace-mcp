export const SUPPORTED_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'gbk', 'shift_jis'] as const;

export type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number];
export type EncodingSource = 'auto' | 'explicit';
export type BomKind = 'none' | 'utf8' | 'utf16le' | 'utf16be';
export type SearchMode = 'literal' | 'js-regex';
export type LimitationCode = 'apply_via_session_only' | 'preview_incomplete';
export type SelectionMode = 'all' | 'include_ids' | 'exclude_ids';

export type DetectedEncoding = {
  encoding: SupportedEncoding;
  source: EncodingSource;
  bomKind: BomKind;
  bomBytes: 0 | 2 | 3;
};

export type MatchRecord = {
  id: string;
  filePath: string;
  absolutePath: string;
  line: number;
  columnStart: number;
  columnEnd: number;
  startOffset: number;
  endOffset: number;
  matchText: string;
  replacementPreview: string;
  before: string;
  after: string;
};

export type FileFingerprint = {
  filePath: string;
  absolutePath: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  encoding: SupportedEncoding;
  encodingSource: EncodingSource;
  bomKind: BomKind;
  bomBytes: 0 | 2 | 3;
};

export type PreparedSession = {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  basePath: string;
  filePath?: string;
  query: string;
  replacement: string;
  regex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  include: string[];
  exclude: string[];
  engine: SearchMode;
  previewComplete: boolean;
  applyAllowed: boolean;
  matches: MatchRecord[];
  fileFingerprints: Record<string, FileFingerprint>;
};

export type SearchConfig = {
  basePath: string;
  filePath?: string;
  include: string[];
  exclude: string[];
  regex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  useGitIgnore: boolean;
  maxPreviewMatches: number;
  requestedEncoding?: SupportedEncoding;
};

export type SearchExecution = {
  resolvedBasePath: string;
  query: string;
  replacement: string;
  regex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  include: string[];
  exclude: string[];
  filePath?: string;
  mode: SearchMode;
  requestedEncoding: SupportedEncoding | 'auto';
  resultEncoding: SupportedEncoding | 'auto';
  encodingSource: EncodingSource | 'mixed' | 'auto';
  searchedFiles: number;
  skippedFiles: number;
  filesWithMatches: number;
  totalMatches: number;
  returnedMatches: number;
  previewComplete: boolean;
  replacementPreviewReady: boolean;
  limitationCode: LimitationCode;
  limitation: string;
  matches: MatchRecord[];
  fileFingerprints: Record<string, FileFingerprint>;
};

export type TextFileData = {
  raw: Buffer;
  content: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  encoding: SupportedEncoding;
  encodingSource: EncodingSource;
  bomKind: BomKind;
  bomBytes: 0 | 2 | 3;
};

export type CandidateFile = {
  filePath: string;
  absolutePath: string;
};

export type SearchMatcher = {
  mode: SearchMode;
  createGlobalRegex: () => RegExp;
  renderReplacement: (match: RegExpExecArray, input: string, replacement: string) => string;
};

export const DEFAULT_MAX_PREVIEW_MATCHES = 500;
export const DEFAULT_MAX_FILE_BYTES = '2M';
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_ACTIVE_SESSIONS = 10;
export const ENCODING_HINT = `Supported encodings: ${SUPPORTED_ENCODINGS.join(', ')}. Auto-detect handles utf-8 and BOM-tagged utf-16.`;
