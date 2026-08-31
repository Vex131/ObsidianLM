import { readable } from "svelte/store";
import { API_ENDPOINTS, fetchJson, type StatusResponse } from "./api";
import { createCompletionAwarePoller } from "./polling";

export type ApplicationStatus = {
  status: StatusResponse | null;
  error: string | null;
};

const initialStatus: ApplicationStatus = { status: null, error: null };
let currentStatus = initialStatus;
let publish = (_status: ApplicationStatus) => {};
let request: Promise<void> | undefined;

async function refresh() {
  if (request) return request;
  request = fetchJson<StatusResponse>(API_ENDPOINTS.status).then((status) => {
    currentStatus = {
      status,
      error: null
    };
    publish(currentStatus);
  }).catch((error: unknown) => {
    currentStatus = { ...currentStatus, error: error instanceof Error ? error.message : "Service status unavailable" };
    publish(currentStatus);
  }).finally(() => {
    request = undefined;
  });
  return request;
}

const poller = createCompletionAwarePoller(refresh, 7500);

export const applicationStatus = readable<ApplicationStatus>(initialStatus, (set) => {
  publish = set;
  set(currentStatus);
  poller.start();
  return () => {
    poller.stop();
    publish = () => {};
  };
});

export function refreshApplicationStatus(): Promise<void> {
  return poller.refresh();
}
