import { describe, expect, it } from "vitest";
import type { Env } from "../../worker/env";
import { authMode, resolveAdmin } from "../../worker/utils/auth";

const env = (overrides: Partial<Env>): Env => ({ DB: {} as D1Database, ENVIRONMENT: "production", ...overrides });
const request = (token?: string) =>
  new Request("https://app.test/api/settings/auth", token ? { headers: { Authorization: `Bearer ${token}` } } : {});

describe("admin token auth", () => {
  it("accepts the configured token", async () => {
    expect(await resolveAdmin(request("secret-value"), env({ ADMIN_TOKEN: "secret-value" }))).toBe("admin-token");
  });

  it("ignores whitespace accidentally saved around the secret", async () => {
    const e = env({ ADMIN_TOKEN: "  secret-value\n" });
    expect(authMode(e)).toBe("token");
    expect(await resolveAdmin(request("secret-value"), e)).toBe("admin-token");
  });

  it("rejects a wrong or missing token", async () => {
    const e = env({ ADMIN_TOKEN: "secret-value" });
    expect(await resolveAdmin(request("other"), e)).toBeNull();
    expect(await resolveAdmin(request(), e)).toBeNull();
  });

  it("treats a whitespace-only secret as unset and fails closed in production", async () => {
    const e = env({ ADMIN_TOKEN: "   " });
    expect(authMode(e)).toBe("open");
    expect(await resolveAdmin(request("   "), e)).toBeNull();
  });

  it("allows admin operations without a secret only in development", async () => {
    expect(await resolveAdmin(request(), env({ ENVIRONMENT: "development" }))).toBe("local-development");
    expect(await resolveAdmin(request(), env({}))).toBeNull();
  });
});
