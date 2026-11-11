import { CONTRACTS_VERSION, Health } from "@legible/contracts";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(Health.parse({ ok: true, service: "dashboard", version: "0.1.0", contractsVersion: CONTRACTS_VERSION }));
}
