// SPDX-License-Identifier: Apache-2.0
import type { NextConfig } from "next";

const SERVER_ONLY_PACKAGES = [
  "@gsengai/core",
  "@gsengai/c2pa",
  "better-sqlite3",
  "@contentauth/c2pa-node",
];

const nextConfig: NextConfig = {
  // Native/server-only packages must never be bundled toward the client:
  // better-sqlite3 and the C2PA signer are native binaries, and the evidence
  // layer as a whole runs server-side only (the browser submits hashes).
  serverExternalPackages: SERVER_ONLY_PACKAGES,
  // serverExternalPackages alone misses pnpm-workspace packages (the symlink
  // resolves outside node_modules, so they get bundled and their
  // import.meta.url-relative assets — dev certs — break). Externalize them
  // explicitly for the server build; they load from node_modules at runtime.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(
        Object.fromEntries(SERVER_ONLY_PACKAGES.map((name) => [name, `commonjs ${name}`])),
      );
    }
    return config;
  },
};

export default nextConfig;
