/** Redimensionne une photo côté navigateur (orientation EXIF respectée) avant envoi. */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  }
}

function render(src: CanvasImageSource & { width: number; height: number }, max: number, quality: number) {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return { data: c.toDataURL('image/jpeg', quality), w, h };
}

export async function preparePhoto(file: File) {
  const src = await decode(file);
  const full = render(src, 1800, 0.84);
  const thumb = render(src, 560, 0.78);
  return { image: full.data, thumb: thumb.data, width: full.w, height: full.h, takenAt: file.lastModified || Date.now() };
}
