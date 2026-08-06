import { createApp } from "./app.js";
import { HOST, PORT } from "./config.js";

const app = createApp();

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`PAIM server listening at ${address}`);
});
