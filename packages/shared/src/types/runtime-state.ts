export type RuntimeStatus = "stopped" | "running" | "error" | "warning";

export interface RuntimeState {
  activeRuntimeId: string | null;
  activeProfileId: string | null;
  pid: number | null;
  port: number | null;
  startedByObsidianLM: boolean;
  startedAt: string | null;
  commandHash: string | null;
  status: RuntimeStatus;
}
