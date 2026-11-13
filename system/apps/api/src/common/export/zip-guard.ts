import { BadRequestException } from '@nestjs/common';

/**
 * Rejects ZIP based office files (xlsx/docx) that would expand to too much memory before a parser
 * reads them ("zip bomb"). Reads only the ZIP central directory: total uncompressed size, entry count
 * and the compression ratio of every entry.
 */
export function assertSafeZip(buf: Buffer, opts: { maxUncompressed?: number; maxEntries?: number; maxRatio?: number } = {}) {
  const maxUncompressed = opts.maxUncompressed ?? 100 * 1024 * 1024;
  const maxEntries = opts.maxEntries ?? 2000;
  const maxRatio = opts.maxRatio ?? 200;
  const bad = () => new BadRequestException('This file is not a valid spreadsheet or expands to too much data');

  // End of central directory record: signature 0x06054b50 within the last 64 KB + 22 bytes
  const from = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad();
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw bad(); // ZIP64: never needed for an import
  if (entries > maxEntries || cdOffset + cdSize > buf.length) throw bad();

  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad();
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw bad();
    total += uncompressed;
    if (total > maxUncompressed) throw bad();
    if (uncompressed > 1024 * 1024 && uncompressed / Math.max(1, compressed) > maxRatio) throw bad();
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}
