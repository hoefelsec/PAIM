import { createApp } from "./app.js";
import { HOST, PORT } from "./config.js";
import { openDatabase } from "./db/index.js";
import { startTrashSweep } from "./tasks/sweep.js";
import { logCredentialStatus } from "./ai/client.js";

// Opened (and migrated) before the listener starts, so a migration failure
// stops the process instead of failing the first request.
const db = openDatabase();
const app = createApp({ db });

// docs/06 "The trash": a sweep on startup and every 24 h.
startTrashSweep(db);

// specs/07-ai-compose.md: logs once at startup when no Anthropic credential
// is available; AI endpoints (added in later tasks) gate on aiAvailable().
logCredentialStatus();

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`PAIM server listening at ${address}`);
});
