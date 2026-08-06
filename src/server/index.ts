import { createApp } from "./app.js";
import { HOST, PORT } from "./config.js";
import { openDatabase } from "./db/index.js";

// Opened (and migrated) before the listener starts, so a migration failure
// stops the process instead of failing the first request.
const app = createApp({ db: openDatabase() });

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`PAIM server listening at ${address}`);
});
