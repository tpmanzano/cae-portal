---
intent: "Running changelog of all CAE Portal changes — rollback reference"
audience: internal
type: log
created: 2026-04-09
---

# CAE Portal — Changelog

**Purpose:** Record of all changes to the CAE Portal. Use for rollback reference — if something breaks, find the commit that caused it and revert.

**Repo:** `tpmanzano/cae-portal`
**Production:** `https://cae-portal-production.up.railway.app`
**Platform:** Railway (Hobby tier, $5/mo) — auto-deploys from `main` branch

---

## 2026-04-09 — Session: ThomOS (Railway migration + Reports)

All changes below were made during migration from Render to Railway and the initial Reports build.

### Infrastructure Changes

| Commit | Change | Rollback risk |
|--------|--------|---------------|
| `35953af` | **No-cache headers for HTML pages** — prevents browser/proxy from serving stale content. Added middleware that sets `Cache-Control: no-cache, no-store, must-revalidate` on HTML responses. | Low — remove the middleware block in `server.js` if caching is desired later for performance |
| `a795522` | **PostgreSQL connection added** — `pg` package installed, `Pool` connection configured via env vars (`PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`). Railway PostgreSQL as cloud database. | Remove `pg` require and Pool initialization from `server.js` |

### Feature Changes

| Commit | Change | Rollback risk |
|--------|--------|---------------|
| `f7692d9` | **DRE iframe replaced with native API proxy** — `/api/dre-lookup` route proxies directly to DRE website. No dependency on Render DRE service. Save-as-PDF filename formula works correctly. | Revert `dre-lookup.html` to iframe version and remove `/api/dre-lookup` route from `server.js` |
| `a795522` | **Morning Reports page added** — `/reports` route with 3 API endpoints: `/api/reports/pipeline-summary`, `/api/reports/open-escrows`, `/api/reports/officer-workload`. All query `cae.gold_vw_escrow_complete`. | Remove `reports.html`, remove API routes from `server.js` |
| `bb1c76b` | **Report sub-navigation** — sidebar shows nested views: All Open, Opening, Processing, Funding, Closing. URL-driven via `?view=` parameter. | Revert `reports.html` to remove sub-items |
| `8767ea2` | **Fees Total replaces Consideration** — all report API routes and display updated from `Consideration` to `Fees Total` column. | Change `"Fees Total"` back to `"Consideration"` in `server.js` API routes and `reports.html` |

### UX Fixes

| Commit | Change | Rollback risk |
|--------|--------|---------------|
| `a5b2a5e` | **Reports nav link fixed** — top nav "Reports" link on all pages pointed to `#`, now points to `/reports` | None — only correct behavior |
| `486b5a5` | **Dashboard Reports links fixed** — sidebar Reports link and Morning Reports tool card on dashboard now point to `/reports`. Tool card badge changed from "Coming Soon" to "Live". | Revert `index.html` |
| `799da63` | **Collapsible Reports sub-nav** — chevron toggle on Reports sidebar item expands/collapses sub-items | Revert `reports.html` sub-item wrapper |
| `4d79f50` | **Reports toggle no-reload** — clicking Reports to toggle sub-items no longer refreshes the page | Change `href` back to `/reports` from `javascript:void(0)` |

### API Routes Added (server.js)

| Route | Method | Source View | Columns Used |
|-------|--------|-------------|-------------|
| `/api/dre-lookup` | POST | External (DRE website proxy) | license_id |
| `/api/reports/pipeline-summary` | GET | `cae.gold_vw_escrow_complete` | Bin Phase, Fees Total |
| `/api/reports/open-escrows` | GET | `cae.gold_vw_escrow_complete` | Escrow Number, Open Date, Bin Phase, Property Address, Escrow Officer, Listing Agent 1, Selling Agent 1, Fees Total, Tasks Completed, Tasks Total, Number of Days |
| `/api/reports/officer-workload` | GET | `cae.gold_vw_escrow_complete` | Escrow Officer, Bin Phase, Fees Total |

### Environment Variables (Railway)

| Variable | Purpose |
|----------|---------|
| `PG_HOST` | PostgreSQL host (currently `mainline.proxy.rlwy.net`) |
| `PG_PORT` | PostgreSQL port (currently `39594`) |
| `PG_DATABASE` | Database name (`mpower`) |
| `PG_USER` | Database user (`postgres`) |
| `PG_PASSWORD` | Database password (in vault) |
| `BASE_URL` | OAuth callback base (`https://cae-portal-production.up.railway.app`) |
| `GOOGLE_CLIENT_ID` | Google OAuth (in vault) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth (in vault) |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth (in vault) |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth (in vault) |
| `SESSION_SECRET` | Express session encryption |
| `NODE_ENV` | `production` |
| `ALLOWED_EMAILS` | Comma-separated allowed login emails |

### Known Issues

- **Cache propagation** — even with no-cache headers, changes may take 30-60 seconds to appear after deployment due to Railway build/deploy cycle. Hard refresh (`Ctrl+Shift+R`) may be needed during active development.
- **Railway internal DNS** — `mpower-db.railway.internal` did not resolve as expected. Using public TCP proxy (`mainline.proxy.rlwy.net:39594`) instead. Adds latency vs. private networking. Investigate Railway service linking for internal connectivity.
- **Database sync not automated** — Railway PostgreSQL was seeded with a one-time `pg_dump`/`pg_restore`. No automated sync from local. Data is static until manually refreshed.

---

*Created 2026-04-09. Update this log with every production change.*
