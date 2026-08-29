import { readable } from "svelte/store";
import { API_ENDPOINTS, publicFetchJson, setAuthConfigured, setAuthConfigurationUnavailable, type AuthStatusResponse, type StatusResponse } from "./api";
import { createCompletionAwarePoller } from "./polling";

export type ApplicationStatus = {
  status: StatusResponse | null;
  auth: AuthStatusResponse | null;
  error: string | null;
};

const initialStatus: ApplicationStatus = { status: null, auth: { configured: false, authRequired: false }, error: null };
let currentStatus = initialStatus;
let publish = (_status: ApplicationStatus) => {};
let request: Promise<void> | undefined;

async function refresh() {
  if (request) return request;
  request = Promise.allSettled([
    publicFetchJson<StatusResponse>(API_ENDPOINTS.status),
    publicFetchJson<AuthStatusResponse>(API_ENDPOINTS.auth.status)
  ]).then(([statusResult, authResult]) => {
    if (authResult.status === "fulfilled") setAuthConfigured(authResult.value.configured);
    else setAuthConfigurationUnavailable(authResult.reason instanceof Error ? authResult.reason.message : "Authentication status unavailable");
    const errors = [statusResult, authResult].flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "Service status unavailable"] : []);
    currentStatus = {
      status: statusResult.status === "fulfilled" ? statusResult.value : currentStatus.status,
      auth: authResult.status === "fulfilled" ? authResult.value : currentStatus.auth,
      error: errors.join(" ") || null
    };
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
