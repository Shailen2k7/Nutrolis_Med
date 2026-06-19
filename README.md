# Nutrolis AI — deployable build

A complete, single-file health-intelligence web app. Users upload any medical
report and get a calm, plain-language explanation, a growing personal health
dashboard, trend tracking, and an interactive body-and-encyclopedia drawer.
Built to match the Nutrolis homepage design (Hanken Grotesk + Newsreader,
teal/aqua palette, "worth a look" amber, light/dark).

---

## ⚠️ Do this first: rotate your Claude API key

You pasted a live Anthropic key into chat, so treat it as **compromised**.
Go to console.anthropic.com → API Keys → revoke it → create a new one.
The new key goes **only** into the server-side edge function as a secret
(step 3 below). It never goes in the website — browser code is public.

---

## What ships

| File | Purpose |
|------|---------|
| `index.html` | **Public homepage** — the marketing landing page (hero, demo, features, FAQ). This is what visitors see first. |
| `app.html` | **The application** — auth, dashboard, upload, reports, educational drawer, settings, 20 languages. Homepage CTAs link here. |
| `supabase/schema.sql` | Database tables + Row-Level Security. Run once. |
| `supabase/functions/claude-proxy/index.ts` | Secure Claude proxy (optional but recommended). |

**How they connect:** opening the site shows `index.html` (the homepage). Every
"Get started / Sign in / Upload a report" button opens `app.html`, which handles
login and the full product. Theme choice (light/dark) is shared between them.

## Privacy model
Uploaded files are read **in the browser** (pdf.js for digital PDFs,
Tesseract.js OCR for images/scans) and **never uploaded or stored**. Only the
extracted text + structured findings + markers are saved to your database.

---

## Deploy in 3 steps

### 1. Database (required)
Supabase Dashboard → **SQL Editor** → New query → paste all of
`supabase/schema.sql` → **Run**. This creates `profiles`, `reports`, `markers`,
RLS policies, and the auto-profile trigger.

> Auth tip: Dashboard → Authentication → Providers → Email. If you turn **off**
> "Confirm email", sign-up logs users straight in. If it's on, users confirm by
> email first (the app handles both).

### 2. Website (required) — this is the "drag and make live" part
Drag the **whole `nutrolis` folder** onto **Netlify Drop**
(app.netlify.com/drop) — not just one file, so both `index.html` (homepage) and
`app.html` (the app) ship together. Or use Vercel, GitHub Pages, or any static
host. It's live immediately: visitors land on your homepage, click Get started,
and go into the app. The Supabase URL + anon key are already wired in (the anon
key is safe to ship — it's public and protected by RLS). Everything works right
now on the built-in Medical Knowledge Engine.

> Deploying only `index.html` would show the homepage but the buttons would 404.
> Always deploy the folder (or both HTML files).

### 3. Claude enhancement (optional, recommended)
Makes explanations richer and writes them in the user's chosen language.
Requires the Supabase CLI once:

```bash
supabase login
supabase link --project-ref aueoazkbdjskyyeyacci
supabase functions deploy claude-proxy --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # your NEW rotated key
```

That's it. If this step is skipped, the app silently falls back to the local
engine — nothing breaks.

---

## Features built
- Email auth (sign up / sign in) + onboarding profile.
- Dashboard: overall health score ring, improving/stable/attention trends,
  report + marker counts, clickable attention markers, recent reports.
- Upload: drag-drop / file pick / paste text / sample report, animated 6-step
  pipeline (read → detect type → analyse → explain → save → update).
- Report page: what it means, snapshot, key findings, good news, areas worth a
  look, trends with sparklines, questions for your doctor, learn-more.
- My Reports: search, type filters, list + timeline views.
- Drawer: interactive body figure + full encyclopedia (what/why/how/range/
  causes/improve/when-to-see-a-doctor/related/fun fact) for 19 markers + 9 organs.
- Settings: profile, 20 languages (RTL for Arabic/Urdu), theme, notifications,
  export data (JSON), delete-all with typed `DELETE` confirmation.
- 100% mobile-friendly: sidebar on desktop, bottom tab bar + top bar on mobile,
  safe-area insets, full-width drawer, reduced-motion respected.

## Honest notes on scope
- The knowledge engine covers ~19 of the most common blood/metabolic markers in
  depth. Imaging/ECG reports are detected and saved with organ-level education;
  per-finding parsing of free-text radiology is best handled by the Claude layer.
- UI is translated into 5 languages in full; the other 15 fall back to English
  UI strings, while Claude-generated report explanations come back in any of the
  20. Add more `STR` entries to extend UI coverage.
- Medical content is educational and deliberately non-diagnostic. Have a
  clinician review the encyclopedia copy before any real-world launch.
