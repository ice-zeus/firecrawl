// PULSE-MOD-BEGIN PULSE-002 2026-10-14 — Pulse: a worker result whose anti-bot inspection says never_cache must not be index-cached.
import { describe, expect, it, vi } from "vitest";

const fetchFake = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
}));

vi.mock("../../../lib/fetch", () => ({
  robustFetch: vi.fn(async () => fetchFake.status),
}));

import {
  scrapeURLWithFireEngineChromeCDP,
  scrapeURLWithFireEngineTLSClient,
} from "..";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child() {
    return this;
  },
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
    abort: {
      asSignal: () => undefined,
      throwIfAborted: () => {},
      scrapeTimeout: () => undefined,
    },
    imageOcrEnabled: async () => false,
  } as any;
}

describe.each([
  ["chrome-cdp", scrapeURLWithFireEngineChromeCDP],
  ["tlsclient", scrapeURLWithFireEngineTLSClient],
])("Pulse never_cache in the %s worker response", (_, scrape) => {
  it.each([
    [{ pulseInspection: { schema_version: 1, never_cache: true } }, false],
    [{ pulseInspection: { schema_version: 1, never_cache: false } }, true],
    [undefined, true],
  ])("meta %j leaves storeInCache %s", async (workerMeta, storeInCache) => {
    fetchFake.status = {
      timeTaken: 1,
      content: "<html></html>",
      pageStatusCode: 403,
      responseHeaders: { "content-type": "text/html" },
      ...(workerMeta ? { meta: workerMeta } : {}),
    };
    const meta = fakeMeta();
    await scrape(meta);
    expect(meta.options.storeInCache).toBe(storeInCache);
  });
});
// PULSE-MOD-END PULSE-002
