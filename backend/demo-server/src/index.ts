import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DemoDb } from "./core/index";
import { API_BASE, createApp } from "./app";
import { createFileSessionStore, loadState, saveState } from "./persistence";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DEMO_DATA_DIR ?? join(root, "data");
const statePath = join(dataDir, "state.json");
const port = Number(process.env.PORT ?? 4000);
const serveFrontend = process.argv.includes("--serve-frontend");
const staticDir = join(root, "..", "..", "frontend", "dist");

// "Today" in the business time zone, as the backend's APP_TIMEZONE (default America/Los_Angeles).
const timeZone = process.env.APP_TIMEZONE ?? "America/Los_Angeles";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const db: DemoDb = {
  state: loadState(statePath, today.format(new Date())),
  onChange: (state) => saveState(statePath, state),
  today: () => today.format(new Date()),
  // Email intake is off (404) unless a shared secret is set, as in the backend.
  inboundEmailSecret: process.env.INBOUND_EMAIL_SECRET || undefined,
};

const app = createApp({
  db,
  sessions: createFileSessionStore(join(dataDir, "sessions.json")),
  uploadsDir: join(dataDir, "uploads"),
  staticDir: serveFrontend ? staticDir : undefined,
});

app.listen(port, () => {
  console.log(`Fieldpiece Warranty mock API on http://localhost:${port}${API_BASE}`);
  console.log(`Data: ${statePath}`);
  if (serveFrontend) {
    console.log(
      existsSync(join(staticDir, "index.html"))
        ? `Demo app on http://localhost:${port}`
        : "No frontend build found: run `npm run demo` instead.",
    );
  } else {
    console.log("Frontend: run `npm run dev` in frontend/ and open http://localhost:5173");
  }
});
