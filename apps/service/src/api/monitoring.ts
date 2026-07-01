import type { FastifyInstance } from "fastify";
import { loadSettings } from "../config/storage.js";
import { getGpuMonitoringStatus, type GpuMonitorOptions } from "../monitoring/gpu-monitor.js";
import { classifyPortStatus, detectPort } from "../process/port-detector.js";
import type { RuntimeManager } from "../runtime/manager.js";

export async function registerMonitoringRoutes(app: FastifyInstance, runtimeManager: RuntimeManager, gpuMonitorOptions: GpuMonitorOptions = {}): Promise<void> {
  app.get<{ Querystring: { port?: string } }>("/api/monitoring/ports", async (request, reply) => {
    const settings = await loadSettings();
    const requestedPort = request.query.port ? Number.parseInt(request.query.port, 10) : settings.managedLlamaPort;
    if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
      return reply.status(400).send({ error: "invalid_port", message: "Port must be between 1 and 65535." });
    }

    const port = await detectPort(requestedPort);
    const currentPid = runtimeManager.getState().pid;
    return classifyPortStatus(port, currentPid);
  });

  app.get("/api/monitoring/gpu", async () => getGpuMonitoringStatus(runtimeManager.getState().pid, gpuMonitorOptions));
}
