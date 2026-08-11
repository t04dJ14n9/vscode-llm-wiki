import { PDF_DISCUSSION_MAX_PNG_BYTES } from './pdfDiscussionController';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const MAX_EDGE = 1600;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

export function decodeCursorCropPngBase64(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length > Math.ceil(PDF_DISCUSSION_MAX_PNG_BYTES / 3) * 4) return undefined;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return undefined;
  return validateCursorCropPng(bytes);
}

export function validateCursorCropPng(value: unknown): Uint8Array | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength > PDF_DISCUSSION_MAX_PNG_BYTES) {
    return undefined;
  }
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (
    bytes.length < 57
    || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) return undefined;

  let offset: number = PNG_SIGNATURE.length;
  let colorType = -1;
  let bitDepth = -1;
  let width = 0;
  let height = 0;
  let sawPalette = false;
  let sawIdat = false;
  let idatEnded = false;
  const idatChunks: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return undefined;
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const crcStart = dataStart + length;
    const next = crcStart + 4;
    if (next > bytes.length) return undefined;
    const type = bytes.toString('ascii', typeStart, dataStart);
    if (
      !/^[A-Za-z]{4}$/.test(type)
      || /[a-z]/.test(type[2]!)
      || crc32(bytes, typeStart, crcStart) !== bytes.readUInt32BE(crcStart)
    ) return undefined;

    if (offset === PNG_SIGNATURE.length) {
      if (type !== 'IHDR' || length !== 13) return undefined;
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      if (
        width < 1
        || height < 1
        || width > MAX_EDGE
        || height > MAX_EDGE
        || !validColorMode(bitDepth, colorType)
        || bytes[dataStart + 10] !== 0
        || bytes[dataStart + 11] !== 0
        || bytes[dataStart + 12] !== 0
      ) return undefined;
    } else if (type === 'IHDR') {
      return undefined;
    } else if (type === 'PLTE') {
      if (
        sawPalette
        || sawIdat
        || colorType === 0
        || colorType === 4
        || length < 3
        || length > 768
        || length % 3 !== 0
        || (colorType === 3 && length / 3 > 2 ** bitDepth)
      ) return undefined;
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (idatEnded || (colorType === 3 && !sawPalette)) return undefined;
      sawIdat ||= length > 0;
      idatChunks.push(bytes.subarray(dataStart, crcStart));
    } else {
      if (sawIdat) idatEnded = true;
      if (type === 'IEND') {
        return length === 0
          && sawIdat
          && next === bytes.length
          && validScanlines(idatChunks, width, height, bitDepth, colorType)
          ? Uint8Array.from(bytes)
          : undefined;
      }
      if (type[0] === type[0]?.toUpperCase()) return undefined;
    }
    offset = next;
  }
  return undefined;
}

function validScanlines(
  idatChunks: readonly Uint8Array[],
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
): boolean {
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const rowBytes = Math.ceil(width * channels[colorType]! * bitDepth / 8);
  const stride = rowBytes + 1;
  const expectedLength = height * stride;
  try {
    const scanlines = inflateSync(Buffer.concat(idatChunks), {
      maxOutputLength: expectedLength,
    });
    if (scanlines.length !== expectedLength) return false;
    for (let offset = 0; offset < scanlines.length; offset += stride) {
      if (scanlines[offset]! > 4) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validColorMode(bitDepth: number, colorType: number): boolean {
  const depths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return depths[colorType]?.includes(bitDepth) === true;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
