// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx", "src/html.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // UI package: runs in browsers and in Node (SSR / HTML-string entry).
  platform: "neutral",
  target: "es2022",
  external: ["react", "react/jsx-runtime"],
});
