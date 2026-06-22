# Medication Tracking App

A personal medication tracker, installable as a PWA on iPhone. No backend — everything is stored locally in IndexedDB.

## Stack

- Vite + React + TypeScript
- IndexedDB (via `idb`) for persistence
- `vite-plugin-pwa` for the manifest + service worker

## Features

- Add / edit / delete medications (name, brand/common name, dose, frequency, times of day, notes)
- "Today" view: doses grouped by time of day, check off when taken, resets each day
- Export to Calendar: generates an `.ics` file with a recurring event + alarm per medication schedule, for one-time import into iOS Calendar
- Installable PWA — use Safari's "Add to Home Screen" on iPhone

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

Deploys to Vercel out of the box (see `vercel.json`). Connect the repo in Vercel and it will run `npm run build` and serve `dist/`.
