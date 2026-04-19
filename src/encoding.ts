import { promises as fs } from 'node:fs';

import iconv from 'iconv-lite';

import { ENCODING_HINT, type DetectedEncoding, type SupportedEncoding, type TextFileData } from './types.js';
import { sha256 } from './utils.js';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function detectEncoding(raw: Buffer, requested?: SupportedEncoding): DetectedEncoding | null {
  if (requested) {
    return {
      encoding: requested,
      source: 'explicit',
      ...detectBomDetails(raw, requested)
    };
  }

  const bom = detectBom(raw);
  if (bom) {
    return { ...bom, source: 'auto' };
  }

  try {
    UTF8_DECODER.decode(raw);
    return { encoding: 'utf-8', source: 'auto', bomKind: 'none', bomBytes: 0 };
  } catch {
    return null;
  }
}

export function detectBom(raw: Buffer): Omit<DetectedEncoding, 'source'> | null {
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return { encoding: 'utf-8', bomKind: 'utf8', bomBytes: 3 };
  }
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return { encoding: 'utf-16le', bomKind: 'utf16le', bomBytes: 2 };
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return { encoding: 'utf-16be', bomKind: 'utf16be', bomBytes: 2 };
  }
  return null;
}

function detectBomDetails(raw: Buffer, requested: SupportedEncoding): Pick<DetectedEncoding, 'bomKind' | 'bomBytes'> {
  const bom = detectBom(raw);
  if (!bom || bom.encoding !== requested) {
    return { bomKind: 'none', bomBytes: 0 };
  }
  return { bomKind: bom.bomKind, bomBytes: bom.bomBytes };
}

function encodingCodecName(encoding: SupportedEncoding): string {
  switch (encoding) {
    case 'utf-8':
      return 'utf8';
    case 'utf-16le':
      return 'utf16-le';
    case 'utf-16be':
      return 'utf16-be';
    case 'windows-1252':
      return 'windows-1252';
    case 'gbk':
      return 'gbk';
    case 'shift_jis':
      return 'shift_jis';
    default: {
      const exhaustive: never = encoding;
      return exhaustive;
    }
  }
}

export function stripBom(raw: Buffer, detected: DetectedEncoding): Buffer {
  return detected.bomBytes > 0 ? raw.subarray(detected.bomBytes) : raw;
}

export function decodeTextFile(raw: Buffer, detected: DetectedEncoding): string {
  return iconv.decode(stripBom(raw, detected), encodingCodecName(detected.encoding));
}

export function canEncodeText(content: string, encoding: SupportedEncoding): boolean {
  const encoded = iconv.encode(content, encodingCodecName(encoding));
  const decoded = iconv.decode(encoded, encodingCodecName(encoding));
  return decoded === content;
}

export function encodeTextFile(content: string, detected: DetectedEncoding | Pick<DetectedEncoding, 'encoding' | 'bomKind' | 'bomBytes'>): Buffer {
  if (!canEncodeText(content, detected.encoding)) {
    throw new Error(`Updated content cannot be represented in ${detected.encoding}. Use a representable replacement or convert the file encoding first.`);
  }

  const encoded = iconv.encode(content, encodingCodecName(detected.encoding));
  if (detected.bomBytes === 0) {
    return encoded;
  }

  let bom: Buffer;
  switch (detected.bomKind) {
    case 'utf8':
      bom = Buffer.from([0xef, 0xbb, 0xbf]);
      break;
    case 'utf16le':
      bom = Buffer.from([0xff, 0xfe]);
      break;
    case 'utf16be':
      bom = Buffer.from([0xfe, 0xff]);
      break;
    default:
      bom = Buffer.alloc(0);
      break;
  }
  return Buffer.concat([bom, encoded]);
}

export function unsupportedEncodingMessage(filePath: string, requested?: SupportedEncoding): string {
  const prefix = requested
    ? `Could not decode ${filePath} as ${requested}.`
    : `Could not auto-detect a supported text encoding for ${filePath}.`;
  return `${prefix} ${ENCODING_HINT}`;
}

export async function tryReadTextFile(
  absolutePath: string,
  filePath: string,
  requestedEncoding?: SupportedEncoding,
  strict = false
): Promise<TextFileData | null> {
  const raw = await fs.readFile(absolutePath);
  const detected = detectEncoding(raw, requestedEncoding);
  if (!detected) {
    if (strict) {
      throw new Error(unsupportedEncodingMessage(filePath, requestedEncoding));
    }
    return null;
  }

  const stat = await fs.stat(absolutePath);
  return {
    raw,
    content: decodeTextFile(raw, detected),
    sha256: sha256(raw),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    encoding: detected.encoding,
    encodingSource: detected.source,
    bomKind: detected.bomKind,
    bomBytes: detected.bomBytes
  };
}

export async function readTextFileStrict(
  absolutePath: string,
  filePath: string,
  requestedEncoding?: SupportedEncoding,
  strict = true
): Promise<TextFileData> {
  const file = await tryReadTextFile(absolutePath, filePath, requestedEncoding, strict);
  if (!file) {
    throw new Error(unsupportedEncodingMessage(filePath, requestedEncoding));
  }
  return file;
}
