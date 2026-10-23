// PULSE-MOD-BEGIN PULSE-006 2026-10-23 — Pulse: narrow authenticated bridge to independent adaptive routing and to the anti-bot cache decision.
import { AsyncLocalStorage } from "node:async_hooks";
import { ScrapeJobTimeoutError } from "./error";

export const pulseRoutingEnabled = () => process.env.PULSE_ADAPTIVE_ROUTING === "true";
// Keep preparation failures out of customer-controlled job data. Native job
// execution consumes them before any target access, inside its cleanup path.
const preparationErrors = new WeakMap<object, Error>();
export function pulseSetPreparationError(job: object, error: unknown): void {
  preparationErrors.set(job, error instanceof Error ? error : new Error("ROUTING_UNAVAILABLE"));
}
export function pulseThrowPreparationError(job: object): void {
  const error = preparationErrors.get(job);
  preparationErrors.delete(job);
  if (error) throw error;
}
function bridge(): any {
  const path = process.env.PULSE_ROUTING_MODULE;
  if (!path || !process.env.PULSE_WORKER_TOKEN || !process.env.PULSE_INTEGRATION_MODULE) {
    throw new Error("Pulse routing bridge and tenant integration must both be configured");
  }
  return require(path);
}

export function pulseRoutingTimeout(status: any): ScrapeJobTimeoutError | undefined {
  if (!pulseRoutingEnabled()) return;
  const p = status?.pulseRoutingTimeout;
  const discovery = p?.reason === "DOMAIN_DISCOVERY_IN_PROGRESS" && p?.state === "domain_discovery_in_progress";
  const recovery = p?.reason === "DOMAIN_RECOVERY_IN_PROGRESS" && p?.state === "domain_recovery_in_progress";
  if ((discovery || recovery) && p.retryAfterSeconds === 180 && typeof p.message === "string") {
    return new ScrapeJobTimeoutError(p.message, { reason: p.reason, state: p.state, retryAfterSeconds: 180 });
  }
}

export async function pulseDecorateTimeout(error: unknown, tenantId: string, scrapeId: string): Promise<unknown> {
  if (!pulseRoutingEnabled() || (error as any)?.code !== "SCRAPE_TIMEOUT") return error;
  if ((error as any).processing) return error;
  try { return pulseRoutingTimeout(await bridge().timeoutStatus(tenantId, scrapeId)) ?? error; }
  catch { return error; }
}

export function withPulseRoutingContext<T>(value: unknown, run: () => Promise<T>): Promise<T> {
  return pulseRoutingEnabled() ? bridge().withContext(value, run) : run();
}
export function pulseRoutingIdentity(tenantId: string): { tenantId: string; parentScrapeId?: string } {
  const current = pulseRoutingEnabled() ? bridge().requestContext() : undefined;
  return { tenantId: current?.tenantId ?? tenantId, parentScrapeId: current?.rootId };
}
export function pulseFallbackList<T>(list: T[]): T[] {
  return pulseRoutingEnabled() ? bridge().fallbackList(list) : list;
}
export async function pulseTargetFetch(url: string, init: any, undici: any, skipTlsVerification = false): Promise<any> {
  if (!pulseRoutingEnabled()) return undici.fetch(url, init);
  try { return await bridge().targetFetch(url, init, undici, skipTlsVerification); }
  catch (error) { throw pulseRoutingTimeout(error) ?? error; }
}
export async function pulsePrepareJob(job: unknown): Promise<{ state: string; retryAfterSeconds?: number }> {
  const data = (job as any)?.data;
  if (pulseRoutingEnabled() && data?.crawl_id && data.crawlerOptions && data.crawlerOptions.ignoreRobotsTxt !== true) {
    // Crawl admission already checked robots. Re-check the stored policy before
    // any autonomous probe; absent/cancelled state follows native processing.
    const { getCrawl } = await import("./crawl-redis.js");
    const crawl = await getCrawl(data.crawl_id);
    if (!crawl || crawl.cancelled || crawl.robots === undefined) return { state: "foreground_required" };
    const { createRobotsChecker, isUrlAllowedByRobots } = await import("./robots-txt.js");
    if (!isUrlAllowedByRobots(data.url, createRobotsChecker(data.url, crawl.robots).robots)) {
      return { state: "foreground_required" };
    }
  }
  return pulseRoutingEnabled() ? bridge().prepareJob(job) : { state: "ready" };
}

/** Per-scrape anti-bot signals. Native downloads reach no Meta of their own, so
 * the call sites raise what they learn here, and the index-cache write and the
 * document build read it once the winning engine is known. One box per scrapeURL
 * call: a nested robots/sitemap scrape gets its own, so a nested finding never
 * changes the parent document. */
type PulseScrapeSignals = { neverCache: boolean; inspected: boolean; warnings: unknown[] };
const scrapeSignals = new AsyncLocalStorage<PulseScrapeSignals>();

