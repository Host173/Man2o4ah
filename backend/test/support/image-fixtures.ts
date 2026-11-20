export function imageBytes(format: 'jpg' | 'png', size = 32): Buffer {
  const bytes = Buffer.alloc(size);
  const signature =
    format === 'png'
      ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : [0xff, 0xd8, 0xff];
  Buffer.from(signature).copy(bytes);
  return bytes;
}
