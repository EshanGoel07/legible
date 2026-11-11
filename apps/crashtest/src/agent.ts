/**
 * The agent under test: an LLM tool-use loop over the site's MCP tools.
 * Stops when the model answers without calling a tool, or after maxSteps LLM calls.
 * `afterTool` lets the harness react to a tool result (e.g. approve a PayPal payment) and tell the agent what happened.
 */
export type AgentTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type ToolResult = { text: string; isError: boolean };
type ChatMessage = { content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> };

export type AgentDeps = {
  chat: (messages: unknown[], tools: unknown[]) => Promise<ChatMessage>;
  tools: AgentTool[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  afterTool?: (name: string, args: Record<string, unknown>, result: ToolResult) => Promise<string | null>;
  maxSteps?: number;
  log?: (m: string) => void;
};

export type TranscriptEntry =
  | { step: number; kind: "tool"; tool: string; args: Record<string, unknown>; isError: boolean; result: string; note?: string }
  | { step: number; kind: "answer"; text: string };

export type AgentRun = { steps: number; stoppedBy: "answer" | "max_steps" | "error"; final: string | null; error: string | null; transcript: TranscriptEntry[] };

export const AGENT_SYSTEM_PROMPT = `You are an AI shopping agent for an online store. Use only the provided tools.
- Use ids exactly as tools return them; never invent ids. Sizes are like S, M, L.
- To pay, call the checkout tool once the cart is exactly right. A human approves payments in PayPal; you will be told the outcome.
- If a tool error is your mistake (e.g. a missing field), fix it. If the store fails (HTTP 5xx), or a payment is blocked or declined, do not work around it: stop.
- Finish with a 1-3 sentence summary of what happened. Do not ask questions.`;

/** Provider-side rejection of the model's tool-call arguments (not a site failure). */
export const INVALID_TOOL_CALL = /tool call validation failed|did not match schema|invalid tool call|Failed to call a function/i;
export const MAX_TOOL_REPAIRS = 2;

/** Keep tool results small: free tiers count every token of history. */
export const clip = (s: string, n = 1500) => (s.length > n ? `${s.slice(0, n)}… [truncated ${s.length - n} chars]` : s);
const compact = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
};

export async function runAgent(task: string, deps: AgentDeps): Promise<AgentRun> {
  const maxSteps = deps.maxSteps ?? 25;
  const tools = deps.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } }));
  const messages: unknown[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: task },
  ];
  const transcript: TranscriptEntry[] = [];
  let repairs = 0;

  for (let step = 1; step <= maxSteps; step++) {
    let msg: ChatMessage;
    try {
      msg = await deps.chat(messages, tools);
    } catch (e) {
      // Some providers (e.g. Groq) validate the model's tool arguments server-side and reject the whole request
      // (HTTP 400) when the model sends e.g. null for an optional number. That is the model's mistake, not the site's:
      // tell it what was wrong and let it try again (max MAX_TOOL_REPAIRS per run).
      const m = (e as Error).message ?? "";
      if (INVALID_TOOL_CALL.test(m) && repairs < MAX_TOOL_REPAIRS) {
        repairs++;
        deps.log?.(`step ${step}: provider rejected the model's tool call (${m.slice(0, 140)}); asking it to retry (${repairs}/${MAX_TOOL_REPAIRS})`);
        messages.push({ role: "user", content: `Your last tool call was rejected: ${m.slice(0, 300)}\nOmit optional parameters instead of sending null, use the documented types, and try again.` });
        continue;
      }
      return { steps: step, stoppedBy: "error", final: null, error: (e as Error).message, transcript };
    }
    const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
    if (!calls.length) {
      const text = (msg.content ?? "").trim();
      transcript.push({ step, kind: "answer", text });
      return { steps: step, stoppedBy: "answer", final: text, error: null, transcript };
    }
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.function.name, arguments: c.function.arguments } })) });

    for (const c of calls) {
      let args: Record<string, unknown> = {};
      let result: ToolResult;
      try {
        args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        result = await deps.callTool(c.function.name, args);
      } catch (e) {
        result = { text: `Error: ${(e as Error).message}`, isError: true };
      }
      const note = (await deps.afterTool?.(c.function.name, args, result)) ?? undefined;
      deps.log?.(`step ${step}: ${c.function.name}(${JSON.stringify(args)}) → ${result.isError ? "ERROR " : ""}${result.text.replace(/\s+/g, " ").slice(0, 120)}${note ? ` | ${note}` : ""}`);
      transcript.push({ step, kind: "tool", tool: c.function.name, args, isError: result.isError, result: clip(result.text, 4000), ...(note ? { note } : {}) });
      messages.push({ role: "tool", tool_call_id: c.id, content: clip(compact(result.text)) + (note ? `\n\n${note}` : "") });
    }
  }
  return { steps: maxSteps, stoppedBy: "max_steps", final: null, error: null, transcript };
}
