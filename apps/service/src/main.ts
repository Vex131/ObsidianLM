import { DEFAULT_OBSIDIANLM_PORT } from "@obsidianlm/shared";
import { createServer } from "./server.js";

const host = process.env.OBSIDIANLM_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.OBSIDIANLM_PORT ?? `${DEFAULT_OBSIDIANLM_PORT}`, 10);

const app = await createServer();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down ObsidianLM service");
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ error }, "failed to start ObsidianLM service");
  process.exit(1);
}
