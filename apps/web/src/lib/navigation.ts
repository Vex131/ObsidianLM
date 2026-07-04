export type PageId = "dashboard" | "runtime" | "profiles" | "models" | "builds" | "jobs" | "logs" | "telemetry" | "settings" | "system";

export interface NavItem {
  id: PageId;
  label: string;
  group: "CORE" | "LIBRARY" | "OBSERVABILITY" | "SYSTEM";
}

export const defaultPage: PageId = "dashboard";

export const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", group: "CORE" },
  { id: "runtime", label: "Runtime", group: "CORE" },
  { id: "profiles", label: "Profiles", group: "CORE" },
  { id: "models", label: "Models", group: "CORE" },
  { id: "builds", label: "Builds", group: "LIBRARY" },
  { id: "jobs", label: "Jobs", group: "LIBRARY" },
  { id: "logs", label: "Logs", group: "OBSERVABILITY" },
  { id: "telemetry", label: "Telemetry", group: "OBSERVABILITY" },
  { id: "settings", label: "Settings", group: "SYSTEM" },
  { id: "system", label: "System", group: "SYSTEM" }
];

export function pageFromHash(hash: string): PageId {
  const value = hash.replace(/^#/u, "");
  return navItems.some((item) => item.id === value) ? (value as PageId) : defaultPage;
}

export function pageHash(page: PageId): string {
  return `#${page}`;
}
