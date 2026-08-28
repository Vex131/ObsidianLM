export interface ServiceLogFile {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  lines: string[];
}

export interface ServiceLogsResponse {
  logs: ServiceLogFile[];
  warnings: string[];
}
