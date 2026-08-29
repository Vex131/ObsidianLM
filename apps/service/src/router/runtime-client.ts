export interface RouterClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface RouterClient {
  health(baseUrl: string): Promise<void>;
  models(baseUrl: string): Promise<unknown>;
  loadModel(baseUrl: string, routerAlias: string): Promise<void>;
}

export function createRouterClient(options: RouterClientOptions = {}): RouterClient {
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1_000;
  const maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;
  const request = async (baseUrl: string, endpoint: "/health" | "/models" | "/models/load", body?: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${baseUrl}${endpoint}`, {
        signal: controller.signal,
        ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body })
      });
      if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}.`);
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxResponseBytes) {
          await reader.cancel();
          throw new Error(`${endpoint} response exceeded ${maxResponseBytes} bytes.`);
        }
        chunks.push(next.value);
      }
      if (endpoint === "/health") return null;
      return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    health: async (baseUrl) => { await request(baseUrl, "/health"); },
    models: (baseUrl) => request(baseUrl, "/models"),
    loadModel: async (baseUrl, routerAlias) => {
      const response = await request(baseUrl, "/models/load", JSON.stringify({ model: routerAlias }));
      if (!response || typeof response !== "object" || Array.isArray(response) || (response as Record<string, unknown>).success !== true) {
        const upstream = response && typeof response === "object" && !Array.isArray(response) && typeof (response as Record<string, unknown>).error === "string"
          ? `: ${(response as Record<string, string>).error.slice(0, 256)}`
          : "";
        throw new Error(`Router rejected the model load request${upstream}.`);
      }
    }
  };
}
