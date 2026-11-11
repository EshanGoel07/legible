/**
 * The scanner's ONLY door to an LLM. Any OpenAI-compatible provider (Gemini free tier, Groq, …),
 * configured only by env: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL. The key is never logged.
 *
 * callTool(): forces one function call (tool_choice names the function) and validates the arguments with Zod.
 * If the provider ignores the forced tool choice (or returns bad arguments), it falls back to JSON mode
 * plus Zod validation, with one repair retry. 429/5xx are retried with exponential backoff (max 5 retries).
 */
import OpenAI from "openai";
import type { z } from "zod";

export type LlmConfig = { baseURL: string; apiKey: string; model: string };

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const baseURL = env.LLM_BASE_URL ?? "";
  const apiKey = env.LLM_API_KEY ?? "";
  const model = env.LLM_MODEL ?? "";
  if (!baseURL || !apiKey || !model) throw new Error("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set (see .env.example)");
  return { baseURL, apiKey, model };
}

/** The slice of the OpenAI client we use, so tests can pass a fake. */
export type ChatClient = { chat: { completions: { create(body: any): Promise<any> } } };

export type ToolSpec<T> = {
  name: string;
  description: string;
  /** JSON Schema for the function parameters (what the model sees) */
  parameters: Record<string, unknown>;
  /** Zod schema the arguments must pass (what we trust) */
  schema: z.ZodType<T>;
};

export type LlmStats = { calls: number; retries: number; forcedToolOk: number; jsonFallbacks: number; repairs: number };

export class Llm {
  readonly stats: LlmStats = { calls: 0, retries: 0, forcedToolOk: 0, jsonFallbacks: 0, repairs: 0 };
  private readonly client: ChatClient;

  constructor(
    readonly model: string,
    client: ChatClient,
    private readonly opts: { maxRetries?: number; baseDelayMs?: number; log?: (m: string) => void } = {},
  ) {
    this.client = client;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, log?: (m: string) => void): Llm {
    const cfg = llmConfigFromEnv(env);
    // maxRetries: 0 — retries are ours (backoff + logging), not the SDK's.
    return new Llm(cfg.model, new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, maxRetries: 0, timeout: Number(env.LLM_TIMEOUT_MS ?? 60_000) }), { log });
  }

  /** chat.completions.create with exponential backoff on 429 / 5xx / network errors. */
  async create(body: Record<string, unknown>): Promise<any> {
    const max = this.opts.maxRetries ?? 5;
    const base = this.opts.baseDelayMs ?? 2000;
    for (let attempt = 0; ; attempt++) {
      try {
        this.stats.calls++;
        return await this.client.chat.completions.create({ model: this.model, ...body });
      } catch (e: any) {
        const status: number | undefined = typeof e?.status === "number" ? e.status : undefined;
        // Timeouts are APIConnectionTimeoutError, a subclass of APIConnectionError (their .name is just "Error").
        const retryable = e instanceof OpenAI.APIConnectionError || status === 429 || (status !== undefined && status >= 500);
        if (!retryable || attempt >= max) throw e;
        const retryAfter = Number(e?.headers?.get?.("retry-after"));
        // Never shorter than the exponential step: a tiny retry-after (Groq TPM says "1.9s") would burn all retries inside one minute.
        const wait = Math.max(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0, base * 2 ** attempt) + Math.random() * 500;
        this.stats.retries++;
        this.opts.log?.(`LLM ${status ?? (e instanceof OpenAI.APIConnectionTimeoutError ? "timeout" : "network error")}; retry ${attempt + 1}/${max} in ${(wait / 1000).toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  /** Force one call of `tool`; returns its validated arguments. */
  async callTool<T>(system: string, user: string, tool: ToolSpec<T>): Promise<T> {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    let problem = "";
    try {
      const res = await this.create({
        messages,
        temperature: 0,
        tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }],
        tool_choice: { type: "function", function: { name: tool.name } },
      });
      const call = res?.choices?.[0]?.message?.tool_calls?.find((c: any) => c?.type === "function" && c.function?.name === tool.name);
      if (call) {
        const parsed = tool.schema.safeParse(safeJson(call.function.arguments));
        if (parsed.success) {
          this.stats.forcedToolOk++;
          return parsed.data;
        }
        problem = `tool arguments failed validation: ${issues(parsed.error)}`;
      } else {
        problem = "provider returned no forced tool call";
      }
    } catch (e: any) {
      // 400 = provider rejected tools/tool_choice; anything else (auth, exhausted retries) is fatal.
      if (e?.status !== 400) throw e;
      problem = `provider rejected forced tool_choice (HTTP 400)`;
    }

    this.stats.jsonFallbacks++;
    this.opts.log?.(`${tool.name}: ${problem}; falling back to JSON mode`);
    return this.callJson(system, user, tool);
  }

  /** JSON mode + Zod validation, one repair retry. */
  async callJson<T>(system: string, user: string, tool: ToolSpec<T>): Promise<T> {
    const sys = `${system}\n\nReply with ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(tool.parameters)}`;
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: sys },
      { role: "user", content: user },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.create({ messages, temperature: 0, response_format: { type: "json_object" } });
      const text: string = res?.choices?.[0]?.message?.content ?? "";
      const parsed = tool.schema.safeParse(safeJson(stripFences(text)));
      if (parsed.success) return parsed.data;
      if (attempt === 0) {
        this.stats.repairs++;
        messages.push({ role: "assistant", content: text }, { role: "user", content: `That JSON is invalid: ${issues(parsed.error)}. Reply with the corrected JSON object only.` });
      } else {
        throw new Error(`${tool.name}: LLM output failed validation after repair: ${issues(parsed.error)}`);
      }
    }
    throw new Error("unreachable");
  }
}

const safeJson = (s: unknown) => {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
const issues = (e: z.ZodError) => e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
