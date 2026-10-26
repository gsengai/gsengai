// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const p = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against package sources so `pnpm test` needs no prior build.
    alias: {
      "@gsengai/core": p("./packages/core/src/index.ts"),
      "@gsengai/openai": p("./packages/openai/src/index.ts"),
      "@gsengai/anthropic": p("./packages/anthropic/src/index.ts"),
      "@gsengai/ai-sdk": p("./packages/ai-sdk/src/index.ts"),
      "@gsengai/c2pa": p("./packages/c2pa/src/index.ts"),
      "@gsengai/disclosure/html": p("./packages/disclosure/src/html.ts"),
      "@gsengai/disclosure": p("./packages/disclosure/src/index.tsx"),
    },
  },
  // The demo app's tsconfig sets jsx: "preserve" (Next.js requirement); tests
  // must still get compiled JSX.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    pool: "forks",
    // Real C2PA signing (native binary or c2patool subprocess) took ~1–1.3 s
    // per signing on a capacity-constrained macOS CI runner, and several tests
    // sign three or four times — past the 5 s default. Tests that assert their
    // own time bounds (jumbf-adversarial.test.ts) keep those bounds.
    testTimeout: 30_000,
    include: ["packages/*/test/**/*.test.{ts,tsx}", "apps/*/test/**/*.test.{ts,tsx}"],
  },
});
