import type { FastifyInstance } from "fastify";
import type { RuntimeDiagnosticProfile, RuntimeHealthResponse, RuntimeLogEntry, RuntimeProfile, RuntimeTestChatRequest, RuntimeTestChatResponse, RuntimeState } from "@obsidianlm/shared";
import type { RuntimeManager } from "../runtime/manager.js";
import { getProfile, isLlamaCppServerProfile } from "../runtime/profiles.js";
import { sanitizeDetectionForApi } from "./sanitize.js";

const defaultHealthTimeoutMs = 3000;
const defaultTestChatTimeoutMs = 5000;
const maxPromptLength = 500;
const defaultTestPrompt = "Say OK in one short sentence.";

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numberValue));
}

function localCheckHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function apiBaseUrl(profile: RuntimeProfile): string | null {
  if (!isLlamaCppServerProfile(profile)) {
    return null;
  }
  return `http://${localCheckHost(profile.host)}:${profile.port}/v1`;
}

function diagnosticProfile(profile: RuntimeProfile | null, state: RuntimeState): RuntimeDiagnosticProfile | null {
  if (!profile || !isLlamaCppServerProfile(profile)) {
    return null;
  }
  return {
    id: profile.id,
    name: profile.name,
    host: localCheckHost(profile.host),
    port: profile.port,
    runtimeStatus: state.status
  };
}

