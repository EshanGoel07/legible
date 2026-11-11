/**
 * Stage 2 — Describe (LLM). One forced tool call per route: should an agent get it, what is it called,
 * what does it take, how risky is it. Inputs come back as a flat list (portable across providers that
 * dislike free-form nested JSON Schema); we build the tool's JSON Schema from them deterministically.
 */
import { z } from "zod";
import type { DiscoveredRoute } from "./discover.js";
import type { AnswerCache } from "./cache.js";
import type { Llm, ToolSpec } from "./llm.js";

export const RouteDescription = z.object({
  expose: z.boolean(),
  exposeReason: z.string().min(1),
  name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  description: z.string().min(5).max(200),
  inputs: z.array(
    z.object({
      name: z.string().min(1),
      in: z.enum(["path", "query", "body"]),
      type: z.enum(["string", "number", "integer", "boolean"]),
      required: z.boolean(),
      description: z.string().optional(),
    }),
  ),
  risk: z.enum(["read", "write", "money"]),
  riskReason: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type RouteDescription = z.infer<typeof RouteDescription>;

export const SYSTEM_PROMPT = `You turn one HTTP route of a website into a tool definition for an AI shopping agent. Call describe_route exactly once.
- expose: false for routes an agent must not call directly: health checks, routes only another backend service calls (e.g. a payment service recording or updating orders), and routes that only serve the site's own web page. Otherwise true.
- name: snake_case verb_noun an agent would understand, e.g. search_products, add_to_cart.
- description: one sentence for the agent: what it does and what it returns.
- inputs: every path param (in=path, required=true), query param (in=query) and JSON body field (in=body) the handler reads. Nothing else.
- risk: read = changes nothing; write = changes state but moves no money; money = starts, authorizes or records a payment or a paid order.
- confidence: 0..1, how sure you are about expose and risk together.`;

export const DESCRIBE_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    expose: { type: "boolean", description: "Should an AI agent get this route as a tool?" },
    exposeReason: { type: "string", description: "One short sentence" },
    name: { type: "string", description: "snake_case tool name, verb_noun" },
    description: { type: "string", description: "One sentence for the agent" },
    inputs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          in: { type: "string", enum: ["path", "query", "body"] },
          type: { type: "string", enum: ["string", "number", "integer", "boolean"] },
          required: { type: "boolean" },
          description: { type: "string" },
        },
        required: ["name", "in", "type", "required"],
      },
    },
    risk: { type: "string", enum: ["read", "write", "money"] },
    riskReason: { type: "string", description: "One short sentence" },
    confidence: { type: "number", description: "0..1" },
  },
  required: ["expose", "exposeReason", "name", "description", "inputs", "risk", "riskReason", "confidence"],
} as const;

export const DESCRIBE_TOOL: ToolSpec<RouteDescription> = {
  name: "describe_route",
  description: "Describe one HTTP route as an agent tool.",
  parameters: DESCRIBE_TOOL_PARAMETERS as unknown as Record<string, unknown>,
  schema: RouteDescription,
};

/** Small user message: route line, comment, handler, referenced declarations. Truncated to stay under free-tier limits. */
export function routePrompt(r: DiscoveredRoute): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…` : s);
  return [
    `${r.method} ${r.path}`,
    `File: ${r.file}:${r.line}`,
    r.comment ? `Comment: ${r.comment}` : "",
    `Handler:\n${clip(r.handlerSource, 1800)}`,
    r.context.length ? `Referenced declarations:\n${clip(r.context.join("\n"), 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function describeRoute(llm: Llm, r: DiscoveredRoute, cache?: AnswerCache): Promise<RouteDescription> {
  const user = routePrompt(r);
  const key = [llm.model, SYSTEM_PROMPT, JSON.stringify(DESCRIBE_TOOL_PARAMETERS), user];
  const hit = cache?.get(key);
  if (hit !== undefined) {
    const parsed = RouteDescription.safeParse(hit);
    if (parsed.success) return parsed.data;
  }
  const d = await llm.callTool(SYSTEM_PROMPT, user, DESCRIBE_TOOL);
  cache?.set(key, d);
  return d;
}
