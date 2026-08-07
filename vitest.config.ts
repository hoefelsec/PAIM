import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Two suites, one command. The server suite runs in node against
 * `app.inject()`; the client suite needs a DOM, so it runs in jsdom over
 * `test/ui/*.test.tsx`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["test/ui/**/*.test.tsx"],
          setupFiles: ["test/ui/setup.ts"],
        },
      },
    ],
  },
});
