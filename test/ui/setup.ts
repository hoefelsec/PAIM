/* Shared setup for the jsdom suite: unmount between tests so one test's
 * document never reaches the next. */

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
