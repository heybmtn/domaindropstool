# CLAUDE.md

Guidance for AI assistants working in this repository. See README.md for product and deployment docs.

## Commands
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run build`: run all four before committing.
- `npm run dev`: Vite + Worker locally. You need `.dev.vars` (copy `.dev.vars.example`) and `npm run db:migrate:local` first.
- Trigger cron locally: `curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=*/2+*+*+*+*"` (research tick) or `cron=20+*+*+*+*` (import).
- To add dependencies use `npx npm@11 install …`. npm 10.9 crashes on the Vitest peer set, but `npm ci` is fine with either version.

## Architecture rules
- **Routes are thin**: validate with zod (`worker/utils/validate.ts`), call a service, return JSON. No SQL and no provider calls in routes.
- **Providers are isolated**. The rest of the app knows only `DropListProvider` and `SeoProvider` from `worker/providers/types.ts`. Nominet CSV details live in `providers/nominet/parse.ts`. DataForSEO field names live only in `providers/dataforseo/mappers.ts`. `providers/index.ts` is the only place that reads provider config from env.
- **`shared/` is imported by both the Worker and React.** It holds the filter schema and URL codec, the API DTOs, scoring, warnings and heuristics. Keep it free of runtime-specific APIs.
- **SQL is always parameterised.** Column names come from whitelists (`worker/services/domainQuery.ts`). Bulk operations bind one JSON parameter and use `json_each(?)`, which avoids D1's 100-bound-parameter limit.
- **Schema changes go in a new migration** (`migrations/000N_*.sql`). Never edit an applied migration.
- `domains.latest_*` columns are denormalised from the newest `domain_metrics` row so the list can filter and sort with no joins. Update them whenever a snapshot is written (`researchProcessor.storeResearch`).
- Every research run **inserts** a `domain_metrics` row. Never update or delete snapshots. Clearing jobs must not touch metrics.

## Cost-safety invariants (do not break)
- Importing must never enqueue research.
- `POST /api/research` only inserts jobs. It is capped by `maxEnqueuePerRequest`, and filter-based requests need `confirmCount`.
- Provider calls happen only in `researchTick` (cron), bounded by `batchSize`, `concurrency`, `dailyDomainLimit` and `maxAttempts`, and gated by the pause flag.
- A `ProviderError` with `pauseQueue` pauses the whole queue and releases the claimed jobs.
- Unit tests must never call real external APIs. Use the fixtures in `tests/fixtures/` and injected `fetch`.

## Security
- Secrets (`DATAFORSEO_*`, `ADMIN_TOKEN`) are Worker secrets. Never return them from the API or log them. `worker/utils/logger.ts` redacts sensitive keys.
- Every mutating or expensive route uses `requireAdmin` (Cloudflare Access JWT or a bearer token). It fails closed outside development.
- Notes are plain text: render them as React text and never with `dangerouslySetInnerHTML`. CSV cells are escaped against formula injection.

## Conventions
- Strict TypeScript. No `any`, and use `import type` for types.
- Errors shown to users are `AppError` with a safe message. Unexpected errors are logged with a `requestId` and returned as a generic 500.
- Use UK English in UI copy. The score is always called "Research Score", never a value or valuation.
- Tests run in the Workers runtime (`@cloudflare/vitest-pool-workers`), with migrations applied in `tests/setup.ts`. Use `tests/helpers.ts` (`resetDatabase`, `seedDomains`).
