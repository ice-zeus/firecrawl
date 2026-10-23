// PULSE-MOD-BEGIN PULSE-010 2026-10-22 — Pulse: native downloads raise the worker's never_cache verdict on the scrape that owns them.
import { promises as fs } from "node:fs";
import { ReadableStream } from "node:stream/web";

const routing = vi.hoisted(() => ({
  responses: [] as unknown[],
  noted: [] as unknown[],
}));

vi.mock("../../../../lib/pulse-routing", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../../lib/pulse-routing")>()),
  pulseTargetFetch: vi.fn(async () => routing.responses.shift()),
  pulseNoteNeverCache: vi.fn((response: unknown) => {
    routing.noted.push(response);
  }),
}));

import { downloadFile, fetchFileToBuffer } from "./downloadFile";

function fakeResponse() {
  return {
    status: 200,
    headers: new Headers([["content-type", "application/pdf"]]),
    arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7").buffer,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("%PDF-1.7"));
        controller.close();
      },
    }),
  };
}

describe("Pulse never_cache on native downloads", () => {
  beforeEach(() => {
    routing.responses = [];
    routing.noted = [];
  });

  it("raises the verdict of a buffered download", async () => {
    const response = fakeResponse();
    routing.responses.push(response);
    const result = await fetchFileToBuffer("https://example.com/file.pdf");
    expect(result.buffer.toString()).toBe("%PDF-1.7");
    expect(routing.noted).toHaveLength(1);
    expect(routing.noted[0]).toBe(response);
  });

  it("raises the verdict of a streamed download", async () => {
    const response = fakeResponse();
    routing.responses.push(response);
    const result = await downloadFile("scrape-id", "https://example.com/file.pdf");
    expect(result.tempFilePath).toContain("tempFile-scrape-id--");
    expect(routing.noted).toHaveLength(1);
    expect(routing.noted[0]).toBe(response);
    await fs.unlink(result.tempFilePath);
  });
});
// PULSE-MOD-END PULSE-010
