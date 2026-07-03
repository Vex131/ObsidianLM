export function friendlyRequestError(statusCode: number, fallback?: string): string {
  if (statusCode === 401 || statusCode === 403) {
    return "Invalid token";
  }
  return fallback || `Request failed with ${statusCode}`;
}

export async function publicFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : undefined;
    throw new Error(friendlyRequestError(response.status, message));
  }

  return data as T;
}
