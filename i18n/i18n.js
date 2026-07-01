/* ============================================================
 *  Nutrolis · i18n engine  (buildless ESM — no bundler required)
 *
 *  Architecture (matches the enterprise spec):
 *    • i18next core .......... translation key resolution + memory store
 *    • LanguageDetector ...... localStorage + navigator, guest-friendly
 *    • ChainedBackend ........ LocalStorage cache  ->  HTTP lazy bundles
 *    • ICU MessageFormat ..... plurals, gender, {name} interpolation
 *
 *  Three-tier cache (as specified):
 *    1. In-memory  — i18next resource store (instant, this session)
 *    2. LocalStorage — i18next-localstorage-backend (guests + repeat visits)
 *    3. Network    — /i18n/locales/{{lng}}/{{ns}}.json (lazy, once)
 *  Logged-in preference is persisted to the Supabase `profiles.language`
 *  column by the app when setLanguage() fires the `nl:languagechanged` event.
 *
 *  Performance: switching to an already-loaded language is synchronous in
 *  the resource store, so the UI re-render (the app's own render()) is the
 *  only cost — comfortably < 100 ms. Bundles for all supported languages
 *  are prewarmed in the background after first paint for instant switching.
 * ============================================================ */

import i18next          from "https://esm.sh/i18next@23.15.1";
import LanguageDetector from "https://esm.sh/i18next-browser-languagedetector@8.0.0";
import ChainedBackend   from "https://esm.sh/i18next-chained-backend@4.6.2";
import HttpBackend      from "https://esm.sh/i18next-http-backend@2.6.1";
import LocalStorageBackend from "https://esm.sh/i18next-localstorage-backend@4.2.0";
import ICU              from "https://esm.sh/i18next-icu@2.3.0";

const MANIFEST_URL = "/i18n/locales/manifest.json";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000; // localStorage bundle TTL: 7 days

let MANIFEST = null;
let LANG_INDEX = {}; // code -> { code, native, dir, font, ... }

/* ---------- helpers exposed to the app ---------- */
export const i18n = i18next;
export function t(key, opts) { return i18next.t(key, opts); }
export function currentLang() { return i18next.resolvedLanguage || i18next.language || "en"; }
export function langMeta(code) { return LANG_INDEX[code] || { code, dir: "ltr", font: "latin", native: code }; }
export function supportedLanguages() { return MANIFEST ? MANIFEST.languages.slice() : [{ code: "en", native: "English", dir: "ltr" }]; }
export function isRTL(code) { return langMeta(code || currentLang()).dir === "rtl"; }

/* ---------- init ---------- */
export async function initI18n({ initialLang } = {}) {
  MANIFEST = await fetch(MANIFEST_URL).then(r => r.json()).catch(() => ({
    defaultLanguage: "en", fallbackLanguage: "en", namespaces: ["common"],
    languages: [{ code: "en", native: "English", dir: "ltr", font: "latin" }],
  }));
  LANG_INDEX = Object.fromEntries(MANIFEST.languages.map(l => [l.code, l]));
  const supported = MANIFEST.languages.map(l => l.code);

  await i18next
    .use(ChainedBackend)
    .use(LanguageDetector)
    .use(ICU)
    .init({
      // A logged-in user's stored preference wins; else detector decides.
      lng: initialLang || undefined,
      fallbackLng: MANIFEST.fallbackLanguage || "en",
      supportedLngs: supported,
      nonExplicitSupportedLngs: true,   // "hi-IN" resolves to "hi"
      load: "languageOnly",
      ns: MANIFEST.namespaces || ["common"],
      defaultNS: "common",
      returnEmptyString: false,          // fall back rather than render ""
      interpolation: { escapeValue: false }, // app already escapes at render
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: "nutrolis-lang",
        caches: ["localStorage"],
      },
      backend: {
        backends: [LocalStorageBackend, HttpBackend],
        backendOptions: [
          { prefix: "nl-i18n-", expirationTime: CACHE_MS, defaultVersion: "v1" },
          { loadPath: "/i18n/locales/{{lng}}/{{ns}}.json" },
        ],
      },
    });

  applyDir(currentLang());
  return i18next;
}

/* ---------- language switching ---------- */
/**
 * Switch UI language. Loads the bundle if it isn't cached yet (network once),
 * otherwise resolves from memory/localStorage instantly. Fires
 * `nl:languagechanged` on window so the app can re-render + persist to Supabase.
 */
export async function setLanguage(code) {
  if (!code || code === currentLang()) return currentLang();
  await i18next.changeLanguage(code);       // <100ms if cached; lazy-loads if not
  try { localStorage.setItem("nutrolis-lang", code); } catch (e) {}
  applyDir(code);
  window.dispatchEvent(new CustomEvent("nl:languagechanged", { detail: { code } }));
  return code;
}

/* ---------- direction / html attributes ---------- */
export function applyDir(code) {
  const meta = langMeta(code);
  document.documentElement.dir = meta.dir || "ltr";
  document.documentElement.lang = code;
}

/* ---------- background prewarm for instant switching ---------- */
let _prewarmed = false;
export function prewarmAll() {
  if (_prewarmed || !MANIFEST) return;
  _prewarmed = true;
  const others = MANIFEST.languages.map(l => l.code).filter(c => c !== currentLang());
  // Sequential + throttled so we never contend with app interactions.
  (function next() {
    const c = others.shift();
    if (!c) return;
    i18next.loadLanguages(c).catch(() => {}).finally(() => setTimeout(next, 400));
  })();
}

/* Convenience: re-render hook. The app passes its own render() once. */
export function onLanguageChange(fn) {
  window.addEventListener("nl:languagechanged", fn);
  i18next.on("languageChanged", () => fn());
}
