import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveConfig, type EnvLike } from "./api/client";
import "./styles.css";

const config = resolveConfig(import.meta.env as EnvLike);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
);
