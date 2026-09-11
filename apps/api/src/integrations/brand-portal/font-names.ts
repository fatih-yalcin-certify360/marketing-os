/** Read SFNT family names without executing font code or following offsets outside the file. */
export function fontFamilyNames(bytes: Buffer): string[] {
  if (bytes.length < 12 || ![0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(0))) return [];
  const count = bytes.readUInt16BE(4);
  if (!count || count > 256 || 12 + count * 16 > bytes.length) return [];
  for (let i = 0; i < count; i++) {
    const table = 12 + i * 16;
    const offset = bytes.readUInt32BE(table + 8), length = bytes.readUInt32BE(table + 12);
    if (offset + length > bytes.length) return [];
    if (bytes.toString('ascii', table, table + 4) !== 'name') continue;
    if (length < 6) return [];
    const records = bytes.readUInt16BE(offset + 2), strings = offset + bytes.readUInt16BE(offset + 4);
    if (6 + records * 12 > length) return [];
    const names: string[] = [];
    for (let j = 0; j < records; j++) {
      const record = offset + 6 + j * 12, id = bytes.readUInt16BE(record + 6);
      if (id !== 1 && id !== 16) continue;
      const size = bytes.readUInt16BE(record + 8), start = strings + bytes.readUInt16BE(record + 10);
      if (start + size > offset + length || !size) continue;
      const platform = bytes.readUInt16BE(record);
      if ((platform === 0 || platform === 3) && size % 2) continue;
      const data = Buffer.from(bytes.subarray(start, start + size));
      const name = platform === 0 || platform === 3 ? data.swap16().toString('utf16le') : data.toString('utf8');
      if (name.trim()) names.push(name.trim());
    }
    return [...new Set(names)];
  }
  return [];
}

/** CSS face metadata from OS/2; never guess all files to be the regular face. */
export function fontFaceStyle(bytes: Buffer): { weight: number; style: 'normal' | 'italic' } {
  const fallback = { weight: 400, style: 'normal' as const };
  if (bytes.length < 12) return fallback;
  const count = bytes.readUInt16BE(4);
  if (count > 256 || 12 + count * 16 > bytes.length) return fallback;
  for (let i = 0; i < count; i++) {
    const table = 12 + i * 16;
    if (bytes.toString('ascii', table, table + 4) !== 'OS/2') continue;
    const offset = bytes.readUInt32BE(table + 8), length = bytes.readUInt32BE(table + 12);
    if (length < 6 || offset + length > bytes.length) return fallback;
    const weight = bytes.readUInt16BE(offset + 4);
    return { weight: weight >= 1 && weight <= 1000 ? weight : 400, style: length >= 64 && (bytes.readUInt16BE(offset + 62) & 1) !== 0 ? 'italic' : 'normal' };
  }
  return fallback;
}
