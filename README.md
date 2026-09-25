# .co.uk Domain Drop Research Tool

A Cloudflare-native web app for researching `.co.uk` domains on Nominet's daily drop list. It imports the list, stores and normalises the domains in D1, lets you filter them cheaply on the server, queues **selected** domains for DataForSEO research under cost controls, keeps dated metric snapshots, and helps you build a shortlist and export it.

```
Nominet drop list → import → normalise → D1 → filter/search → select → queue research
  → DataForSEO → dated metrics → Research Score + warnings → shortlist → CSV export
```

Importing never triggers research. Research only runs on domains you select, and only in small, rate-limited batches.

## Stack

| Layer | Technology |
|---|---|
| UI | React 19, Vite, Tailwind CSS v4, React Router, TanStack Query, Recharts |
| API | Cloudflare Worker (Hono router, zod validation) serving the SPA as static assets |
| Data | Cloudflare D1 (SQLite) with SQL migrations |
| Jobs | Cloudflare Cron Triggers (research queue tick + hourly drop-list check) |
| Archive | Cloudflare R2 (raw drop-list files, one object per import) |
| Rate limits | Workers Rate Limiting binding for the expensive endpoints |

KV is not used, because settings and queue state live in D1.

```
Browser (React) ──/api/*──▶ Worker (Hono) ──▶ D1
                                 │  └──────▶ DataForSEO (server-side only)
Cron ──▶ Worker.scheduled ──▶ Nominet drop list ─▶ R2 archive + D1
```

## Repository layout

```
src/                 React app: pages/, components/, hooks/, lib/ (API client, formatting), styles/
shared/              Code used by both sides: filter schema + URL codec, API types, scoring, warnings, heuristics
worker/
  index.ts           fetch + scheduled entry point
  app.ts             Hono app, error handling, security headers
  routes/            HTTP routes (thin: validate → service → JSON)
  services/          import, research queue/processor, domain queries, curation, CSV, settings
  providers/         nominet/ and dataforseo/ adapters behind DropListProvider / SeoProvider interfaces
  jobs/scheduled.ts  cron dispatch
  db/rows.ts         typed row shapes and mappers
  utils/             auth, logging, errors, validation
migrations/          D1 SQL migrations
tests/               Vitest suites that run inside the Workers runtime against a real local D1
scripts/             generate-sample-droplist.mjs (synthetic data for local development)
```

## External APIs: what was verified and what was assumed

The build environment could not reach `registrars.nominet.uk`, `droplists.nominet.uk`, `docs.dataforseo.com` or `api.dataforseo.com` (its egress proxy blocks them). The details below come from the official pages as indexed by search. Anything that could not be confirmed sits in a single adapter file.

### Nominet ([Drop Lists spec](https://registrars.nominet.uk/dragon/data/drop-lists/))
- Nominet publishes the file daily and publicly, with no auth: `https://droplists.nominet.uk/current/uk.csv.gz`, plus `uk.csv.gz.sha256`.
- The file is a gzipped CSV of every `.uk`-namespace domain in pending delete. It includes `.uk`, `.org.uk`, `.me.uk` and so on, and only `.co.uk` is imported.
- Columns are described as the ROID, the domain, and the drop time in UTC.
- **Assumption:** the exact header labels could not be confirmed. `worker/providers/nominet/parse.ts` matches headers tolerantly (for example `Domain`, `Domain Name`, `Drop Time`, `Drop Date`, `ROID`) and falls back to sniffing the content when there is no header row. If Nominet uses different labels, edit `HEADER_ALIASES` in that file.

### DataForSEO v3
All calls are server-side and use HTTP Basic auth with Worker secrets. Every request is a JSON array holding one task, and every response is an envelope `{status_code, tasks:[{status_code, result}]}` where `20000` means success.

| Purpose | Endpoint |
|---|---|
| Backlinks, referring domains, referring pages, rank, spam score | `POST backlinks/summary/live` |
| Organic traffic (ETV), organic keyword count, traffic value | `POST dataforseo_labs/google/domain_rank_overview/live` |
| Top ranking keywords (optional) | `POST dataforseo_labs/google/ranked_keywords/live` |
| Backlink sample, one per referring domain (optional) | `POST backlinks/backlinks/live` |
| Monthly organic history (optional, off by default) | `POST dataforseo_labs/google/historical_rank_overview/live` |
| Connection test / balance (no research cost) | `GET appendix/user_data` |

