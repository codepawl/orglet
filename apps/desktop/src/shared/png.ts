const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The width and height a PNG declares in its first chunk, or undefined when the bytes do not start like a PNG: the
 * signature, then an `IHDR` chunk at byte 8 whose first eight bytes are the two sizes, big-endian.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined;
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return undefined;
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== 'IHDR') return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return undefined;
  return { width, height };
}
