import type { FastifyInstance } from "fastify";
import type { RuntimeHealthResponse, RuntimeLogEntry, RuntimeTestChatRequest, RuntimeTestChatResponse } from "@obsidianlm/shared";
import type { RuntimeManager } from "../runtime/manager.js";
import { sanitizeDetectionForApi } from "./sanitize.js";

const actionStatus = (result: { ok: boolean; error?: string }): number => {
  if (result.ok) return 200;
  if (result.error === "not_found") return 404;
  if ([
    "prerequisite", "conflict", "port_conflict", "runtime_active", "different_build_active", "stop_timeout", "not_running",
    "configured_model_disabled", "configured_model_invalid", "unsupported_scope", "build_switch_required", "same_build_switch_required",
    "runtime_preset_restart_required", "model_not_available", "model_state_unknown", "model_load_failed", "model_load_timeout",
    "residency_policy_violation", "router_catalog_mismatch", "cross_build_target_preflight_failed", "cross_build_target_revalidation_failed", "cross_build_target_start_failed",
    "cross_build_target_model_failed"
  ].includes(result.error ?? "")) return 409;
  return 400;
};

function validStartBody(value: unknown): value is { buildId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && typeof body.buildId === "string" && body.buildId.length > 0;
}

function validSwitchBody(value: unknown): value is { configuredModelId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && typeof body.configuredModelId === "string" && body.configuredModelId.length > 0;
}

export async function registerRuntimeRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/runtime", async () => ({
    state: runtimeManager.getState(),
    routerState: runtimeManager.getRouterState(),
    warnings: runtimeManager.getWarnings()
  }));

  app.get("/api/runtime/detection", async () => sanitizeDetectionForApi(await runtimeManager.refreshDetection({ reconcileStaleState: false })));

  app.post<{ Body: unknown }>("/api/runtime/start", async (request, reply) => {
    if (!validStartBody(request.body)) return reply.status(400).send({ error: "invalid_payload", message: "Body must contain only a non-empty buildId." });
    const result = await runtimeManager.start(request.body.buildId);
    return reply.status(actionStatus(result)).send(result);
  });

  app.post("/api/runtime/stop", async (_request, reply) => {
    const result = await runtimeManager.stop();
    return reply.status(actionStatus(result)).send(result);
  });

  app.post<{ Body: unknown }>("/api/runtime/restart", async (request, reply) => {
    if (request.body && typeof request.body === "object" && Object.keys(request.body).length > 0) return reply.status(400).send({ error: "invalid_payload", message: "Restart does not accept a Build or launch parameters." });
    const result = await runtimeManager.restart();
    return reply.status(actionStatus(result)).send(result);
  });

  app.post<{ Body: unknown }>("/api/runtime/switch-model", async (request, reply) => {
    if (!validSwitchBody(request.body)) return reply.status(400).send({ error: "invalid_payload", message: "Body must contain only a non-empty configuredModelId." });
    const result = await runtimeManager.switchModel(request.body.configuredModelId);
    return reply.status(actionStatus(result)).send(result);
  });

  app.post<{ Body: unknown }>("/api/runtime/switch-build", async (request, reply) => {
    if (!validSwitchBody(request.body)) return reply.status(400).send({ error: "invalid_payload", message: "Body must contain only a non-empty configuredModelId." });
    const result = await runtimeManager.switchBuild(request.body.configuredModelId);
    return reply.status(actionStatus(result)).send(result);
  });

  app.get("/api/runtime/command", async (_request, reply) => {
    const command = runtimeManager.getActiveCommand();
    return command ? { command } : reply.status(404).send({ error: "not_found", message: "No active managed router command is available." });
  });

  app.get("/api/runtime/health", async (_request, reply): Promise<RuntimeHealthResponse> => {
    const checkedAt = new Date().toISOString();
    const routerState = runtimeManager.getRouterState();
    if (routerState.status !== "running" || routerState.port === null || routerState.ownershipEvidence !== "current_process_child") {
      return reply.status(404).send({ ok: false, status: "not_configured", checkedAt, latencyMs: null, endpoint: null, profile: null, error: "not_running", message: "No current in-memory managed router is running." });
    }
    const started = Date.now();
    const health = await runtimeManager.refreshRouterHealth();
    return {
      ok: health.state === "healthy",
      status: health.state === "healthy" ? "healthy" : "unhealthy",
      checkedAt: health.checkedAt ?? checkedAt,
      latencyMs: Date.now() - started,
      endpoint: `http://127.0.0.1:${routerState.port}/health`,
      profile: null,
      ...(health.state === "healthy" ? {} : { error: "runtime_unhealthy" }),
      message: health.message ?? (health.state === "healthy" ? "Managed router responded to /health." : "Managed router /health check failed.")
    };
  });

  app.get("/api/runtime/catalog", async (_request, reply) => {
    const state = runtimeManager.getRouterState();
    if (state.status !== "running" || state.ownershipEvidence !== "current_process_child") return reply.status(404).send({ error: "not_running", message: "No current in-memory managed router is running." });
    return { catalog: await runtimeManager.refreshRouterControlPlane(), routerState: runtimeManager.getRouterState() };
  });

  app.post<{ Body: RuntimeTestChatRequest }>("/api/runtime/test-chat", async (request): Promise<RuntimeTestChatResponse> => ({
    ok: false,
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    endpoint: null,
    profile: null,
    promptLength: typeof request.body?.prompt === "string" ? request.body.prompt.length : 0,
    maxTokens: typeof request.body?.maxTokens === "number" ? request.body.maxTokens : 16,
    responsePreview: null,
    error: "router_model_selection_required",
    message: "Diagnostic inference is disabled until an explicit router model is selected. No inference request was sent."
  }));

  app.get<{ Querystring: { limit?: string } }>("/api/runtime/logs", async (request) => ({ logs: await runtimeManager.logs.getRecent(Number.parseInt(request.query.limit ?? "300", 10)) }));

  app.get<{ Querystring: { limit?: string } }>("/api/runtime/logs/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    let closed = false;
    let unsubscribe = (): void => {};
    const sendEvent = (event: string, data: unknown): void => { if (!closed && !reply.raw.destroyed) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const send = (entry: RuntimeLogEntry): void => {
      sendEvent("log", entry);
      if (entry.source === "system" && entry.message.startsWith("Router process exited")) sendEvent("stopped", { timestamp: entry.timestamp, state: runtimeManager.getState(), routerState: runtimeManager.getRouterState() });
    };
    const heartbeat = setInterval(() => sendEvent("heartbeat", { timestamp: new Date().toISOString() }), 15_000);
    request.raw.on("close", () => { closed = true; clearInterval(heartbeat); unsubscribe(); });
    sendEvent("connection", { ok: true, state: runtimeManager.getState(), routerState: runtimeManager.getRouterState() });
    for (const entry of await runtimeManager.logs.getRecent(Number.parseInt(request.query.limit ?? "300", 10))) send(entry);
    if (["stopped", "exited", "failed", "unknown_previous_runtime"].includes(runtimeManager.getRouterState().status)) sendEvent("stopped", { state: runtimeManager.getState(), routerState: runtimeManager.getRouterState() });
    unsubscribe = runtimeManager.logs.subscribe(send);
  });
}