- UK targeting uses `location_code: 2826` and `language_code: "en"`, both configurable in Settings.
- **All of these are Live (synchronous) endpoints**, and DataForSEO Labs is live-only. So there is no provider task to poll. The "never hold a request open" rule is enforced by the app's own queue instead: `POST /api/research` only inserts jobs, and the cron tick processes a bounded batch. `research_jobs.provider_task_id` is kept for any future task-based endpoints.
- Only `worker/providers/dataforseo/mappers.ts` knows DataForSEO field names. **Assumptions:** status codes `40102` (no results) are treated as empty data, and `402xx` codes (payment or rate limits) pause the queue. Both are handled in `client.ts`.
- `visibility` is stored as `null` because none of the endpoints used provide it. No metric is ever fabricated.

## Local development

Requirements: Node 20+ and npm. `npm ci` works with npm 10 or later. To **add** dependencies, use npm 11 (`npx npm@11 install …`), because npm 10.9 hits an arborist bug with the Vitest peer set.

```bash
git clone <repo> && cd domaindropstool
npm ci
cp .dev.vars.example .dev.vars          # then edit (see below)
npm run db:migrate:local                # applies migrations/ to the local D1 in .wrangler/
npm run dev                             # http://localhost:5173 (Vite + Worker in workerd)
```

Suggested `.dev.vars` for a first run (no DataForSEO cost):

```ini
ENVIRONMENT=development
USE_MOCK_SEO_PROVIDER=true     # deterministic fake metrics, provider name "mock"
# ADMIN_TOKEN=...              # leave unset locally to skip auth; set it to test auth
# DATAFORSEO_LOGIN=...         # real credentials when you are ready
# DATAFORSEO_PASSWORD=...
```

### Importing a drop list locally
- **Real list:** open **Imports → Import latest now**. This downloads from `NOMINET_DROP_LIST_URL`.
- **File upload:** download `uk.csv.gz` yourself, then use **Imports → Upload file…**. Plain `.csv` also works.
- **Synthetic data:** `node scripts/generate-sample-droplist.mjs 5000 sample.csv.gz`, then upload it.

### Running cron jobs locally
Cron Triggers do not fire on their own in `vite dev`. Trigger them by hand:

```bash
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=*/2+*+*+*+*"   # research queue tick
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=20+*+*+*+*"    # drop-list check/import
```

## Quality checks

```bash
npm run typecheck   # tsc -b across app, worker, tests, config
npm run lint        # ESLint (typescript-eslint, react-hooks)
npm test            # Vitest in the Workers runtime with migrations applied to local D1
npm run build       # production build (client assets + worker bundle)
```

The tests cover:
- Nominet parsing: header variants, gzip, CRLF, uppercase, trailing dot, whitespace, duplicates, invalid domains, non-`.co.uk` domains
- Import idempotency, forced re-import, chunking, removed/dropped detection, checksum mismatch, the concurrent-import lock
- The filter-to-SQL builder, URL state and combined filters
- The research queue: creation, dedupe, retries with backoff, failures, auto-pause on provider limits, pause/resume, priority, daily limit, clearing completed jobs
- DataForSEO client and mappers against fixture responses. No real API calls are made.
- Scoring, warnings and API authorisation
- CSV output, including formula-injection escaping

## Deploying to Cloudflare

**Plan:** full-size Nominet imports (hundreds of thousands of rows) need the **Workers Paid** plan, for CPU time and D1 write volume. From 1 September 2026, D1 on the Free plan rejects queries above the daily row limits. On Paid you can raise the CPU ceiling by uncommenting `[limits]` in `wrangler.toml`.

The D1 database `domaindropstool` (ID in `wrangler.toml`, migration `0001` already applied) and the R2 bucket `domaindropstool-droplists` already exist in the Cloudflare account. For a fresh account, run `npx wrangler d1 create domaindropstool` and `npx wrangler r2 bucket create domaindropstool-droplists` first, and put the new ID in `wrangler.toml`.

