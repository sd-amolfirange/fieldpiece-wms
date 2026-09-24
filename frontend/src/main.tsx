import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import "@/lib/i18n";
import { App } from "@/app/App";

// The app always talks to a real API (backend/demo-server for the demo). MSW is used by unit tests only.

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
