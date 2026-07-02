# Nutrolis — go-live guide (multilingual module)

Everything in this folder is the complete site. Two steps to ship.

## 1. Database (one time)
Supabase → SQL Editor → New query → paste and run:

```
supabase/migrations/002_report_translations.sql
```

This adds `reports.master_json` + `reports.content_hash` and the
`report_translations` cache table (with row-level security). The app is written
to work even if you forget this — but the report translation cache only persists
across devices once it's applied.

Nothing else in Supabase changes. Your existing `profiles`, `reports`,
`markers` tables and the `claude-proxy` edge function are reused as-is.

## 2. Site
Re-upload the **whole folder** (drag onto Netlify, or push to your host). It must
include the new `/i18n` and `/reports` directories. The service worker version is
bumped to `nutrolis-v2`, so returning visitors pick up the update automatically.

That's it. No build step, no bundler.

---

## Where the language control lives
Dashboard header, Settings, the sign-in screen, and onboarding step 1. The
marketing homepage has **no** switcher — it simply follows the language the user
picked inside the app.

## How the languages work

| Layer | Languages | Speed | Source |
|---|---|---|---|
| App **UI** | English, Hindi | instant | reviewed static tables (in-file) |
| App **UI** | the other 18 | **instant** | pre-translated bundles shipped at `/i18n/locales/<lang>/app.json`, prefetched at boot |
| **AI report prose** (summary, findings, questions) | all 20 | fills in within seconds, then cached | translated on demand via your Claude proxy |
| **Fonts** (Devanagari, Tamil, Arabic, CJK, Thai…) | all | on demand | loaded per language, no clipping |

- Every language switch is instant — all 20 interface bundles ship with the product
  and are prefetched in the background after login.
- Only the AI-written report prose (unique per user) translates on demand; it
  appears within a few seconds on first view and is cached after.
- Language preference follows the user: saved to the browser and, once signed in,
  to their Supabase `profiles.language`. Pick a language on the homepage → sign in
  → the app opens in that language.

## Making a market "premium" (optional, recommended before you push a language hard)
For any language you want fully reviewed and instant-from-first-load, drop a
reviewed file at:

```
i18n/locales/<lang>/app.json      # app UI + content strings (key → translation)
i18n/locales/<lang>/common.json   # homepage "home.*" keys
```

If that file exists, the app uses it and skips machine translation entirely.
English (`en`) and Hindi (`hi`) already ship this way.

## One honest caveat (patient safety)
The deep marker **encyclopedia** drawers (the 19-marker medical explainers) and
non-English report copy are translated by Claude, not yet clinician-reviewed in
every language. This is accurate but should be reviewed by a clinician/native
speaker before you heavily market Nutrolis in a given language. English and Hindi
medical copy is reviewed.

## Files
```
index.html                 marketing homepage (localized)
app.html                   the product (localized)
i18n/
  i18n.js                  homepage i18n engine (i18next, buildless)
  fonts.js                 per-script font loader
  locales/manifest.json    20 languages
  locales/en/common.json   homepage EN
  locales/hi/common.json   homepage HI
reports/reportI18n.js      report translation cache (English master + per-lang cache)
supabase/migrations/002_report_translations.sql
service-worker.js          PWA (cache v2)
manifest.json, icons/      PWA assets
```
