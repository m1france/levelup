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

/** Portrait carré (photo de joueur), recadré au centre. */
export async function preparePortrait(file: File, size = 640) {
  const src = await decode(file);
  const side = Math.min(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // Légèrement décalé vers le haut : le visage est rarement au centre exact.
  const sy = Math.max(0, (src.height - side) * 0.3);
  ctx.drawImage(src, (src.width - side) / 2, sy, side, side, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.86);
}

/** Photo en pied (conférence de presse) : proportions d'origine, 1400 px de haut au plus. */
export async function prepareFullPhoto(file: File, max = 1400) {
  const src = await decode(file);
  return render(src, max, 0.86).data;
}

/** Logo de club : PNG (transparence conservée), 512 px au plus. */
export async function prepareLogo(file: File, max = 512) {
  const src = await decode(file);
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
