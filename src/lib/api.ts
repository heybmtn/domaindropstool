import type { ApiErrorBody } from "../../shared/api";

/** Typed fetch wrapper for the Worker API. Only safe error messages reach the UI. */

const TOKEN_KEY = "ddr.adminToken";

export function getAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode); the token then lasts for this page only.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function headers(extra?: HeadersInit): Headers {
  const result = new Headers(extra);
  const token = getAdminToken();
  if (token) result.set("Authorization", `Bearer ${token}`);
  return result;
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(response.status, body.error.code, body.error.message, body.error.details);
  } catch {
    return new ApiError(response.status, "http_error", `Request failed (${response.status}).`);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: headers({ ...(init.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...init.headers }),
  });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, file: File) =>
    request<T>(path, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } }),
};

/** Downloads a CSV via fetch (so the admin header is sent) and saves it. */
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`/api${path}`, { headers: headers() });
  if (!response.ok) throw await parseError(response);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Admin authorization required. Add your admin token in Settings.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
