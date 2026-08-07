import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  // The service binds to the loopback interface. See docs/10-execution-safety.md §1.
  server: {
    host: "127.0.0.1",
    port: 4401,
    // `npm run dev` runs the Fastify API on 4400 (see src/server/config.ts)
    // alongside this Vite dev server on 4401; the client talks to `/api` as
    // if it were same-origin and Vite forwards it to the real server.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4400",
        changeOrigin: true,
      },
    },
  },
});
