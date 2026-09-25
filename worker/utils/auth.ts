import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { isDevelopment, type Env } from "../env";
import { timingSafeEqual } from "./crypto";
import { AppError } from "./errors";

/**
 * Authorization layer for administrative / expensive operations.
 *
 * Admin requests must send `Authorization: Bearer <ADMIN_TOKEN>`. With no
 * ADMIN_TOKEN secret configured, admin operations are allowed only in
 * development; in any other environment they fail closed.
 *
 * This is the single place to add another identity provider later.
 */
export type AuthMode = "token" | "open";

/** The configured token, ignoring surrounding whitespace (easy to paste into the dashboard by accident). */
function configuredToken(env: Env): string {
  return env.ADMIN_TOKEN?.trim() ?? "";
}

export function authMode(env: Env): AuthMode {
  return configuredToken(env) ? "token" : "open";
}

export async function resolveAdmin(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const expected = configuredToken(env);
  if (bearer && expected && timingSafeEqual(bearer, expected)) return "admin-token";
  if (!expected && isDevelopment(env)) return "local-development";
  return null;
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  if (authMode(env) === "open" && !isDevelopment(env)) {
    throw new AppError(503, "admin_not_configured", "Admin operations are disabled until the ADMIN_TOKEN secret is set.");
  }
  const actor = await resolveAdmin(c.req.raw, env);
  if (!actor) throw new AppError(401, "unauthorized", "Admin authorization required.");
  c.set("actor", actor);
  await next();
};

/** Applies the Workers Rate Limiting binding (when bound) to expensive operations. */
export function rateLimit(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env.EXPENSIVE_LIMITER;
    if (limiter) {
      const key = `${scope}:${c.get("actor") ?? c.req.header("CF-Connecting-IP") ?? "anonymous"}`;
      const { success } = await limiter.limit({ key });
      if (!success) {
        throw new AppError(429, "rate_limited", "Too many requests for this operation. Please wait a minute.");
      }
    }
    await next();
  };
}
