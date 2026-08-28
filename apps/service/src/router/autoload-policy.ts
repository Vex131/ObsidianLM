import type { LlamaBuildCapabilitiesManifest } from "@obsidianlm/shared";

/** A router must explicitly enable autoload, unless help proves its negative-only flag defaults to enabled. */
export function routerAutoloadArgument(manifest: LlamaBuildCapabilitiesManifest): "--models-autoload" | undefined {
  const flags = new Map(manifest.flags.flatMap((flag) => [flag.canonicalName, ...flag.aliases].map((name) => [name, flag] as const)));
  if (flags.has("--models-autoload")) return "--models-autoload";
  const negative = flags.get("--no-models-autoload");
  if (negative && /default\s*[:=]?\s*(true|on|enabled|yes)/iu.test(`${negative.defaultText ?? ""} ${negative.description ?? ""}`)) return undefined;
  throw new Error("Build help does not prove that router model autoload is enabled.");
}
