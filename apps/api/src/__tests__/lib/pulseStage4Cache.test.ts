// PULSE-MOD-BEGIN PULSE-006 2026-10-23 — Pulse: the bridge's Stage 4 cache verdicts and the one customer-visible worker warning.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Bridge = typeof import("../../lib/pulse-routing");

const SENTENCE = (index: number) =>
  `A security check appeared after action ${index} and was solved; the form submission made by that action may not have reached the site.`;

const directory = mkdtempSync(join(tmpdir(), "pulse-stage4-"));
let fixtures = 0;
/** Writes a throwaway CommonJS module and points an environment variable at it,
 * the way an operator points the bridge at the independent Pulse packages. */
function fixture(variable: string, source: string): void {
  const path = join(directory, `fixture-${(fixtures += 1)}.cjs`);
  writeFileSync(path, source);
  process.env[variable] = path;
}

const environment = [
  "PULSE_ADAPTIVE_ROUTING", "PULSE_ROUTING_MODULE", "PULSE_WORKER_TOKEN",
  "PULSE_INTEGRATION_MODULE", "PULSE_ANTIBOT_MODULE",
  "PULSE_ANTIBOT_CACHE_WORKERS", "PULSE_ANTIBOT_CACHE_BUDGET_MS",
];

describe("Pulse Stage 4 cache verdicts and warnings", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(async () => {
    for (const name of environment) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    vi.resetModules();
  });
  afterEach(() => {
    for (const name of environment) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  // The explicit extension is what node16/nodenext requires of a dynamic
  // import, and vite-node resolves it back to the .ts source, as this suite's
  // other fresh-module tests do (for example refreshBudget.test.ts).
  const load = (): Promise<Bridge> => import("../../lib/pulse-routing.js");

  function routingFixture(marked: string): void {
    process.env.PULSE_ADAPTIVE_ROUTING = "true";
    process.env.PULSE_WORKER_TOKEN = "token";
    process.env.PULSE_INTEGRATION_MODULE = "integration";
    fixture(
      "PULSE_ROUTING_MODULE",
      `module.exports = { neverCache: response => response === ${marked} };`,
    );
  }

  describe("the possibly-lost-submission warning", () => {
    const lost = (actionIndex: number) => ({
      code: "ACTION_SUBMISSION_MAY_BE_LOST", actionIndex, checkpointIndex: 0,
    });

    it("stands alone when the document carries no warning yet", async () => {
      const { pulseAppendWarnings } = await load();
      expect(pulseAppendWarnings(undefined, [lost(2)])).toBe(SENTENCE(2));
    });
    it("is appended to an existing warning with a single space", async () => {
      const { pulseAppendWarnings } = await load();
      expect(pulseAppendWarnings("Branding was skipped.", [lost(0)])).toBe(
        `Branding was skipped. ${SENTENCE(0)}`,
      );
    });
    it("adds one sentence per occurrence", async () => {
      const { pulseAppendWarnings } = await load();
      expect(pulseAppendWarnings(undefined, [lost(1), lost(4)])).toBe(
        `${SENTENCE(1)} ${SENTENCE(4)}`,
      );
    });
    it.each([
      ["an unknown code", [{ code: "SOMETHING_ELSE", actionIndex: 1 }]],
      ["free worker text", [{ code: "ACTION_SUBMISSION_MAY_BE_LOST", message: "do not copy me" }]],
      ["a non-integer index", [{ code: "ACTION_SUBMISSION_MAY_BE_LOST", actionIndex: "1" }]],
      ["an empty list", []],
      ["a malformed payload", "not-a-list"],
      ["a null entry", [null]],
    ])("ignores %s", async (_name, warnings) => {
      const { pulseAppendWarnings } = await load();
      expect(pulseAppendWarnings("Original.", warnings)).toBe("Original.");
      expect(pulseAppendWarnings(undefined, warnings)).toBeUndefined();
    });
  });

  describe("never_cache raised by a native transport", () => {
    it("is false without the routing bridge, even for a marked response", async () => {
      const bridge = await load();
      expect(bridge.pulseNeverCache("marked")).toBe(false);
    });
    it("reads the verdict of the authenticated worker response", async () => {
      routingFixture('"marked"');
      const bridge = await load();
      expect(bridge.pulseNeverCache("marked")).toBe(true);
      expect(bridge.pulseNeverCache("other")).toBe(false);
    });
    it("is false when the routing module has no verdict to give", async () => {
      process.env.PULSE_ADAPTIVE_ROUTING = "true";
      process.env.PULSE_WORKER_TOKEN = "token";
      process.env.PULSE_INTEGRATION_MODULE = "integration";
      fixture("PULSE_ROUTING_MODULE", "module.exports = {};");
      const bridge = await load();
      expect(bridge.pulseNeverCache("marked")).toBe(false);
    });
    it("raises the verdict on this scrape's signals", async () => {
      routingFixture('"marked"');
      const bridge = await load();
      await bridge.pulseWithScrapeSignals(async () => {
        bridge.pulseNoteNeverCache("other");
        expect(bridge.pulseScrapeSignals().neverCache).toBe(false);
        bridge.pulseNoteNeverCache("marked");
        expect(bridge.pulseScrapeSignals().neverCache).toBe(true);
      });
    });
    it("does not leak out of its scrape, and is harmless without one", async () => {
      routingFixture('"marked"');
      const bridge = await load();
      await bridge.pulseWithScrapeSignals(async () => {
        await bridge.pulseWithScrapeSignals(async () => bridge.pulseNoteNeverCache("marked"));
        expect(bridge.pulseScrapeSignals().neverCache).toBe(false);
      });
      expect(() => bridge.pulseNoteNeverCache("marked")).not.toThrow();
      expect(bridge.pulseScrapeSignals()).toEqual({ neverCache: false, inspected: false, warnings: [] });
    });
  });

  describe("the worker inspection of the attempt that just finished", () => {
    it("replaces the previous attempt's inspection instead of accumulating", async () => {
      const bridge = await load();
      const warnings = [{ code: "ACTION_SUBMISSION_MAY_BE_LOST", actionIndex: 3 }];
      await bridge.pulseWithScrapeSignals(async () => {
        bridge.pulseNoteInspection({ schema_version: 1, warnings });
        expect(bridge.pulseScrapeSignals()).toEqual({ neverCache: false, inspected: true, warnings });
        bridge.pulseNoteInspection({ schema_version: 1 });
        expect(bridge.pulseScrapeSignals()).toEqual({ neverCache: false, inspected: true, warnings: [] });
        bridge.pulseNoteInspection(undefined);
        expect(bridge.pulseScrapeSignals()).toEqual({ neverCache: false, inspected: false, warnings: [] });
      });
    });
  });

  describe("the index-cache guard", () => {
    const page = { url: "https://example.com/", status: 403, html: "<html></html>", contentType: "text/html" };

    it("has no guard and no opinion while no Pulse module is configured", async () => {
      const bridge = await load();
      expect(bridge.pulseCacheGuard()).toBeNull();
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(true);
    });
    it("caches a page the evaluator accepts and passes the operator's budget", async () => {
      process.env.PULSE_ANTIBOT_CACHE_WORKERS = "2";
      process.env.PULSE_ANTIBOT_CACHE_BUDGET_MS = "80";
      fixture("PULSE_ANTIBOT_MODULE", `
        exports.createCacheGuard = options => ({
          options, shouldCache: async input => input.status === 200, close: async () => {},
        });`);
      const bridge = await load();
      expect((bridge.pulseCacheGuard() as any).options).toEqual({ workers: 2, budgetMs: 80 });
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(false);
      await expect(bridge.pulseCacheAllowed({ ...page, status: 200 })).resolves.toBe(true);
    });
    it("ignores unusable budget settings and creates the guard once", async () => {
      process.env.PULSE_ANTIBOT_CACHE_WORKERS = "nonsense";
      process.env.PULSE_ANTIBOT_CACHE_BUDGET_MS = "0";
      fixture("PULSE_ANTIBOT_MODULE", `
        let created = 0;
        exports.createCacheGuard = options => ({
          options, created: (created += 1), shouldCache: async () => true, close: async () => {},
        });`);
      const bridge = await load();
      expect((bridge.pulseCacheGuard() as any).options).toEqual({ workers: undefined, budgetMs: undefined });
      expect((bridge.pulseCacheGuard() as any).created).toBe(1);
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(true);
    });
    it.each([
      ["a timeout or any rejection", "shouldCache: async () => { throw new Error('budget exceeded'); }"],
      ["a non-boolean answer", "shouldCache: async () => undefined"],
      ["a worker that crashes synchronously", "shouldCache: () => { throw new Error('worker crashed'); }"],
    ])("refuses to cache on %s", async (_name, body) => {
      fixture("PULSE_ANTIBOT_MODULE", `exports.createCacheGuard = () => ({ ${body}, close: async () => {} });`);
      const bridge = await load();
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(false);
    });
    it.each([
      ["cannot be loaded", "throw new Error('broken module');"],
      ["has no guard to give", "exports.createCacheGuard = () => undefined;"],
    ])("refuses to cache when the configured module %s", async (_name, source) => {
      fixture("PULSE_ANTIBOT_MODULE", source);
      const bridge = await load();
      expect(bridge.pulseCacheGuard()).not.toBeNull();
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(false);
    });
  });

  describe("opening the per-scrape frame", () => {
    it("does not open one, and costs no async context, while no Pulse module is configured", async () => {
      const bridge = await load();
      await bridge.pulseWithScrapeSignals(async () => {
        bridge.pulseNoteInspection({ schema_version: 1, warnings: [] });
        expect(bridge.pulseScrapeSignals()).toEqual({ neverCache: false, inspected: false, warnings: [] });
      });
    });
    it.each([
      ["adaptive routing", "PULSE_ADAPTIVE_ROUTING", "true"],
      ["worker integration without routing", "PULSE_INTEGRATION_MODULE", "integration"],
      ["the anti-bot module", "PULSE_ANTIBOT_MODULE", "antibot"],
    ])("opens one for a deployment that configures %s", async (_name, variable, value) => {
      process.env[variable] = value;
      const bridge = await load();
      await bridge.pulseWithScrapeSignals(async () => {
        bridge.pulseNoteInspection({ schema_version: 1, warnings: [] });
        expect(bridge.pulseScrapeSignals().inspected).toBe(true);
      });
    });
  });

  describe("applying the verdicts to the finished document", () => {
    const lost = [{ code: "ACTION_SUBMISSION_MAY_BE_LOST", actionIndex: 1, checkpointIndex: 0 }];

    it("turns off the index-cache write when a native transport raised never_cache", async () => {
      routingFixture('"marked"');
      const bridge = await load();
      await bridge.pulseWithScrapeSignals(async () => {
        const options = { storeInCache: true };
        bridge.pulseNoteNeverCache("marked");
        bridge.pulseApplyScrapeSignals(options, {}, "pdf");
        expect(options.storeInCache).toBe(false);
      });
    });
    it("leaves an untouched scrape alone", async () => {
      process.env.PULSE_ANTIBOT_MODULE = "antibot";
      const bridge = await load();
      await bridge.pulseWithScrapeSignals(async () => {
        const options = { storeInCache: true };
        const document: { warning?: string } = {};
        bridge.pulseApplyScrapeSignals(options, document, "fire-engine;chrome-cdp");
        expect(options.storeInCache).toBe(true);
        expect(document.warning).toBeUndefined();
      });
    });
    it.each([
      ["fire-engine;chrome-cdp", true],
      ["fire-engine(retry);chrome-cdp;stealth", true],
      ["fire-engine;tlsclient", true],
      ["playwright", false],
      ["pdf", false],
      ["index", false],
    ])("shows the warning of a %s winner: %s", async (engine, shown) => {
      process.env.PULSE_ANTIBOT_MODULE = "antibot";
      const bridge = await load();
      await bridge.pulseWithScrapeSignals(async () => {
        const document: { warning?: string } = { warning: "Branding was skipped." };
        bridge.pulseNoteInspection({ schema_version: 1, warnings: lost });
        bridge.pulseApplyScrapeSignals({ storeInCache: true }, document, engine);
        expect(document.warning).toBe(
          shown ? `Branding was skipped. ${SENTENCE(1)}` : "Branding was skipped.",
        );
      });
    });
  });

  describe("a misconfigured guard is never silent", () => {
    const page = { url: "https://example.com/", status: 403, html: "<html></html>", contentType: "text/html" };
    // Typed loosely on purpose: process.emitWarning is overloaded, so a spy's
    // precise instance type is not worth pinning in a test.
    let emitted: any;
    beforeEach(() => {
      emitted = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    });
    afterEach(() => {
      emitted.mockRestore();
    });

    it("warns once per process when the configured module cannot be created", async () => {
      fixture("PULSE_ANTIBOT_MODULE", "throw new Error('broken module');");
      const bridge = await load();
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(false);
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(false);
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(String(emitted.mock.calls[0][0])).toContain("could not be created");
    });
    it("warns once per process when the evaluator fails, and not per page", async () => {
      fixture(
        "PULSE_ANTIBOT_MODULE",
        "exports.createCacheGuard = () => ({ shouldCache: async () => { throw new Error('budget exceeded'); }, close: async () => {} });",
      );
      const bridge = await load();
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(false);
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(false);
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(String(emitted.mock.calls[0][0])).toContain("failed to evaluate a page");
    });
    it("says nothing while no module is configured", async () => {
      const bridge = await load();
      await expect(bridge.pulseCacheAllowed(page)).resolves.toBe(true);
      expect(emitted).not.toHaveBeenCalled();
    });
  });
});
// PULSE-MOD-END PULSE-006
