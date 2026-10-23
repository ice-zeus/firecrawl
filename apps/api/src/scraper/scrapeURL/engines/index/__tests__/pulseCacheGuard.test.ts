// PULSE-MOD-BEGIN PULSE-019 2026-10-22 — Pulse: results the private worker never inspected are evaluated before the shared index cache keeps them.
const guard = vi.hoisted(() => ({
  allowed: true as boolean,
  inspected: false,
  calls: [] as unknown[],
}));

vi.mock("../../../../../services", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../../../services")>()),
  useIndex: true,
  saveIndexToGCS: vi.fn(async () => {}),
  addIndexInsertJob: vi.fn(async () => {}),
  addOMCEJob: vi.fn(async () => {}),
}));

vi.mock("../../../../../lib/pulse-routing", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../../../lib/pulse-routing")>()),
  pulseScrapeSignals: vi.fn(() => ({
    neverCache: false, inspected: guard.inspected, warnings: [],
  })),
  pulseCacheAllowed: vi.fn(async (input: unknown) => {
    guard.calls.push(input);
    return guard.allowed;
  }),
}));

import { config } from "../../../../../config";
import { sendDocumentToIndex } from "../index";

const logger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child() { return this; },
} as any;

function cacheableScrape(winnerEngine: string) {
  const document = {
    markdown: "Example",
    rawHtml: "<html>Example</html>",
    metadata: {
      sourceURL: "https://example.com/",
      url: "https://example.com/",
      statusCode: 403,
      contentType: "text/html",
    },
  } as any;
  const meta = {
    url: "https://example.com/",
    winnerEngine,
    featureFlags: new Set<string>(),
    options: { formats: ["markdown"], storeInCache: true },
    internalOptions: { teamId: "team-id", isParse: false, zeroDataRetention: false },
    logger,
  } as any;
  return { meta, document };
}

describe("Pulse index-cache guard", () => {
  const writeOnly = config.FIRECRAWL_INDEX_WRITE_ONLY;
  beforeEach(() => {
    (config as { FIRECRAWL_INDEX_WRITE_ONLY?: boolean }).FIRECRAWL_INDEX_WRITE_ONLY = false;
    guard.allowed = true;
    guard.inspected = false;
    guard.calls = [];
  });
  afterEach(() => {
    (config as { FIRECRAWL_INDEX_WRITE_ONLY?: boolean }).FIRECRAWL_INDEX_WRITE_ONLY = writeOnly;
  });

  it("evaluates an uninspected result and keeps it when the evaluator allows it", async () => {
    const { meta, document } = cacheableScrape("playwright");
    await sendDocumentToIndex(meta, document);
    expect(guard.calls).toEqual([{
      url: "https://example.com/", status: 403,
      html: "<html>Example</html>", contentType: "text/html",
    }]);
    expect(document.metadata.indexId).toBeDefined();
  });

  it("keeps an uninspected result out of the cache on a deny, a timeout or an error", async () => {
    guard.allowed = false;
    const { meta, document } = cacheableScrape("playwright");
    const result = await sendDocumentToIndex(meta, document);
    expect(result).toBe(document);
    expect(document.metadata.indexId).toBeUndefined();
  });

  it("does not evaluate a result the private worker already inspected", async () => {
    guard.allowed = false;
    guard.inspected = true;
    const { meta, document } = cacheableScrape("fire-engine;chrome-cdp");
    await sendDocumentToIndex(meta, document);
    expect(guard.calls).toEqual([]);
    expect(document.metadata.indexId).toBeDefined();
  });

  it("evaluates a result whose winning engine did not come from the worker", async () => {
    guard.allowed = false;
    guard.inspected = true;
    const { meta, document } = cacheableScrape("playwright");
    await sendDocumentToIndex(meta, document);
    expect(guard.calls).toHaveLength(1);
    expect(document.metadata.indexId).toBeUndefined();
  });

  it("never runs when the native decision already refuses to cache", async () => {
    const { meta, document } = cacheableScrape("playwright");
    meta.options.storeInCache = false;
    await sendDocumentToIndex(meta, document);
    expect(guard.calls).toEqual([]);
    expect(document.metadata.indexId).toBeUndefined();
  });
});
// PULSE-MOD-END PULSE-019
