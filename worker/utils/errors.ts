/** Error carrying a safe, user-facing message and an HTTP status. */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found.`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
