/** `pnpm --filter @legible/safepay dev:store-stub [-- --plant-bug]` — only when D's real store isn't running. */
import { createStoreStub } from "./store-stub.js";

const port = Number(process.env.PORT ?? (new URL(process.env.STORE_URL ?? "http://localhost:3001").port || 3001));
const plant = process.argv.includes("--plant-bug");
createStoreStub({ plantPaidBeforeCapture: plant }).app.listen(port, () => {
  console.log(`[store-stub] Contract 6 order routes on http://localhost:${port}${plant ? " (planted bug: paid before capture)" : ""}`);
});
