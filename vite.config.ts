import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  // The service binds to the loopback interface. See docs/10-execution-safety.md §1.
  server: { host: "127.0.0.1", port: 4401 },
});
