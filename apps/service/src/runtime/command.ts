import { createHash } from "node:crypto";
import type { CommandSpec, LlamaCppProfile } from "@obsidianlm/shared";

function pushFlag(args: string[], flag: string, value: string | number | undefined): void {
  if (value === undefined || value === null || value === "") {
    return;
  }

  args.push(flag, `${value}`);
}

function quoteForDisplay(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '\\"')}"`;
}

export function buildLlamaCppServerCommand(profile: LlamaCppProfile): CommandSpec {
  const args: string[] = [];
  const llamaArgs = profile.llamaArgs ?? {};

  pushFlag(args, "--model", profile.modelPath);
  pushFlag(args, "--host", profile.host);
  pushFlag(args, "--port", profile.port);
  pushFlag(args, "--ctx-size", llamaArgs.ctxSize);
  pushFlag(args, "--n-gpu-layers", llamaArgs.gpuLayers);

  for (const device of llamaArgs.devices ?? []) {
    pushFlag(args, "--device", device);
  }

  pushFlag(args, "--split-mode", llamaArgs.splitMode);
  pushFlag(args, "--tensor-split", llamaArgs.tensorSplit);
  pushFlag(args, "--cache-type-k", llamaArgs.cacheTypeK);
  pushFlag(args, "--cache-type-v", llamaArgs.cacheTypeV);

  if (llamaArgs.flashAttention) {
    pushFlag(args, "--flash-attn", "on");
  }

  pushFlag(args, "--batch-size", llamaArgs.batchSize);
  pushFlag(args, "--ubatch-size", llamaArgs.ubatchSize);
  pushFlag(args, "--parallel", llamaArgs.parallel);
  pushFlag(args, "--threads", llamaArgs.threads);
  pushFlag(args, "--threads-batch", llamaArgs.threadsBatch);

  if (llamaArgs.contBatching) {
    args.push("--cont-batching");
  }

  if (llamaArgs.metrics) {
    args.push("--metrics");
  }

  if (llamaArgs.webui) {
    args.push("--webui");
  }

  args.push(...(profile.extraArgs ?? []));

  const commandHash = createHash("sha256")
    .update(JSON.stringify({ executable: profile.buildPath, args }))
    .digest("hex")
    .slice(0, 16);

  return {
    executable: profile.buildPath,
    args,
    displayCommand: [profile.buildPath, ...args].map(quoteForDisplay).join(" "),
    commandHash
  };
}
