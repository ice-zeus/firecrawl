import type { Meta } from "..";

export function hasCustomRequestContext(
  // PULSE-MOD-BEGIN PULSE-018 2026-10-03 — Pulse: routing hints select an engine/persona, so such results must not be read from or written to the shared index cache.
  options: Pick<Meta["options"], "headers" | "actions" | "profile" | "pulse">,
  // PULSE-MOD-END PULSE-018
): boolean {
  return (
    Object.keys(options.headers ?? {}).length > 0 ||
    (options.actions?.length ?? 0) > 0 ||
    // PULSE-MOD-BEGIN PULSE-018 2026-10-03 — Pulse: routing hints select an engine/persona, so such results must not be read from or written to the shared index cache.
    options.pulse !== undefined ||
    // PULSE-MOD-END PULSE-018
    options.profile !== undefined
  );
}
