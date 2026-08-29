import path from "node:path";
import type { DetectedProcess, RouterProcessAwarenessContext } from "@obsidianlm/shared";

export interface RouterProcessCommandMetadata {
  routerAlias: string | null;
  childPort: number | null;
}

/** Parses only unambiguous --alias/--port options from a Windows-style command line. */
export function parseRouterProcessCommandLine(commandLine: string | null): RouterProcessCommandMetadata {
  if (!commandLine) return { routerAlias: null, childPort: null };

  const tokens = tokenizeWindowsCommandLine(commandLine);
  if (!tokens) return { routerAlias: null, childPort: null };

  let routerAlias: string | null = null;
  let childPort: number | null = null;
  let aliasSeen = false;
  let portSeen = false;
  let aliasAmbiguous = false;
  let portAmbiguous = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const option = parseOption(token, "--alias") ?? parseOption(token, "--port");
    if (!option) continue;
    if (option.name === "--alias") {
      if (aliasSeen) aliasAmbiguous = true;
      aliasSeen = true;
      if (aliasAmbiguous) routerAlias = null;
    } else {
      if (portSeen) portAmbiguous = true;
      portSeen = true;
      if (portAmbiguous) childPort = null;
    }
    const value = option.value ?? tokens[index + 1];
    if (!value || !isCleanOptionValue(value)) continue;
    if (option.name === "--alias") {
      routerAlias = aliasAmbiguous ? null : value;
    }
    if (option.name === "--port") {
      childPort = portAmbiguous ? null : parsePort(value);
    }
    if (option.value === null) index += 1;
  }
  return { routerAlias, childPort };
}

export function classifyRouterProcesses(processes: DetectedProcess[], context: RouterProcessAwarenessContext): DetectedProcess[] {
  const parsed = processes.map((process) => ({ process, command: parseRouterProcessCommandLine(process.commandLine) }));
  const duplicateAliases = duplicateValues(parsed.map(({ command }) => command.routerAlias));
  const duplicatePorts = duplicateValues(parsed.map(({ command }) => command.childPort));
  const expectedModels = new Map(context.expectedModels.map((model) => [model.routerAlias as string, model.configuredModelId]));
  const currentRouterProven = context.ownershipEvidence === "current_process_child" && context.routerPid !== null;
  const previousRouter = context.previousRouterPid === null ? null : processes.find((process) => process.pid === context.previousRouterPid) ?? null;

  return parsed
    .map(({ process, command }) => classifyProcess(process, command, context, expectedModels, duplicateAliases, duplicatePorts, currentRouterProven, previousRouter))
    .map((process, index) => ({ process, index }))
    .sort((left, right) => left.process.pid - right.process.pid || left.index - right.index)
    .map(({ process }) => process);
}

