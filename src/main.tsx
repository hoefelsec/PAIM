import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import Gallery from "./gallery/Gallery";

const root = document.getElementById("root");
if (!root) throw new Error("#root is absent");

createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
