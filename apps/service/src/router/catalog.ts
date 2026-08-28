import type { ConfiguredModelId, RouterAlias, RouterCatalogEntry, RouterCatalogSnapshot, RouterModelState } from "@obsidianlm/shared";

type RecordValue = Record<string, unknown>;
export interface ExpectedRouterModel { routerAlias: RouterAlias | string; configuredModelId: ConfiguredModelId }

const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);

function rawEntries(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (!record(raw)) return undefined;
  if (Array.isArray(raw.models)) return raw.models;
  if (Array.isArray(raw.data)) return raw.data;
  return undefined;
}

function status(entry: RecordValue): { state: RouterModelState; text?: string; evidence?: RecordValue; warning?: string } {
  const raw = entry.status;
  const statusRecord = record(raw) ? raw : undefined;
  const text = typeof raw === "string" ? raw : typeof statusRecord?.value === "string" ? statusRecord.value : typeof entry.state === "string" ? entry.state : undefined;
  const failed = statusRecord?.failed === true || entry.failed === true;
  const exitCode = typeof statusRecord?.exit_code === "number" ? statusRecord.exit_code : typeof entry.exit_code === "number" ? entry.exit_code : undefined;
  const evidence = { ...(text ? { status: text } : {}), ...(failed ? { failed: true } : {}), ...(exitCode !== undefined ? { exitCode } : {}) };
  if (failed || exitCode !== undefined && exitCode !== 0) return { state: "failed", text, evidence };
  if (text && ["unloaded", "loading", "loaded", "sleeping", "unavailable", "failed"].includes(text.toLowerCase())) return { state: text.toLowerCase() as RouterModelState, text, evidence };
  return { state: "unknown", ...(text ? { text, warning: `Unknown router model status: ${text}.` } : { warning: "Router model status was missing." }), evidence };
}

export function reconcileRouterCatalog(raw: unknown, expected: readonly ExpectedRouterModel[], observedAt = new Date().toISOString()): RouterCatalogSnapshot {
  const source = rawEntries(raw);
  if (!source) return { endpoint: "/models", observedAt, entries: [], reconciliationState: "failed", warnings: ["Router catalog response did not contain a model array."] };
  const expectedCounts = new Map<string, number>();
  const expectedByAlias = new Map<string, ConfiguredModelId>();
  for (const item of expected) {
    const alias = String(item.routerAlias);
    expectedCounts.set(alias, (expectedCounts.get(alias) ?? 0) + 1);
    expectedByAlias.set(alias, item.configuredModelId);
  }
  const parsed = source.map((value, index) => {
    if (!record(value)) return { index, identifier: `unknown:${index}`, malformed: true, value: {}, status: { state: "unknown" as const, warning: "Router catalog entry was not an object." } };
    const identifier = [value.id, value.alias, value.name].find((item) => typeof item === "string" && item.trim().length > 0);
    return { index, identifier: typeof identifier === "string" ? identifier : `unknown:${index}`, malformed: typeof identifier !== "string", value, status: status(value) };
  });
  const counts = new Map<string, number>();
  for (const item of parsed) if (!item.malformed) counts.set(item.identifier, (counts.get(item.identifier) ?? 0) + 1);
  const warnings: string[] = [];
  const entries: RouterCatalogEntry[] = parsed.map((item) => {
    const duplicate = (counts.get(item.identifier) ?? 0) > 1;
    const ambiguousExpected = (expectedCounts.get(item.identifier) ?? 0) > 1;
    const managedId = expectedByAlias.get(item.identifier);
    const rawEvidence = {
      ...item.status.evidence,
      ...(typeof item.value.source === "string" ? { source: item.value.source.slice(0, 128) } : {}),
      ...(typeof item.value.path === "string" ? { path: item.value.path.slice(0, 1024) } : {})
    };
    const itemWarnings = [item.status.warning, item.malformed ? "Router catalog entry had no usable identifier." : undefined, duplicate ? `Duplicate router identifier: ${item.identifier}.` : undefined, ambiguousExpected ? `Ambiguous expected router identifier: ${item.identifier}.` : undefined].filter((value): value is string => Boolean(value));
    warnings.push(...itemWarnings);
    const base = { routerIdentifier: item.identifier, state: item.status.state, ...(item.status.text ? { statusText: item.status.text } : {}), ...(Object.keys(rawEvidence).length ? { rawEvidence } : {}), ...(itemWarnings.length ? { warnings: itemWarnings } : {}) };
    if (!item.malformed && !duplicate && !ambiguousExpected && managedId) return { ...base, ownership: "managed" as const, configuredModelId: managedId };
    return { ...base, ownership: item.malformed || duplicate || ambiguousExpected ? "unknown" as const : "external" as const };
  }).sort((left, right) => left.routerIdentifier.localeCompare(right.routerIdentifier));
  const missing = [...expectedCounts].filter(([alias, count]) => count !== 1 || counts.get(alias) !== 1).map(([alias]) => alias);
  if (missing.length) warnings.push(`Expected router identifiers were missing or ambiguous: ${missing.sort().join(", ")}.`);
  const mismatch = missing.length > 0 || warnings.some((warning) => /Duplicate|Ambiguous|no usable identifier|not an object/u.test(warning));
  return { endpoint: "/models", observedAt, entries, reconciliationState: mismatch ? "mismatch" : "reconciled", warnings: [...new Set(warnings)].sort() };
}