export function pulseWithScrapeSignals<T>(run: () => Promise<T>): Promise<T> {
  // A deployment that configures no Pulse module can raise no signal, and
  // pulseScrapeSignals() already answers with an empty box outside a frame, so
  // it pays for no async-context propagation at all. Integration without
  // adaptive routing still gets a frame: the private worker can return an
  // inspection, and its warning has to reach the document.
  if (!pulseRoutingEnabled() && !process.env.PULSE_INTEGRATION_MODULE && !process.env.PULSE_ANTIBOT_MODULE) {
    return run();
  }
  return scrapeSignals.run({ neverCache: false, inspected: false, warnings: [] }, run);
}
export function pulseScrapeSignals(): PulseScrapeSignals {
  return scrapeSignals.getStore() ?? { neverCache: false, inspected: false, warnings: [] };
}
/** True only when the authenticated worker marked this very response never-cache. */
export function pulseNeverCache(response: unknown): boolean {
  if (!pulseRoutingEnabled()) return false;
  try { return bridge().neverCache?.(response) === true; } catch { return false; }
}
export function pulseNoteNeverCache(response: unknown): void {
  const signals = scrapeSignals.getStore();
  if (signals && pulseNeverCache(response)) signals.neverCache = true;
}
/** The worker inspection of the attempt that just finished. Engines run one at a
 * time and the last one that returns owns the document, so each note replaces the
 * previous one instead of accumulating. */
export function pulseNoteInspection(inspection: unknown): void {
  const signals = scrapeSignals.getStore();
  if (!signals) return;
  const warnings = (inspection as { warnings?: unknown } | null | undefined)?.warnings;
  signals.inspected = inspection !== undefined && inspection !== null;
  signals.warnings = Array.isArray(warnings) ? [...warnings] : [];
}

const PULSE_SUBMISSION_MAY_BE_LOST = "ACTION_SUBMISSION_MAY_BE_LOST";
/** Maps the one known worker warning code to its fixed sentence and appends it
 * the way Firecrawl appends its own warnings. Unknown codes are ignored and
 * worker text is never copied into a customer document. */
export function pulseAppendWarnings(existing: string | undefined, warnings: unknown): string | undefined {
  let warning = existing;
  for (const entry of Array.isArray(warnings) ? warnings : []) {
    const { code, actionIndex } = (entry ?? {}) as { code?: unknown; actionIndex?: unknown };
    if (code !== PULSE_SUBMISSION_MAY_BE_LOST || typeof actionIndex !== "number" || !Number.isInteger(actionIndex)) {
      continue;
    }
    const sentence = `A security check appeared after action ${actionIndex} and was solved; the form submission made by that action may not have reached the site.`;
    warning = warning ? warning + " " + sentence : sentence;
  }
  return warning;
}

/** Applies what this scrape learned, just before the transformers run: the
 * never-cache verdict of a native fetch or download, and the known warning
 * codes of the winning result. Only a private worker engine can carry a
 * warning, so a document from any other winner is left alone. */
export function pulseApplyScrapeSignals(
  options: { storeInCache?: boolean },
  document: { warning?: string },
  engine: string,
): void {
  const signals = pulseScrapeSignals();
  if (signals.neverCache) options.storeInCache = false;
  if (String(engine).startsWith("fire-engine")) {
    document.warning = pulseAppendWarnings(document.warning, signals.warnings);
  }
}

type PulseCacheInput = { url: string; status: number; html: string; contentType?: string };
type PulseCacheGuard = { shouldCache(input: PulseCacheInput): Promise<boolean>; close(): Promise<void> };
const denyCacheGuard: PulseCacheGuard = { shouldCache: async () => false, close: async () => {} };
let cacheGuard: PulseCacheGuard | null | undefined;
const warned = new Set<string>();
/** Refusing to cache is the safe answer, but it must never be a silent one: an
 * operator whose module is misconfigured would otherwise see the index quietly
 * stop filling. One warning per process per reason, never per page. */
function warnCacheGuardOnce(reason: string, error: unknown): void {
  if (warned.has(reason)) return;
  warned.add(reason);
  process.emitWarning(
    `Pulse index-cache guard ${reason}: ${error instanceof Error ? error.message : String(error)}. ` +
      "Results without trusted worker inspection are not being cached.",
  );
}

function cacheGuardOptions(): { workers?: number; budgetMs?: number } {
  const positive = (value: string | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  return {
    workers: positive(process.env.PULSE_ANTIBOT_CACHE_WORKERS),
    budgetMs: positive(process.env.PULSE_ANTIBOT_CACHE_BUDGET_MS),
  };
}
/** The independent evaluator behind the index-cache write, created once per
 * process; null when no module is configured, which is the deployment default.
 * A module that cannot be created denies caching rather than letting unchecked
 * pages into the shared index. */
export function pulseCacheGuard(): PulseCacheGuard | null {
  if (cacheGuard === undefined) {
    const path = process.env.PULSE_ANTIBOT_MODULE;
    if (!path) {
      cacheGuard = null;
    } else {
      try {
        cacheGuard = require(path).createCacheGuard(cacheGuardOptions()) ?? denyCacheGuard;
      } catch (error) {
        warnCacheGuardOnce("could not be created", error);
        cacheGuard = denyCacheGuard;
      }
    }
  }
  return cacheGuard;
}
/** Fail-safe: a deny, a timeout, a worker crash or any other error means "do not
 * cache". With no guard configured the native decision stands. */
export async function pulseCacheAllowed(input: PulseCacheInput): Promise<boolean> {
  const guard = pulseCacheGuard();
  if (!guard) return true;
  try {
    return (await guard.shouldCache(input)) === true;
  } catch (error) {
    warnCacheGuardOnce("failed to evaluate a page", error);
    return false;
  }
}
// PULSE-MOD-END PULSE-006
