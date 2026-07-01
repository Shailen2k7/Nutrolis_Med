/* ============================================================
 *  Nutrolis · Report translation cache
 *
 *  RULE (from spec): Claude generates ONE English master report. We NEVER
 *  ask Claude to regenerate a report per language. We translate the stored
 *  master on demand, cache every translation per report, and reuse it
 *  forever until the report itself is regenerated (content hash changes).
 *
 *  Only human-readable STRING fields are translated. Numbers, marker keys,
 *  units, ranges and statuses are language-independent and pass through
 *  untouched — so translation is cheap and can never corrupt the data.
 *
 *  Three-tier cache, fastest first:
 *    1. Memory  (Map)         — instant, this session
 *    2. LocalStorage          — < 200ms, survives reloads, guest-friendly
 *    3. Supabase report_translations — shared across this user's devices
 *  A miss (and only a miss) calls the Claude proxy exactly once.
 *
 *  Dependencies are injected so this module stays framework-free and
 *  testable:  init({ sb, proxyUrl, anonKey, langName })
 * ============================================================ */

/* Fields we translate. Everything else in a report is data, not prose. */
const STRING_FIELDS = ["title", "snapshot", "summary"];
const STRING_ARRAYS = ["good_news", "attention", "questions"];
const MASTER_LNG = "en";

let SB = null;                // Supabase client
let PROXY = null;             // Claude proxy URL
let ANON = null;             // Supabase anon key (proxy auth header)
let LANG_NAME = (c) => c;    // code -> human name, injected from i18n manifest

const mem = new Map();        // `${reportId}:${lng}` -> { hash, content }
const inflight = new Map();   // de-dupe concurrent translate calls

export function initReportI18n({ sb, proxyUrl, anonKey, langName }) {
  SB = sb; PROXY = proxyUrl; ANON = anonKey;
  if (typeof langName === "function") LANG_NAME = langName;
}

/* ---------- stable content hash (invalidation key) ---------- */
export function hashMaster(master) {
  const basis = JSON.stringify(pickTranslatable(master));
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return "h" + (h >>> 0).toString(36);
}

function pickTranslatable(r) {
  const o = {};
  STRING_FIELDS.forEach(k => { if (r[k] != null) o[k] = r[k]; });
  STRING_ARRAYS.forEach(k => { if (Array.isArray(r[k])) o[k] = r[k]; });
  return o;
}
function mergeTranslated(master, translated) {
  const out = { ...master };
  STRING_FIELDS.forEach(k => { if (translated[k] != null) out[k] = translated[k]; });
  STRING_ARRAYS.forEach(k => { if (Array.isArray(translated[k])) out[k] = translated[k]; });
  return out;
}

/* ---------- localStorage tier ---------- */
function lsKey(reportId, lng) { return `nl-rt-${reportId}-${lng}`; }
function lsGet(reportId, lng, hash) {
  try {
    const raw = localStorage.getItem(lsKey(reportId, lng));
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && j.hash === hash ? j.content : null;   // hash mismatch => stale
  } catch (e) { return null; }
}
function lsSet(reportId, lng, hash, content) {
  try { localStorage.setItem(lsKey(reportId, lng), JSON.stringify({ hash, content })); } catch (e) {}
}

/* ---------- Supabase tier ---------- */
async function dbGet(reportId, lng, hash) {
  if (!SB) return null;
  const { data } = await SB.from("report_translations")
    .select("content, content_hash")
    .eq("report_id", reportId).eq("lang", lng).maybeSingle();
  return data && data.content_hash === hash ? data.content : null;
}
async function dbSet(reportId, userId, lng, hash, content) {
  if (!SB) return;
  await SB.from("report_translations")
    .upsert({ report_id: reportId, user_id: userId, lang: lng, content_hash: hash, content },
            { onConflict: "report_id,lang" });
}

