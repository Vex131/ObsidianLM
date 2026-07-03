import type { LlamaPerplexityEstimate, LlamaPerplexityJobResult } from "@obsidianlm/shared";

const finalEstimatePattern = /Final estimate:\s*PPL\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*\+\/-\s*([0-9]+(?:\.[0-9]+)?)/iu;
const progressEstimatePattern = /\[(\d+)\]\s*([0-9]+(?:\.[0-9]+)?)/gu;

export function parseLlamaPerplexityOutput(output: string): LlamaPerplexityJobResult {
  const warnings: string[] = [];
  const estimates: LlamaPerplexityEstimate[] = [];

  for (const match of output.matchAll(progressEstimatePattern)) {
    const index = Number(match[1]);
    const ppl = Number(match[2]);
    if (Number.isInteger(index) && Number.isFinite(ppl)) {
      estimates.push({ index, ppl });
    }
  }

  const finalMatch = output.match(finalEstimatePattern);
  const finalPpl = finalMatch ? Number(finalMatch[1]) : null;
  const uncertainty = finalMatch ? Number(finalMatch[2]) : null;
  const parsed = finalPpl !== null && Number.isFinite(finalPpl);

  if (!parsed) {
    warnings.push("No final llama-perplexity PPL estimate was found in job output.");
  }

  return {
    type: "llama-perplexity",
    parsed,
    finalPpl: parsed ? finalPpl : null,
    uncertainty: uncertainty !== null && Number.isFinite(uncertainty) ? uncertainty : null,
    estimates,
    estimateCount: estimates.length,
    warnings
  };
}
