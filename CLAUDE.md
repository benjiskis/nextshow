# Tour Wishlist

Concert tour wishlist app: track artists, get notified of upcoming shows near you.

Live at https://benjiskis.github.io/nextshow/ — auto-deploys from `main` via GitHub Actions.

## Stack

- **Frontend**: React + Vite, no router (single-page `App.jsx`). Plain CSS (`src/index.css`, light/dark via `prefers-color-scheme`).
- **Auth**: Firebase Auth, Google sign-in only (`signInWithPopup`, not redirect — redirect broke on Firebase session storage in a prior project). `src/lib/firebase.js`.
- **Data**: Supabase Postgres, accessed via the anon key + `@supabase/supabase-js` (`src/lib/supabase.js`). Schema in `schema.sql`.

## Data flow

1. User signs in with Google (Firebase) → `ensureUserRow()` upserts a `users` row keyed on `firebase_uid`.
2. `Wishlist` component: search `artists` locally; if no local match, live-query Ticketmaster's Discovery API from the browser (`src/lib/ticketmaster.js`) as a typeahead fallback, so a newly-added artist gets a correct name + `ticketmaster_id` + logo instead of a bare freeform row.
3. `Shows` component: reads `shows` for every artist on the user's wishlist, groups rows from different sources that are the same real-world concert (artist + within a 6h time window — see `groupShowsBySameEvent` in `supabase.js`), and renders one entry per show with a ticket link per source. Optional geolocation ("Share my location") filters/sorts by distance (`src/lib/geo.js`, haversine).

## Ingestion (not run by the app itself)

Two scripts populate `shows`, each independently, matched to `artists` by external ID (`ticketmaster_id` / `jambase_id`):

- `npm run ingest` → `scripts/ingest-ticketmaster.mjs`
- `npm run ingest:jambase` → `scripts/ingest-jambase.mjs`

Both run daily via `.github/workflows/ingest.yml` (cron, 13:00 UTC) and can be triggered on-demand (Actions tab, or `gh workflow run ingest.yml`).

**Jambase gotcha**: its `startDate` has no UTC offset — it's the venue's naive local time. The script converts it using the venue's IANA timezone (`address['x-timezone']`) before storing; don't revert that or cross-source show matching breaks (times will disagree by the venue's offset, and same-day multi-night runs become ambiguous).

**Jambase API host**: the real API is `api.data.jambase.com/v3` with `Authorization: Bearer`, found by direct probing — their public docs site (`data.jambase.com`) is a JS-rendered SPA that doesn't expose it, and a third-party mirror of the *old* v1 docs (`apikey` query param, different host) is a different, now-rejected API generation. Don't trust either doc source blind; verify against the live API if this ever needs revisiting.

## Env vars

| Var | Used by | Notes |
|---|---|---|
| `VITE_FIREBASE_*` (4) | app | Firebase config, safe to expose client-side |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | app + ingestion | anon key, safe to expose (RLS governs access) |
| `VITE_TICKETMASTER_API_KEY` | app | client-exposed on purpose — Discovery API keys are meant for public/client-side use |
| `TICKETMASTER_API_KEY` | ingestion only | same value as above, unprefixed so Vite doesn't bundle it into the app; kept separate for clarity |
| `JAMBASE_API_KEY` | ingestion only | metered trial key — deliberately **not** exposed client-side, unlike the Ticketmaster key |

Local dev: `.env.local` (gitignored). CI: repo secrets (`gh secret list`).

## Known tradeoffs / debt

- **RLS is wide open** (`anon` role has full read/write on every table). There's no Supabase-native auth session (auth is Firebase-only), so there's no `auth.uid()` to scope policies against. Fine for a prototype shared with a few friends; before this holds data anyone cares about, replace with a server-side Edge Function (service_role key, verifies the Firebase ID token) — see TODO comment in `schema.sql`.
- **Not built yet**: `show_interest` (the "who's in" voting layer) and `groups` (shared wishlists) both have schema already but no app code.

## Commands

```
npm run dev              # local dev server
npm run build             # production build
npm run ingest             # Ticketmaster ingestion
npm run ingest:jambase     # Jambase ingestion
```
