// PULSE-MOD-BEGIN PULSE-009 2026-10-22 — Pulse: a native fetch the worker marked never_cache must not be index-cached.
const routing = vi.hoisted(() => ({ neverCache: false }));

vi.mock("../../../../../lib/pulse-routing", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../../../lib/pulse-routing")>()),
  pulseTargetFetch: vi.fn(async () => ({
    url: "https://example.com/",
    status: 403,
    headers: new Headers([["content-type", "text/html"]]),
    arrayBuffer: async () => new TextEncoder().encode("<html></html>").buffer,
  })),
  pulseNeverCache: vi.fn(() => routing.neverCache),
}));

import { scrapeURLWithFetch } from "..";

const logger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child() { return this; },
} as any;

function fakeMeta() {
  return {
    id: "scrape-id",
    url: "https://example.com/",
    options: { formats: [], storeInCache: true },
    internalOptions: { teamId: "team-id" },
    featureFlags: new Set<string>(),
    logger,
    mock: null,
    abort: { asSignal: () => undefined, throwIfAborted: () => {}, scrapeTimeout: () => undefined },
  } as any;
}

describe("Pulse never_cache on the native fetch engine", () => {
  it.each([
    [true, false],
    [false, true],
  ])("a never_cache verdict of %s leaves storeInCache %s", async (neverCache, storeInCache) => {
    routing.neverCache = neverCache;
    const meta = fakeMeta();
    const result = await scrapeURLWithFetch(meta);
    expect(result.statusCode).toBe(403);
    expect(result.html).toBe("<html></html>");
    expect(meta.options.storeInCache).toBe(storeInCache);
  });
});
// PULSE-MOD-END PULSE-009
