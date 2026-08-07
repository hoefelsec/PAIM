/* The client entry point.
 *
 * The design-system gallery in src/gallery/ stays in the repository as the
 * reference for the token layer, but the application owns the entry point:
 * the browser opens on the routes of docs/07, not on the palette.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./styles/tokens.css";
import App from "./app/App";
import { createQueryClient } from "./app/queries";
import { Router } from "./app/router";

const root = document.getElementById("root");
if (!root) throw new Error("#root is absent");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <Router>
        <App />
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
