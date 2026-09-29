import w600 from './fonts/barlow-condensed-600.woff2?url';
import w800 from './fonts/barlow-condensed-800.woff2?url';
import w900 from './fonts/barlow-condensed-900.woff2?url';
import w900i from './fonts/barlow-condensed-900-italic.woff2?url';

/** Police condensée façon Ultimate Team (Barlow Condensed, licence OFL) : cartes, lettres et habillage. */
export const WALKOUT_FONT = 'Walkout Condensed';

let loading: Promise<void> | null = null;

export function loadWalkoutFonts() {
  if (loading) return loading;
  const faces = [
    new FontFace(WALKOUT_FONT, `url(${w600}) format('woff2')`, { weight: '600' }),
    new FontFace(WALKOUT_FONT, `url(${w800}) format('woff2')`, { weight: '800' }),
    new FontFace(WALKOUT_FONT, `url(${w900}) format('woff2')`, { weight: '900' }),
    new FontFace(WALKOUT_FONT, `url(${w900i}) format('woff2')`, { weight: '900', style: 'italic' }),
  ];
  loading = Promise.all(
    faces.map((f) =>
      f.load().then(
        (ff) => void document.fonts.add(ff),
        () => undefined,
      ),
    ),
  ).then(() => undefined);
  return loading;
}