### Option A: Cloudflare dashboard (Workers Builds)
1. Go to **Workers & Pages → Create → Import a repository**, then pick `heybmtn/domaindropstool` and the branch `main`.
2. Set the **Build command** to `npm run build` and the **Deploy command** to `npx wrangler deploy`.
3. After the first deploy, go to **Settings → Variables and Secrets** and add `ADMIN_TOKEN` (a long random string) with type **Secret**. Add `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` the same way when you have them. Variables under **Settings → Build** are build-time only and never reach the running Worker.
4. Open the `*.workers.dev` URL, go to **Settings → Admin access**, paste the same token, then use **Imports → Import latest now**. The hourly cron also imports new lists automatically.

### Option B: CLI
```bash
npx wrangler login
npx wrangler secret put ADMIN_TOKEN             # long random string
npx wrangler secret put DATAFORSEO_LOGIN        # optional until you research
npx wrangler secret put DATAFORSEO_PASSWORD
npm run db:migrate:remote
npm run deploy                                  # vite build + wrangler deploy
```

### Access control
Read-only pages are public at the Worker URL. Every admin operation needs `Authorization: Bearer <ADMIN_TOKEN>`: imports, research, notes, shortlist changes, saved filters and settings. You can enter the token under **Settings → Admin access**, which stores it in that browser only. Without the `ADMIN_TOKEN` secret, admin operations are refused in production. To add login-based protection later, extend `worker/utils/auth.ts`.

### GitHub → Cloudflare
`.github/workflows/ci.yml` runs typecheck, lint, tests and build on every push and PR. On `main` it also applies D1 migrations and deploys, but only when the repository secrets `CLOUDFLARE_API_TOKEN` (with Workers, D1 and R2 edit permissions) and `CLOUDFLARE_ACCOUNT_ID` exist.

### Where each value lives

| Name | Local (`.dev.vars`) | Production | GitHub Actions |
|---|---|---|---|
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | yes | `wrangler secret put` | no |
| `ADMIN_TOKEN` | optional | `wrangler secret put` | no |
| `NOMINET_DROP_LIST_URL` | optional | `[vars]` in wrangler.toml | no |
| `USE_MOCK_SEO_PROVIDER` | optional | never | no |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | no | no | repository secrets |

`.dev.vars` and `.env` are git-ignored, and no credential is ever sent to the browser. `/api/settings` reports only whether DataForSEO is *configured*.

## How it works

### Import (cron hourly at :20, or `POST /api/import`)
Large lists are imported in bounded steps, so no single Worker invocation has to do everything:
1. **Prepare.** Fetch `uk.csv.gz.sha256` and skip the import if that checksum already has a completed import. Otherwise download the file, verify its SHA-256, archive it to R2, and stream-parse it once. Each row is normalised (trim, lowercase, strip the trailing dot), validated, filtered to `.co.uk`, deduplicated, and staged in `import_chunks` (5,000 rows per chunk).
2. **Load.** Chunks are upserted in order, and progress (`chunks_done`) is saved after each one. An HTTP import loads for up to 15 seconds and then returns "started". The two-minute cron keeps loading, about 40 seconds per tick, until every chunk is done. The Imports page shows the progress.
3. **Finalise.** Mark listed domains that are missing from the file: `dropped` if their drop time has passed, otherwise `removed`. Then record the counts and complete the batch.

If an import stops making progress for 30 minutes, it is marked `failed`. **Previous data always stays available**, and re-running is safe: upserts are idempotent and `domains.domain` is UNIQUE.

**Drop times:** Nominet publishes each drop time in UTC, to the second. The app keeps the exact instant in `domains.drop_time`. `drop_date`, "today"/"tomorrow" and the date filters are UK calendar days, and every time is shown in UK time (BST/GMT) with the UTC time on hover. The domain list sorts by exact drop time within each day.

### Research queue (cron every 2 minutes)
- `POST /api/research` only enqueues. It dedupes active jobs, skips domains researched in the last 24 hours unless forced, caps each request (`maxEnqueuePerRequest`), and requires a confirmed count for "Research All Filtered".
- Each tick does the following:
  - Reclaims stuck jobs.
  - Stops if the queue is paused, if no provider is configured, or if the **daily domain limit** is reached.
  - Otherwise it atomically claims up to `batchSize` jobs, highest priority first, and processes them with `concurrency` parallelism.
