export type ShellStatusTone = "green" | "amber" | "red" | "muted";

export type ShellStatusSummary = {
  serviceLabel: string;
  serviceTone: ShellStatusTone;
  runtimeLabel: string;
  runtimeTone: ShellStatusTone;
  portLabel: string;
  uptimeLabel: string;
  warningCount: number;
  versionLabel: string;
};

export const defaultShellStatus: ShellStatusSummary = {
  serviceLabel: "Service checking",
  serviceTone: "muted",
  runtimeLabel: "Runtime stopped",
  runtimeTone: "muted",
  portLabel: "—",
  uptimeLabel: "—",
  warningCount: 0,
  versionLabel: "v0.8.2"
};
