/* ============================================================
 *  Nutrolis · Script-aware font loader
 *
 *  Loads the right Noto family for the active language ONLY when needed
 *  (never ships every font to every user), then sets a CSS variable the
 *  app's font-family stack already falls through to. Prevents clipping,
 *  broken alignment and missing glyphs for complex scripts.
 *
 *  Wire-up (once, in app.html <head> or via JS):
 *    body { font-family: var(--i18n-font, 'Hanken Grotesk'), system-ui, sans-serif; }
 *  Then call loadFontForLang(code) on every language change.
 * ============================================================ */

/* font token (from manifest) -> { family, css, lineHeight } */
const FONTS = {
  latin:      { family: "Hanken Grotesk", css: null, lh: null }, // already loaded by the app
  cyrillic:   { family: "Noto Sans",              css: "Noto+Sans:wght@400;500;600;700",            lh: null },
  devanagari: { family: "Noto Sans Devanagari",   css: "Noto+Sans+Devanagari:wght@400;500;600;700", lh: 1.7 },
  bengali:    { family: "Noto Sans Bengali",      css: "Noto+Sans+Bengali:wght@400;500;600;700",    lh: 1.7 },
  tamil:      { family: "Noto Sans Tamil",        css: "Noto+Sans+Tamil:wght@400;500;600;700",      lh: 1.7 },
  telugu:     { family: "Noto Sans Telugu",       css: "Noto+Sans+Telugu:wght@400;500;600;700",     lh: 1.7 },
  malayalam:  { family: "Noto Sans Malayalam",    css: "Noto+Sans+Malayalam:wght@400;500;600;700",  lh: 1.75 },
  kannada:    { family: "Noto Sans Kannada",      css: "Noto+Sans+Kannada:wght@400;500;600;700",    lh: 1.7 },
  arabic:     { family: "Noto Sans Arabic",       css: "Noto+Sans+Arabic:wght@400;500;600;700",     lh: 1.8 },
  sc:         { family: "Noto Sans SC",           css: "Noto+Sans+SC:wght@400;500;600;700",         lh: 1.7 },
  jp:         { family: "Noto Sans JP",           css: "Noto+Sans+JP:wght@400;500;600;700",         lh: 1.7 },
  kr:         { family: "Noto Sans KR",           css: "Noto+Sans+KR:wght@400;500;600;700",         lh: 1.7 },
  thai:       { family: "Noto Sans Thai",         css: "Noto+Sans+Thai:wght@400;500;600;700",       lh: 1.8 },
};

const _loaded = new Set();

function injectStylesheet(cssParam) {
  const href = `https://fonts.googleapis.com/css2?family=${cssParam}&display=swap`;
  if (document.querySelector(`link[data-i18n-font="${cssParam}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-i18n-font", cssParam);
  document.head.appendChild(link);
}

/**
 * Ensure the font for `fontToken` is present and apply it app-wide.
 * Returns a promise that resolves when the font is ready (or immediately
 * for the latin default). Never blocks — display:swap keeps text visible.
 */
export async function loadFontForToken(fontToken) {
  const f = FONTS[fontToken] || FONTS.latin;

  if (f.css && !_loaded.has(fontToken)) {
    injectStylesheet(f.css);
    _loaded.add(fontToken);
  }

  // The Nutrolis font stack keeps Hanken Grotesk first for Latin; complex
  // scripts prepend their Noto family so Latin UI chrome stays on-brand.
  const stack = fontToken === "latin"
    ? `'Hanken Grotesk', system-ui, -apple-system, sans-serif`
    : `'${f.family}', 'Hanken Grotesk', system-ui, sans-serif`;

  document.documentElement.style.setProperty("--i18n-font", stack);
  if (f.lh) document.documentElement.style.setProperty("--i18n-lh", String(f.lh));
  else document.documentElement.style.removeProperty("--i18n-lh");

  // Wait for actual glyphs so we can re-measure and avoid layout shift.
  if (f.css && document.fonts && document.fonts.load) {
    try { await document.fonts.load(`600 16px '${f.family}'`); } catch (e) {}
  }
}

/** Convenience wrapper keyed by language metadata from i18n.js. */
export function loadFontForLang(meta) {
  return loadFontForToken((meta && meta.font) || "latin");
}