- Each domain uses 2 required calls (backlinks summary and domain overview). Keywords, backlinks and history are optional extra calls.
- Every completed job inserts a **new dated `domain_metrics` snapshot**, so nothing is overwritten. It also refreshes the denormalised `latest_*` columns used for fast filtering and sorting.
- Retryable errors back off exponentially (60s, 120s, …) up to `maxAttempts`, then the job becomes `failed`. **Provider rate-limit or balance errors pause the whole queue** with a visible reason, and the unprocessed jobs return to pending.
- "Clear completed" deletes job rows only. Metrics are kept.

### Research Score (`shared/scoring.ts`)
The score is a transparent 0–100 prioritisation number, **not a valuation**.
- Each SEO input earns up to its weight on a log scale, and reaches the full weight at a reference value. The defaults are: Referring Domains 30 (at 1,000), Organic Traffic 25 (at 10k), Backlinks 15 (at 50k), Organic Keywords 10 (at 5k), and Traffic Value 5 (at $10k).
- A short-domain bonus of up to 15 applies at 5 characters or fewer, tapering to 0 at 15.
- There is a 2-point penalty per hyphen and per digit.
- The total is clamped to 0–100.

The domain page shows every line of the breakdown, and you can change the weights in **Settings → Scoring**.

### Warnings and heuristics
The warnings are neutral prompts for manual review:
- the backlink-to-referring-domain ratio
- keyword concentration
- a significant historical decline
- stale metrics
- insufficient data
- a failed research job
- an elevated provider spam score

Local heuristics (length, digits, hyphens, number and vowel ratio, and common-word matches from a small bundled list) are labelled as heuristics.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/stats` | dashboard counters |
| GET | `/api/domains` | filters, `sort`, `dir`, `page`, `pageSize` (≤200) |
| GET | `/api/domains/count` | count for a filter |
| GET | `/api/domains/:id` | detail, analysis, score breakdown, warnings |
| GET | `/api/domains/:id/metrics` \| `/keywords` \| `/backlinks` | history and latest captures |
| GET/POST | `/api/domains/:id/notes` | PUT/DELETE `/api/domains/:id/notes/:noteId` (admin) |
| POST | `/api/domains/status` | bulk user status (admin) |
| POST | `/api/research` | enqueue by `domainIds` or `filter` + `confirmCount` (admin, rate-limited) |
| GET | `/api/research/queue`, `/api/research/jobs` | queue state and jobs |
| POST | `/api/research/pause` \| `resume` \| `retry-failed` \| `clear-completed` \| `jobs/:id/retry` | admin |
| POST | `/api/import` | import the latest Nominet list (`?force=true`), admin, rate-limited |
| POST | `/api/import/upload` | raw CSV / `.csv.gz` body (admin, rate-limited) |
| GET | `/api/import/history`, `/api/import/:id` | import batches |
| GET/POST | `/api/filters` | PUT/DELETE `/api/filters/:id` (writes are admin) |
| GET/POST | `/api/shortlist` | DELETE `/api/shortlist/:domainId` (writes are admin) |
| GET | `/api/export?scope=selected&ids=…` \| `scope=filter&…` \| `scope=shortlist` | streamed CSV |
| GET/PUT | `/api/settings` | PUT is admin; `POST /api/settings/dataforseo/test` (admin) |

Filters in URLs use short aliases, so any view can be bookmarked: `/domains?drop=today&maxLength=15&minRD=20&hasHyphen=false`.

## Known limitations
- A live Nominet download, real DataForSEO calls and a Cloudflare deployment **have not been executed** from the build environment, because its network egress blocks those hosts. Everything else was verified locally against workerd and local D1, including a browser walkthrough.
- Partial ("contains") search uses `LIKE '%term%'`, which scans the table. That is fine for hundreds of thousands of rows with debounced input. A trigram FTS index would be the next step if it ever becomes slow.
- Sorting the whole listed set by an SEO metric (for example, Referring Domains) uses a temporary sort. Combining it with the `Researched` filter, the usual workflow, keeps that set small because of the `research_status` index.
- Only `.co.uk` is enabled. Other TLDs need a new `TldPolicy` in `shared/domain.ts`.
