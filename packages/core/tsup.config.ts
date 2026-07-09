// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "node",
    target: "node22",
  },
  {
    // The `gsengai-audit` bin — ESM only (package is type:module; node >= 22).
    entry: ["src/gsengai-audit.ts"],
    format: ["esm"],
    sourcemap: true,
    platform: "node",
    target: "node22",
  },
]);
