// PULSE-MOD-BEGIN PULSE-005 2026-09-26 — Pulse: external proxy win conditions, explicitly gated until a qualified fleet is available.
import { describe, it, expect } from "vitest";
import { scrapeTimeout } from "./lib";

const origin = process.env.PULSE_COMPATIBILITY_TEST_URL;
const key = process.env.PULSE_COMPATIBILITY_TEST_KEY;
const target = process.env.PULSE_COMPATIBILITY_FIXTURE_URL;

describe.skipIf(!origin || !key || !target)("Pulse public compatibility", () => {
  it("accepts an unchanged scrape request and preserves the Firecrawl document", async () => {
    const res = await fetch(`${origin}/v2/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: target, formats: ["markdown"], maxAge: 0 }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.markdown).toBe("string");
    expect(body.data.metadata).toBeDefined();
  }, scrapeTimeout);

  it("keeps malformed JSON ahead of invalid credentials", async () => {
    const res = await fetch(`${origin}/v2/scrape`, {
      method: "POST",
      headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      code: "BAD_REQUEST_INVALID_JSON",
      error: "Bad request, malformed JSON",
    });
  }, scrapeTimeout);
});
// PULSE-MOD-END PULSE-005
