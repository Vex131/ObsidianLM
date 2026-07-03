import type { LlamaBenchJobResult, LlamaBenchResultRow } from "@obsidianlm/shared";

const headerAliases: Record<string, keyof Omit<LlamaBenchResultRow, "raw">> = {
  test: "test",
  model: "model",
  size: "size",
  params: "params",
  backend: "backend",
  threads: "threads",
  "cpu mask": "cpuMask",
  "ngl": "gpuLayers",
  "n_gpu_layers": "gpuLayers",
  "n-gpu-layers": "gpuLayers",
  "n_batch": "nBatch",
  "n-batch": "nBatch",
  "n_ubatch": "nUbatch",
  "n-ubatch": "nUbatch",
  "n_prompt": "nPrompt",
  "n-prompt": "nPrompt",
  "n_gen": "nGen",
  "n-gen": "nGen",
  "test time": "testTime",
  "t/s": "tokensPerSecond",
  "tokens/s": "tokensPerSecond"
};

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/gu, " ").trim();
}

function parseTokensPerSecond(value: string): number | undefined {
  const match = value.replace(/,/gu, "").match(/-?\d+(?:\.\d+)?/u);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseLlamaBenchOutput(output: string): LlamaBenchJobResult {
  const warnings: string[] = [];
  const rows: LlamaBenchResultRow[] = [];
  const lines = output.split(/\r?\n/u);

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !lines[index + 1].includes("|")) {
      continue;
    }

    const headers = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    if (!headers.length || !isSeparator(separator)) {
      continue;
    }

    const headerKeys = headers.map((header) => headerAliases[normalizeHeader(header)]);
    if (!headerKeys.includes("test") && !headerKeys.includes("tokensPerSecond")) {
      continue;
    }

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex].includes("|")) {
        break;
      }
      const cells = splitMarkdownRow(lines[rowIndex]);
      if (isSeparator(cells)) {
        continue;
      }

      const raw: Record<string, string> = {};
      const row: LlamaBenchResultRow = { test: "unknown", raw };
      cells.forEach((cell, cellIndex) => {
        const header = headers[cellIndex] ?? `column_${cellIndex + 1}`;
        raw[header] = cell;
        const key = headerKeys[cellIndex];
        if (!key) {
          return;
        }
        if (key === "tokensPerSecond") {
          row.tokensPerSecond = parseTokensPerSecond(cell);
          return;
        }
        switch (key) {
          case "test":
            row.test = cell;
            break;
          case "model":
            row.model = cell;
            break;
          case "size":
            row.size = cell;
            break;
          case "params":
            row.params = cell;
            break;
          case "backend":
            row.backend = cell;
            break;
          case "threads":
            row.threads = cell;
            break;
          case "cpuMask":
            row.cpuMask = cell;
            break;
          case "gpuLayers":
            row.gpuLayers = cell;
            break;
          case "nBatch":
            row.nBatch = cell;
            break;
          case "nUbatch":
            row.nUbatch = cell;
            break;
          case "nPrompt":
            row.nPrompt = cell;
            break;
          case "nGen":
            row.nGen = cell;
            break;
          case "testTime":
            row.testTime = cell;
            break;
        }
      });
      rows.push(row);
    }

    break;
  }

  if (!rows.length) {
    warnings.push("No complete llama-bench markdown result table was found in job output.");
  }

  return {
    type: "llama-bench",
    parsed: rows.length > 0,
    rows,
    warnings
  };
}