async function activeDiagnosticTarget(runtimeManager: RuntimeManager): Promise<{ state: RuntimeState; profile: RuntimeProfile | null; endpoint: string | null }> {
  const state = runtimeManager.getState();
  const profile = runtimeManager.getActiveProfile() ?? (state.activeProfileId ? await getProfile(state.activeProfileId) : null);
  return { state, profile, endpoint: profile ? apiBaseUrl(profile) : null };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function safeDiagnosticError(error: unknown): { error: string; message: string } {
  if (error instanceof Error && error.name === "AbortError") {
    return { error: "runtime_timeout", message: "Runtime API request timed out." };
  }
  return { error: "runtime_unreachable", message: "Runtime API could not be reached." };
}

function responseTextPreview(data: unknown): string | null {
  const content = (data as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices?.[0]?.message?.content ?? (data as { choices?: Array<{ text?: unknown }> }).choices?.[0]?.text;
  if (typeof content !== "string") {
    return null;
  }
  return content.trim().slice(0, 500) || null;
}

export async function registerRuntimeRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/runtime", async () => ({
    state: runtimeManager.getState(),
    warnings: runtimeManager.getWarnings()
  }));

  app.get("/api/runtime/detection", async () => sanitizeDetectionForApi(await runtimeManager.refreshDetection({ reconcileStaleState: false })));

  app.get("/api/runtime/command", async (request, reply) => {
    const command = runtimeManager.getActiveCommand();
    if (!command) {
      return reply.status(404).send({ error: "not_found", message: "No active profile command is available." });
    }

    return { command };
  });

  app.get("/api/runtime/health", async (): Promise<RuntimeHealthResponse> => {
    const checkedAt = new Date().toISOString();
    const { state, profile, endpoint } = await activeDiagnosticTarget(runtimeManager);
    const profileInfo = diagnosticProfile(profile, state);
    if (!profile || !endpoint || !profileInfo) {
      return {
        ok: false,
        status: "not_configured",
        checkedAt,
        latencyMs: null,
        endpoint: null,
        profile: null,
        error: "runtime_not_configured",
        message: "No active llama.cpp server profile is available for diagnostics."
      };
    }

    const startedAt = Date.now();
    try {
      const response = await fetchWithTimeout(`${endpoint}/models`, { method: "GET", headers: { Accept: "application/json" } }, defaultHealthTimeoutMs);
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { ok: false, status: "unhealthy", checkedAt, latencyMs, endpoint, profile: profileInfo, error: "runtime_http_error", message: `Runtime API returned HTTP ${response.status}.` };
      }
      const data = (await response.json().catch(() => ({}))) as { data?: unknown[] };
      return { ok: true, status: "healthy", checkedAt, latencyMs, endpoint, profile: profileInfo, modelsCount: Array.isArray(data.data) ? data.data.length : undefined, message: "Runtime API responded to /v1/models." };
    } catch (error) {
      const safeError = safeDiagnosticError(error);
      return { ok: false, status: "unhealthy", checkedAt, latencyMs: Date.now() - startedAt, endpoint, profile: profileInfo, ...safeError };
    }
  });

  app.post<{ Body: RuntimeTestChatRequest }>("/api/runtime/test-chat", async (request): Promise<RuntimeTestChatResponse> => {
    const checkedAt = new Date().toISOString();
    const { state, profile, endpoint } = await activeDiagnosticTarget(runtimeManager);
    const profileInfo = diagnosticProfile(profile, state);
    const rawPrompt = typeof request.body?.prompt === "string" && request.body.prompt.trim() ? request.body.prompt.trim() : defaultTestPrompt;
    const prompt = rawPrompt.slice(0, maxPromptLength);
    const maxTokens = clampInteger(request.body?.maxTokens, 16, 1, 64);
    const timeoutMs = clampInteger(request.body?.timeoutMs, defaultTestChatTimeoutMs, 1000, 15000);

    if (!profile || !endpoint || !profileInfo) {
      return {
        ok: false,
        checkedAt,
        latencyMs: null,
        endpoint: null,
        profile: null,
        promptLength: prompt.length,
        maxTokens,
        responsePreview: null,
        error: "runtime_not_configured",
        message: "No active llama.cpp server profile is available for diagnostics."
      };
    }

    const startedAt = Date.now();
    try {
      const response = await fetchWithTimeout(
        `${endpoint}/chat/completions`,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 })
        },
        timeoutMs
      );
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { ok: false, checkedAt, latencyMs, endpoint, profile: profileInfo, promptLength: prompt.length, maxTokens, responsePreview: null, error: "runtime_http_error", message: `Runtime API returned HTTP ${response.status}.` };
      }
      const data = await response.json().catch(() => ({}));
      return { ok: true, checkedAt, latencyMs, endpoint, profile: profileInfo, promptLength: prompt.length, maxTokens, responsePreview: responseTextPreview(data), message: "Runtime API responded to diagnostic chat request." };
    } catch (error) {
      const safeError = safeDiagnosticError(error);
      return { ok: false, checkedAt, latencyMs: Date.now() - startedAt, endpoint, profile: profileInfo, promptLength: prompt.length, maxTokens, responsePreview: null, ...safeError };
    }
  });

  app.post("/api/runtime/stop", async (request, reply) => {
    const result = await runtimeManager.stop();
    return reply.status(result.ok ? 200 : 400).send(result);
  });

  app.post("/api/runtime/restart", async (request, reply) => {
    const result = await runtimeManager.restart();
    return reply.status(result.ok ? 200 : 400).send(result);
  });

  app.get<{ Querystring: { limit?: string } }>("/api/runtime/logs", async (request) => {
    const limit = Number.parseInt(request.query.limit ?? "300", 10);
    return { logs: await runtimeManager.logs.getRecent(limit) };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/runtime/logs/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let unsubscribe = (): void => {};

    const cleanup = (): void => {
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      unsubscribe();
      unsubscribe = (): void => {};
    };

    request.raw.on("close", cleanup);

    const sendEvent = (event: string, data: unknown): void => {
      if (closed || reply.raw.destroyed) {
        return;
      }

      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const send = (entry: RuntimeLogEntry): void => {
      sendEvent("log", entry);
      if (entry.source === "system" && entry.message.startsWith("Runtime process exited")) {
        sendEvent("stopped", { timestamp: entry.timestamp, message: entry.message });
      }
    };

    sendEvent("connection", { ok: true, state: runtimeManager.getState() });

    const limit = Number.parseInt(request.query.limit ?? "300", 10);
    for (const entry of await runtimeManager.logs.getRecent(limit)) {
      if (closed || reply.raw.destroyed) {
        return;
      }
      send(entry);
    }

    if (closed || reply.raw.destroyed) {
      return;
    }

    const state = runtimeManager.getState();
    if (["stopped", "exited", "failed", "unknown_previous_runtime"].includes(state.status)) {
      sendEvent("stopped", { state });
    }

    heartbeat = setInterval(() => {
      sendEvent("heartbeat", { timestamp: new Date().toISOString() });
    }, 15000);

    unsubscribe = runtimeManager.logs.subscribe(send);
  });
}
