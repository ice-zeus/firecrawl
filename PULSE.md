<!-- PULSE-MOD-BEGIN PULSE-017 2026-10-03 — Pulse: single index of every Pulse change in this fork -->
# Pulse changes in this fork

`main` is the official [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) `main` plus a small set of
Pulse changes. Everything Pulse adds can be found three ways:

1. **Commits:** one commit per change ID on top of upstream: `git log --oneline --grep '^PULSE-'`.
2. **Markers:** every changed section is wrapped in comments: `grep -rn 'PULSE-MOD-BEGIN' apps/`.
3. **Register:** the authoritative register (hashes and patches) lives in the private Pulse repository:
   `pulse/upstream-modifications.json` and `pulse/upstream-patches/`.

Full diff against upstream: `git diff upstream/main...main` (after `git remote add upstream https://github.com/firecrawl/firecrawl.git`).

To update from upstream: fetch upstream `main`, rebase the `PULSE-` commits onto it (resolve and review each),
re-record the register in the Pulse repository and rerun its checks before moving `main`.

| ID | Files | Why |
|----|-------|-----|
| PULSE-001 | `apps/api/src/controllers/auth.ts` | Verify signed Pulse tenant identity at native auth precedence, delegate native credentials without bypass, preserve queued ownership |
| PULSE-002 | `apps/api/src/scraper/scrapeURL/engines/fire-engine/index.ts` | Carry tenant and parent identity, proxy stage, required enforcement to private workers, and forward optional per-request routing hints as pulseRouting |
| PULSE-003 | `apps/api/src/scraper/scrapeURL/engines/fire-engine/scrape.ts` `apps/api/src/scraper/scrapeURL/engines/fire-engine/checkStatus.ts` `apps/api/src/scraper/scrapeURL/engines/fire-engine/delete.ts` | Authenticate private worker traffic and propagate routing timeout metadata |
| PULSE-004 | `apps/api/src/index.ts` | Capture verified identity before streaming uploads but preserve upstream validation/auth rejection precedence |
| PULSE-005 | `apps/api/src/__tests__/snips/v2/pulse-compatibility.test.ts` | Gated API happy/failure win conditions for the Pulse proxy; skips must never count as release evidence |
| PULSE-006 | `apps/api/src/lib/pulse-routing.ts` | Bridge to independent Pulse routing without changing public request schemas |
| PULSE-007 | `apps/api/src/lib/error.ts` | Serialize discovery and recovery hints in the native timeout envelope |
| PULSE-008 | `apps/api/src/scraper/scrapeURL/index.ts` | Disable overlapping target attempts and preserve nested routing context |
| PULSE-009 | `apps/api/src/scraper/scrapeURL/engines/fetch/index.ts` | Coordinate native HTML fetches through approved proxy routes |
| PULSE-010 | `apps/api/src/scraper/scrapeURL/engines/utils/downloadFile.ts` | Coordinate native binary and sitemap downloads through approved proxy routes |
| PULSE-011 | `apps/api/src/controllers/v2/scrape.ts` | Return discovery retry guidance only after timeout and a live coordinator check |
| PULSE-012 | `apps/api/src/services/worker/scrape-worker.ts` | Carry tenant and location into native worker downloads |
| PULSE-013 | `apps/api/src/services/worker/nuq-worker-runner.ts` | Defer eligible discovery waiters before worker execution and reject unsupported backends |
| PULSE-014 | `apps/api/src/services/worker/nuq.ts` | Fence PostgreSQL job deferral and delay both direct and RabbitMQ prefetch pickup |
| PULSE-015 | `apps/api/src/__tests__/lib/pulse-routing.test.ts` | Test native timeout serialization without triggering PDF auto-resume |
| PULSE-016 | `apps/api/src/controllers/v2/types.ts` | Accept optional Pulse routing hints in scrape options for the single shared stack |
| PULSE-018 | `apps/api/src/scraper/scrapeURL/lib/request-context.ts` | Requests with `pulse` routing hints neither read from nor write to the shared index cache. |
| PULSE-017 | `PULSE.md` | This index. |
<!-- PULSE-MOD-END PULSE-017 -->
