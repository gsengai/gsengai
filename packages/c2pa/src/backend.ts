// SPDX-License-Identifier: Apache-2.0
/**
 * Signing/reading backend abstraction (issue #1, ADR-0035, ADR-0042). The
 * native @contentauth/c2pa-node module is preferred: since 0.9 its postinstall
 * downloads a prebuilt binary for macOS (arm64, x64), Linux (arm64, x64 glibc),
 * and Windows (x64). It can still fail to load — the install script was
 * blocked (pnpm 10+ and Bun skip dependency scripts unless allowed; the
 * tarball's bundled binary is linux-x64 only), the download failed, or the
 * platform has no prebuilt (e.g. musl/Alpine) — and then we shell out to
 * c2patool (contentauth's standalone CLI), built on the same c2pa-rs and
 * producing equivalent manifests.
 *
 * Resolution order: try the native module first; on any load failure fall back
 * to c2patool. Overrides: GSENGAI_C2PA_BACKEND=native|c2patool forces one
 * backend, GSENGAI_C2PATOOL_PATH (or the signer's `c2patoolPath` option) points
 * at a specific binary; otherwise c2patool is looked up on PATH.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ImageMime } from "./mime";
import { OFFLINE_NO_VERIFY_SETTINGS as PROBE_SETTINGS } from "./settings";

const execFileAsync = promisify(execFile);

/** Manifest-store JSON as serialized by c2pa-rs — identical shape from the native Reader and from c2patool stdout. */
export interface ManifestStoreJson {
  active_manifest?: string | null;
  manifests?: Record<string, ManifestJson>;
  validation_state?: string;
  validation_results?: {
    activeManifest?: {
      success?: { code: string }[];
      informational?: { code: string }[];
      failure?: { code: string }[];
    };
  };
}

export interface ManifestJson {
  claim_generator_info?: { name: string; version?: string }[];
  assertions?: { label: string; data: unknown }[];
  ingredients?: { relationship?: string; active_manifest?: string }[];
  /** Claim thumbnail reference; both backends disable it, so signed output carries none (ADR-0042). */
  thumbnail?: { format?: string; identifier?: string } | null;
  /** The signer as c2pa-rs reports it after verifying the claim signature (ADR-0040). */
  signature_info?: SignatureInfoJson | null;
}

/**
 * c2pa-rs `SignatureInfo`, as both backends serialize it. Despite its name,
 * `issuer` is the signing certificate's *subject* organization — the last O
 * attribute of the subject (c2pa-rs crypto/cose/verifier.rs) — and
 * `cert_serial_number` is the serial in decimal.
 */
export interface SignatureInfoJson {
  issuer?: string | null;
  cert_serial_number?: string | null;
  common_name?: string | null;
  alg?: string | null;
  time?: string | null;
}

export interface SignJob {
  inputBytes: Buffer;
  mimeType: ImageMime;
  /** When set, the backend writes the signed asset to this path. */
  outputPath?: string;
  title: string;
  model: string;
  /** ISO timestamp recorded in the created action and the generator assertion. */
  when: string;
  /** True when the input already carries a manifest: edit intent, parent ingredient (PRD B3, ADR-0015). */
  hasParent: boolean;
  /** PEM bytes for the native LocalSigner. */
  certBytes: Buffer;
  keyBytes: Buffer;
  /** The same credentials as paths for c2patool — key material never leaves the caller's files. */
  certPath: string;
  keyPath: string;
}

export interface SignOutcome {
  signedBytes: Buffer;
  manifestLabel: string;
}

export interface C2paBackend {
  readonly name: "native" | "c2patool";
  /** Read the manifest store without trust validation (existence check / peek). Null when the asset has no manifest. */
  peekStore(bytes: Buffer, mimeType: ImageMime): Promise<ManifestStoreJson | null>;
  /** Read with full local validation — trust against local anchors only, never any network fetch. */
  validateStore(bytes: Buffer, mimeType: ImageMime): Promise<ManifestStoreJson | null>;
  sign(job: SignJob): Promise<SignOutcome>;
}

/**
 * Minimal 8×8 PNG (no manifest) used to probe the native module: c2pa-node
 * loads its .node binary lazily on first use, so a successful `import()` says
 * nothing about whether the platform binary works — only a real call does.
 */
const PROBE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNocFDAihiGlgQA+gM4Acru2/oAAAAASUVORK5CYII=",
  "base64",
);

const cache = new Map<string, Promise<C2paBackend>>();

/**
 * Resolve the backend once per (env override, c2patool path) combination and
 * memoize — module load and binary discovery happen at most once per process.
 */
export function resolveBackend(c2patoolPath?: string): Promise<C2paBackend> {
  const forced = process.env.GSENGAI_C2PA_BACKEND ?? "";
  const bin = c2patoolPath ?? process.env.GSENGAI_C2PATOOL_PATH ?? "c2patool";
  const key = `${forced}\u0000${bin}`;
  let resolved = cache.get(key);
  if (!resolved) {
    resolved = doResolve(forced, bin);
    cache.set(key, resolved);
  }
  return resolved;
}

async function doResolve(forced: string, bin: string): Promise<C2paBackend> {
  if (forced !== "" && forced !== "native" && forced !== "c2patool") {
    throw new Error(
      `gsengai: GSENGAI_C2PA_BACKEND must be "native" or "c2patool", got "${forced}"`,
    );
  }

  let nativeError: unknown;
  if (forced !== "c2patool") {
    try {
      // Dynamic import so the dlopen of the platform-specific binary inside
      // c2pa-node cannot crash module load of this package.
      const mod = await import("@contentauth/c2pa-node");
      // Force the lazy .node binary load with a real read — a manifest-less
      // probe returns null on a working binary and throws on a broken one
      // (wrong arch, missing file). Import success alone proves nothing.
      await mod.Reader.fromAsset({ buffer: PROBE_PNG, mimeType: "image/png" }, PROBE_SETTINGS);
      const { createNativeBackend } = await import("./native.js");
      return createNativeBackend(mod);
    } catch (err) {
      nativeError = err;
      if (forced === "native") {
        throw new Error(
          `gsengai: GSENGAI_C2PA_BACKEND=native but @contentauth/c2pa-node failed to load: ${message(err)}`,
        );
      }
    }
  }

  try {
    await execFileAsync(bin, ["--version"]);
  } catch (err) {
    const detail =
      forced === "c2patool"
        ? `GSENGAI_C2PA_BACKEND=c2patool but the c2patool binary ("${bin}") could not be run: ${message(err)}`
        : `the native @contentauth/c2pa-node module failed to load (${message(nativeError)}) ` +
          `and the c2patool fallback ("${bin}") could not be run: ${message(err)}`;
    throw new Error(
      `gsengai: no C2PA signing backend available — ${detail}. ` +
        "If you install with pnpm 10+ or Bun, allow @contentauth/c2pa-node's install script so it can " +
        "download its native binary (pnpm: `pnpm approve-builds` or onlyBuiltDependencies; Bun: " +
        "trustedDependencies), then reinstall. Otherwise install c2patool " +
        "(https://github.com/contentauth/c2pa-rs/releases or `cargo install c2patool`) and put it on " +
        "PATH, or point GSENGAI_C2PATOOL_PATH / the c2patoolPath option at the binary.",
    );
  }
  const { createC2patoolBackend } = await import("./c2patool.js");
  return createC2patoolBackend(bin);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
