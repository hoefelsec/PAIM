import { createApp } from "./app.js";

const PORT = 4400;

const app = createApp();

app.listen({ port: PORT }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`PAIM server listening at ${address}`);
});
