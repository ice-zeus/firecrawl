// PULSE-MOD-BEGIN PULSE-006 2026-09-28 — Pulse: narrow authenticated bridge to independent adaptive routing.
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
// PULSE-MOD-END PULSE-006