function classifyProcess(
  process: DetectedProcess,
  command: RouterProcessCommandMetadata,
  context: RouterProcessAwarenessContext,
  expectedModels: Map<string, DetectedProcess["configuredModelId"]>,
  duplicateAliases: Set<string>,
  duplicatePorts: Set<number>,
  currentRouterProven: boolean,
  previousRouter: DetectedProcess | null
): DetectedProcess {
  const reasons = [...process.reasons];
  const result: DetectedProcess = { ...process, reasons };
  const isCurrentRouter = currentRouterProven && process.pid === context.routerPid;
  const matchesBuild = exactExecutableMatch(process.executablePath, context.buildServerLocator);
  const isCurrentChild = currentRouterProven && process.kind === "llama_server" && process.parentPid === context.routerPid && matchesBuild;
  const isPreviousRouter = previousRouter !== null && process.pid === previousRouter.pid;
  const matchesPreviousBuild = exactExecutableMatch(process.executablePath, context.previousBuildServerLocator);
  const isPreviousChild = previousRouter !== null && process.kind === "llama_server" && process.parentPid === previousRouter.pid && (context.previousBuildServerLocator === null || matchesPreviousBuild);

  if (isCurrentRouter) {
    result.role = "managed_router";
    result.ownership = "proven";
    addReason(reasons, "Current managed router PID is proven by in-memory ownership evidence.");
  } else if (isCurrentChild) {
    result.role = "managed_router_child";
    result.ownership = "proven";
    addReason(reasons, "Direct child of the proven current router with an exact configured server executable match.");
  } else if (isPreviousRouter) {
    result.role = "previous_managed_router_candidate";
    result.ownership = "candidate";
    addReason(reasons, "Live PID matches the previous router PID; ownership remains a candidate.");
  } else if (isPreviousChild) {
    result.role = "previous_managed_router_child_candidate";
    result.ownership = "candidate";
    addReason(reasons, "Direct child of the live previous router candidate; ownership remains a candidate.");
  } else if (process.kind === "llama_server") {
    result.role = "unmanaged_llama_server";
    result.ownership = "unmanaged";
    addReason(reasons, "No mandatory router ownership proof matched this llama-server process.");
  } else {
    result.role = "unknown_llama_server";
    result.ownership = "unknown";
    addReason(reasons, "Process could not be safely attributed to a router.");
  }

  if (command.routerAlias !== null && duplicateAliases.has(command.routerAlias)) addReason(reasons, `Router alias ${JSON.stringify(command.routerAlias)} is duplicated; no model was attributed.`);
  if (command.childPort !== null && duplicatePorts.has(command.childPort)) addReason(reasons, `Child port ${command.childPort} is duplicated; no port was attributed.`);

  if (result.role === "managed_router_child" && result.ownership === "proven" && command.routerAlias !== null) {
    if (duplicateAliases.has(command.routerAlias)) {
      addReason(reasons, `Router alias ${JSON.stringify(command.routerAlias)} is duplicated; no model was attributed.`);
    } else {
      const configuredModelId = expectedModels.get(command.routerAlias);
      if (configuredModelId) result.configuredModelId = configuredModelId;
      else addReason(reasons, `Router alias ${JSON.stringify(command.routerAlias)} is not an expected model; no model was attributed.`);
      if (configuredModelId) result.routerAlias = command.routerAlias as DetectedProcess["routerAlias"];
    }
  }
  if (result.role === "managed_router_child" && result.ownership === "proven" && command.childPort !== null) {
    if (duplicatePorts.has(command.childPort)) addReason(reasons, `Child port ${command.childPort} is duplicated; no port was attributed.`);
    else result.childPort = command.childPort;
  }
  return result;
}

function tokenizeWindowsCommandLine(commandLine: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  for (const character of commandLine) {
    if (character === '"') { quoted = !quoted; continue; }
    if (/\s/u.test(character) && !quoted) { if (token) tokens.push(token); token = ""; continue; }
    token += character;
  }
  if (quoted) return null;
  if (token) tokens.push(token);
  return tokens;
}

function parseOption(token: string, name: "--alias" | "--port"): { name: typeof name; value: string | null } | null {
  if (token === name) return { name, value: null };
  if (token.startsWith(`${name}=`)) return { name, value: token.slice(name.length + 1) };
  return null;
}

function isCleanOptionValue(value: string): boolean { return value.length > 0 && !value.startsWith("-") && !/[\s="']/u.test(value); }
function parsePort(value: string): number | null { const port = Number(value); return /^\d+$/u.test(value) && Number.isInteger(port) && port > 0 && port <= 65535 ? port : null; }
function duplicateValues<T>(values: Array<T | null>): Set<T> { const counts = new Map<T, number>(); for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1); return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value)); }
function addReason(reasons: string[], reason: string): void { if (!reasons.includes(reason)) reasons.push(reason); }

function exactExecutableMatch(executablePath: string | null, locator: string | null): boolean {
  if (!executablePath || !locator) return false;
  return normalizeLocalExecutablePath(executablePath) === normalizeLocalExecutablePath(locator);
}

function normalizeLocalExecutablePath(value: string): string {
  if (/^[a-z]:[\\/]/iu.test(value) || value.includes("\\")) return path.win32.normalize(value.replaceAll("/", "\\")).toLocaleLowerCase("en-US");
  return path.posix.normalize(value);
}
