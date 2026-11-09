import { createMockApp } from "./app.js";

const port = Number(process.env.PORT ?? (new URL(process.env.SAFEPAY_URL ?? "http://localhost:3003").port || 3003));

createMockApp().listen(port, () => {
  console.log(`safepay MOCK listening on http://localhost:${port} (canned responses, no PayPal calls)`);
});
