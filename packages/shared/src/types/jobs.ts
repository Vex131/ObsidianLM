export type JobType = "test" | "generic";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  command: string;
  executable: string;
  args: string[];
  cwd: string | null;
  exitCode: number | null;
  signal: string | null;
  logPath: string | null;
  resultPath: string | null;
  errorMessage: string | null;
}

export interface JobListResponse {
  jobs: JobRecord[];
}

export interface JobDetailResponse {
  job: JobRecord;
}

export interface JobLogsResponse {
  job: JobRecord;
  logs: string[];
}

export interface JobActionResponse {
  ok: boolean;
  message: string;
  job: JobRecord | null;
}
