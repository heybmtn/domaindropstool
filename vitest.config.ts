import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./worker/index.ts",
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Pin every env value tests depend on so a developer's .dev.vars cannot leak in.
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: "test",
            ADMIN_TOKEN: "test-admin-token",
            USE_MOCK_SEO_PROVIDER: "false",
            DATAFORSEO_LOGIN: "",
            DATAFORSEO_PASSWORD: "",
            ACCESS_TEAM_DOMAIN: "",
            ACCESS_AUD: "",
          },
        },
      }),
    ],
    test: {
      include: ["tests/**/*.test.ts"],
      setupFiles: ["./tests/setup.ts"],
    },
  };
});
