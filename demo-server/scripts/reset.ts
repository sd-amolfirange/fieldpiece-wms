import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Deletes saved demo state, sessions and uploads. The next start reloads the seed.
// With the server running, use Admin -> Simulate -> Reset demo data instead.

const dataDir = process.env.DEMO_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
console.log(`Removed ${dataDir}. Start the server to load the seed data.`);