/* ---------- the Claude call (miss path only) ---------- */
async function translateViaClaude(master, lng) {
  const payload = pickTranslatable(master);
  const target = LANG_NAME(lng);
  const system = "You are a precise medical translator for a patient-facing health app. "
    + "Translate the STRING VALUES of the JSON into " + target + ", keeping the JSON keys, "
    + "structure and array lengths identical. Keep the tone calm and reassuring. Do NOT "
    + "translate or alter any numbers, units or lab values. Return ONLY minified JSON.";
  const prompt = JSON.stringify(payload);

  const r = await fetch(PROXY, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + ANON },
    body: JSON.stringify({ system, prompt, max_tokens: 1600 }),
  });
  if (!r.ok) throw new Error("proxy " + r.status);
  const j = await r.json();
  if (!j.text) throw new Error("empty translation");
  return JSON.parse(j.text.replace(/```json|```/g, "").trim());
}

/* ============================================================
 *  PUBLIC API
 * ============================================================ */

/**
 * Return the report in `lng`. Instant for the English master and for any
 * cached translation; only a genuine miss calls Claude (once). Pass the
 * structured English `master` (from reports.master_json).
 *
 * @returns {Promise<{content:object, source:'master'|'memory'|'local'|'db'|'claude'}>}
 */
export async function getReport(reportId, lng, master, userId) {
  if (!lng || lng === MASTER_LNG) return { content: master, source: "master" };
  const hash = hashMaster(master);
  const memKey = `${reportId}:${lng}`;

  // 1) memory
  const m = mem.get(memKey);
  if (m && m.hash === hash) return { content: m.content, source: "memory" };

  // 2) localStorage
  const ls = lsGet(reportId, lng, hash);
  if (ls) { mem.set(memKey, { hash, content: ls }); return { content: ls, source: "local" }; }

  // de-dupe: if a translation for this key is already running, await it
  if (inflight.has(memKey)) return inflight.get(memKey);

  const job = (async () => {
    // 3) Supabase
    const db = await dbGet(reportId, lng, hash).catch(() => null);
    if (db) {
      const merged = mergeTranslated(master, db);
      mem.set(memKey, { hash, content: merged });
      lsSet(reportId, lng, hash, merged);
      announce(reportId, lng);
      return { content: merged, source: "db" };
    }
    // 4) miss -> Claude (exactly once), then populate every tier
    const translated = await translateViaClaude(master, lng);
    const merged = mergeTranslated(master, translated);
    mem.set(memKey, { hash, content: merged });
    lsSet(reportId, lng, hash, merged);
    dbSet(reportId, userId, lng, hash, merged).catch(() => {});
    announce(reportId, lng);
    return { content: merged, source: "claude" };
  })().finally(() => inflight.delete(memKey));

  inflight.set(memKey, job);
  return job;
}

/** Synchronous read of an already-cached translation (memory → localStorage).
 *  Returns the merged translated content, or null if not yet cached. Safe to
 *  call every render; never triggers network. */
export function peek(reportId, lng, master) {
  if (!lng || lng === MASTER_LNG) return master;
  const hash = hashMaster(master);
  const m = mem.get(`${reportId}:${lng}`);
  if (m && m.hash === hash) return m.content;
  const ls = lsGet(reportId, lng, hash);
  if (ls) { mem.set(`${reportId}:${lng}`, { hash, content: ls }); return ls; }
  return null;
}

function announce(reportId, lng) {
  try { window.dispatchEvent(new CustomEvent("nl:reporttranslated", { detail: { reportId, lng } })); } catch (e) {}
}

/** True if `lng` is already cached (memory or localStorage) — lets the UI
 *  decide whether to show a spinner (miss) or switch silently (hit). */
export function isCached(reportId, lng, master) {
  if (!lng || lng === MASTER_LNG) return true;
  const hash = hashMaster(master);
  const m = mem.get(`${reportId}:${lng}`);
  if (m && m.hash === hash) return true;
  return !!lsGet(reportId, lng, hash);
}

/**
 * Fire-and-forget: after a report is created, warm the user's preferred
 * language in the background so the first switch is instant. Never throws,
 * never blocks the UI.
 */
export function translateInBackground(reportId, lng, master, userId) {
  if (!lng || lng === MASTER_LNG) return;
  if (isCached(reportId, lng, master)) return;
  getReport(reportId, lng, master, userId).catch(() => {});
}

/** Drop cached translations for a report (call when it's regenerated/deleted). */
export function clearReportCache(reportId) {
  for (const k of Array.from(mem.keys())) if (k.startsWith(reportId + ":")) mem.delete(k);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`nl-rt-${reportId}-`)) localStorage.removeItem(key);
    }
  } catch (e) {}
}
