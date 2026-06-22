# Medication Tracking App

A personal medication tracker, installable as a PWA on iPhone. Local-first with IndexedDB, synced across devices via Supabase.

## Stack

- Vite + React + TypeScript
- IndexedDB (via `idb`) for local persistence/offline cache
- Supabase for auth (email/password) + cross-device sync
- `vite-plugin-pwa` for the manifest + service worker

## Features

- Add / edit / delete medications (name, brand/common name, dose, frequency, times of day, notes)
- Frequency text (e.g. "twice daily") suggests sensible dose times, biased toward morning/afternoon/bedtime
- "Today" view: doses grouped by time of day, check off when taken, resets each day
- Local drug interaction warnings for well-known contraindicated combinations
- Export to Calendar: generates an `.ics` file with a recurring event + alarm per medication schedule
- Sign in with email/password; medications and dose logs sync automatically across every device you log into
- Installable PWA — use Safari's "Add to Home Screen" on iPhone

## Cloud sync setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/schema.sql` from this repo to create the `medications` and `dose_logs` tables with row-level security scoped to each user.
3. In Project Settings → API, copy your **Project URL** and **anon public key**.
4. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
5. In Authentication → Providers → Email, you can disable "Confirm email" for a smoother personal-use signup flow, or leave it on and confirm via the email link.
6. Add the same two env vars in your Vercel project settings before deploying.

Without these env vars set, the app still runs fully offline on a single device (no login screen).

## Development

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy

Deploys to Vercel out of the box (see `vercel.json`). Connect the repo in Vercel, set the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars, and it will run `npm run build` and serve `dist/`.
