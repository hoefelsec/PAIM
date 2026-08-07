/* Shared setup for the jsdom suite: unmount between tests so one test's
 * document never reaches the next. */

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { installEventSource } from "./harness";

/**
 * jsdom has no `EventSource` (test/ui/harness.tsx `MockEventSource`
 * documents why). Every screen behind `Shell` opens one (src/app/events.tsx,
 * T22), so a suite that never mentions live updates still needs a stand-in
 * or mounting the shell throws. A case that cares about the stream installs
 * its own via `installEventSource()` and drives it directly; this default
 * one just sits there.
 */
beforeEach(() => {
  installEventSource();
});

afterEach(() => {
  cleanup();
});
