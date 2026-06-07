import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.toml" },
      remoteBindings: false,
    }),
  ],
  test: {
    include: ["tests/**/*.test.{js,ts}"],
  },
});
