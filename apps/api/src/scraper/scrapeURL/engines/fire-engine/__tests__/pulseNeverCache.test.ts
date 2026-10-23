// PULSE-MOD-BEGIN PULSE-002 2026-10-22 — Pulse: a worker result whose anti-bot inspection says never_cache must not be index-cached, and its inspection reaches this scrape's cache write and document.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchFake = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
}));

vi.mock("../../../lib/fetch", () => ({
  robustFetch: vi.fn(async () => fetchFake.status),
}));

import {
  pulseScrapeSignals,
  pulseWithScrapeSignals,
} from "../../../../../lib/pulse-routing";
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

describe("Pulse worker inspection on the way to the cache write and the document", () => {
  const page = {
    timeTaken: 1, content: "<html></html>", pageStatusCode: 200,
    responseHeaders: { "content-type": "text/html" },
  };

  // An inspection only travels in a deployment that configures the private
  // worker integration: that is the deployment whose worker returns one, and
  // the only one for which pulseWithScrapeSignals opens its frame. Setting it
  // adds pulseContext to the request body, which the mocked fetch ignores.
  const previous = process.env.PULSE_INTEGRATION_MODULE;
  beforeEach(() => {
    process.env.PULSE_INTEGRATION_MODULE = "integration";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.PULSE_INTEGRATION_MODULE;
    else process.env.PULSE_INTEGRATION_MODULE = previous;
  });

  it("hands the finished attempt's inspection on and lets the next attempt replace it", async () => {
    const warnings = [
      { code: "ACTION_SUBMISSION_MAY_BE_LOST", actionIndex: 2, checkpointIndex: 1 },
    ];
    await pulseWithScrapeSignals(async () => {
      fetchFake.status = {
        ...page,
        meta: { pulseInspection: { schema_version: 1, never_cache: false, warnings } },
      };
      await scrapeURLWithFireEngineTLSClient(fakeMeta());
      expect(pulseScrapeSignals()).toEqual({ neverCache: false, inspected: true, warnings });

      fetchFake.status = { ...page };
      await scrapeURLWithFireEngineTLSClient(fakeMeta());
      expect(pulseScrapeSignals()).toEqual({ neverCache: false, inspected: false, warnings: [] });
    });
  });
});
// PULSE-MOD-END PULSE-002
