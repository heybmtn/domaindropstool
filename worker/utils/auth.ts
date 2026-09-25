import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { isDevelopment, type Env } from "../env";
import { verifyAccessJwt } from "./accessJwt";
import { timingSafeEqual } from "./crypto";
import { AppError } from "./errors";
import { logger } from "./logger";

/**
 * Authorization layer for administrative / expensive operations.
 *
 * Accepted credentials (any one):
 *  1. A valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) when
 *     ACCESS_TEAM_DOMAIN and ACCESS_AUD are configured.
 *  2. `Authorization: Bearer <ADMIN_TOKEN>` when the ADMIN_TOKEN secret is set.
 *
 * With neither configured, admin operations are allowed only in development;
 * in any other environment they fail closed.
 */
export type AuthMode = "access" | "token" | "open";

export function authMode(env: Env): AuthMode {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) return "access";
  if (env.ADMIN_TOKEN) return "token";
  return "open";
}

export async function resolveAdmin(request: Request, env: Env): Promise<string | null> {
  const accessToken = request.headers.get("Cf-Access-Jwt-Assertion");
  if (accessToken && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    try {
      const identity = await verifyAccessJwt(accessToken, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
      if (identity) return identity;
    } catch (error) {
      logger.warn("auth.access_verify_failed", { error });
    }
  }

  const header = request.headers.get("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (bearer && env.ADMIN_TOKEN && timingSafeEqual(bearer, env.ADMIN_TOKEN)) return "admin-token";

  if (!env.ADMIN_TOKEN && !(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) && isDevelopment(env)) {
    return "local-development";
  }
  return null;
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  if (authMode(env) === "open" && !isDevelopment(env)) {
    throw new AppError(
      503,
      "admin_not_configured",
      "Admin operations are disabled until ADMIN_TOKEN or Cloudflare Access is configured.",
    );
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
