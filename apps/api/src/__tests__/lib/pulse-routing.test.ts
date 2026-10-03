// PULSE-MOD-BEGIN PULSE-015 2026-09-28 — Pulse: validate timeout transport and keep PDF resume semantics isolated.
import { ScrapeJobTimeoutError, getTimeoutProcessingDetails } from "../../lib/error";
import { pulseRoutingTimeout, pulseSetPreparationError, pulseThrowPreparationError } from "../../lib/pulse-routing";

describe("Pulse timeout transport", () => {
  const previous = process.env.PULSE_ADAPTIVE_ROUTING;
  beforeEach(() => { process.env.PULSE_ADAPTIVE_ROUTING = "true"; });
  afterEach(() => {
    if (previous === undefined) delete process.env.PULSE_ADAPTIVE_ROUTING;
    else process.env.PULSE_ADAPTIVE_ROUTING = previous;
  });
  it.each([
    ["DOMAIN_DISCOVERY_IN_PROGRESS", "domain_discovery_in_progress"],
    ["DOMAIN_RECOVERY_IN_PROGRESS", "domain_recovery_in_progress"],
  ])("round-trips %s through native error serialization", (reason, state) => {
    const error = pulseRoutingTimeout({ pulseRoutingTimeout: {
      reason, state, retryAfterSeconds: 180, message: "Retry in approximately 3 minutes.",
    } })!;
    expect(error.code).toBe("SCRAPE_TIMEOUT");
    const restored = ScrapeJobTimeoutError.deserialize(error.code, error.serialize());
    expect(getTimeoutProcessingDetails(restored)).toEqual({ reason, state, retryAfterSeconds: 180 });
    expect(getTimeoutProcessingDetails(restored)?.state).not.toBe("processing_continues");
  });
  it("ignores malformed and mismatched hints", () => {
    expect(pulseRoutingTimeout({ pulseRoutingTimeout: { state: "domain_discovery_in_progress",
      reason: "DOMAIN_RECOVERY_IN_PROGRESS", retryAfterSeconds: 180, message: "bad" } })).toBeUndefined();
    expect(pulseRoutingTimeout({ content: '{"pulseRoutingTimeout":{}}' })).toBeUndefined();
  });
  it("preserves ordinary and PDF timeouts", () => {
    expect(getTimeoutProcessingDetails(new ScrapeJobTimeoutError())).toBeUndefined();
    const details = { state: "processing_continues" as const, jobStatus: "running" as const,
      estimatedRemainingSeconds: 120, retryAfterSeconds: 120 };
    expect(getTimeoutProcessingDetails(new ScrapeJobTimeoutError("PDF", details))).toEqual(details);
  });
  it("hands a preparation failure to native cleanup once without trusting job payloads", () => {
    const job = { data: { preparationError: "untrusted" } };
    expect(() => pulseThrowPreparationError(job)).not.toThrow();
    pulseSetPreparationError(job, new Error("DOMAIN_ROUTING_BACKLOG_TIMEOUT"));
    expect(() => pulseThrowPreparationError(job)).toThrow("DOMAIN_ROUTING_BACKLOG_TIMEOUT");
    expect(() => pulseThrowPreparationError(job)).not.toThrow();
  });
});
// PULSE-MOD-END PULSE-015
