// SPDX-License-Identifier: Apache-2.0
// c2patool backend: signs and reads by invoking contentauth's standalone CLI
// (c2pa-rs) in a subprocess — the cross-platform fallback for platforms where
// the @contentauth/c2pa-node native binary cannot load (issue #1). Invocation
// is execFile (no shell); assets pass through a private temp dir that is
// always removed; signing credentials are passed as file paths so key material
// is never copied.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { C2paBackend, ManifestStoreJson, SignJob, SignOutcome } from "./backend";
import {
  GENERATOR_ASSERTION_LABEL,
  GENERATOR_NAME,
  TRAINED_ALGORITHMIC_MEDIA,
  VERSION,
} from "./constants";
import type { ImageMime } from "./mime";

const execFileAsync = promisify(execFile);
// Manifest-store JSON on stdout can carry embedded thumbnails from ingredients.
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * c2patool settings mirroring the offline discipline of settings.ts: no OCSP,
 * no remote-manifest fetch, no TSA. (c2pa-rs settings files require the
 * version fields; the trust section of the native settings has no c2pa-rs
 * equivalent — `verify.verify_trust` covers it.)
 */
const SETTINGS_NO_VERIFY = JSON.stringify({
  version_major: 1,
  version_minor: 0,
  verify: {
    verify_after_reading: false,
    verify_after_sign: false,
    verify_trust: false,
    ocsp_fetch: false,
    remote_manifest_fetch: false,
  },
  // The native builder adds no claim thumbnail; keep outputs equivalent.
  builder: { thumbnail: { enabled: false } },
});

const SETTINGS_VALIDATE = JSON.stringify({
  version_major: 1,
  version_minor: 0,
  verify: {
    verify_after_reading: true,
    verify_after_sign: false,
    verify_trust: true,
    ocsp_fetch: false,
    remote_manifest_fetch: false,
  },
});

function extensionOf(mimeType: ImageMime): string {
  return mimeType === "image/png" ? "png" : "jpg";
}

function isNoManifest(err: unknown): boolean {
  return err instanceof Error && "stderr" in err && /No claim found/i.test(String(err.stderr));
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const stderr = "stderr" in err ? String(err.stderr).trim() : "";
    return stderr !== "" ? stderr : err.message;
  }
  return String(err);
}

export function createC2patoolBackend(bin: string): C2paBackend {
  async function run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(bin, args, { maxBuffer: MAX_BUFFER });
    return stdout;
  }

  async function inTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "gsengai-c2patool-"));
    try {
      return await work(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function readStore(
    bytes: Buffer,
    mimeType: ImageMime,
    settingsJson: string,
  ): Promise<ManifestStoreJson | null> {
    return inTempDir(async (dir) => {
      const assetPath = join(dir, `asset.${extensionOf(mimeType)}`);
      const settingsPath = join(dir, "settings.json");
      await Promise.all([writeFile(assetPath, bytes), writeFile(settingsPath, settingsJson)]);
      let stdout: string;
      try {
        stdout = await run([assetPath, "--settings", settingsPath]);
      } catch (err) {
        if (isNoManifest(err)) {
          return null;
        }
        throw new Error(`gsengai: c2patool failed to read the manifest: ${describe(err)}`);
      }
      return JSON.parse(stdout) as ManifestStoreJson;
    });
  }

  return {
    name: "c2patool",

    peekStore(bytes, mimeType) {
      return readStore(bytes, mimeType, SETTINGS_NO_VERIFY);
    },

    validateStore(bytes, mimeType) {
      return readStore(bytes, mimeType, SETTINGS_VALIDATE);
    },

    async sign(job: SignJob): Promise<SignOutcome> {
      return inTempDir(async (dir) => {
        const ext = extensionOf(job.mimeType);
        const inputPath = join(dir, `input.${ext}`);
        const outputPath = job.outputPath ?? join(dir, `signed.${ext}`);
        const manifestPath = join(dir, "manifest.json");
        const settingsPath = join(dir, "settings.json");

        // Same manifest shape as the native builder (ADR-0019): one
        // claim_generator_info entry; model info in the created action and the
        // org.gsengai.generator assertion. On the edit path c2patool generates
        // the parent ingredient and its c2pa.opened action itself.
        const generatorInfo = { name: GENERATOR_NAME, version: VERSION };
        const manifest = {
          alg: "es256",
          sign_cert: job.certPath,
          private_key: job.keyPath,
          claim_generator_info: [generatorInfo],
          title: job.title,
          assertions: [
            ...(job.hasParent
              ? []
              : [
                  {
                    label: "c2pa.actions",
                    data: {
                      actions: [
                        {
                          action: "c2pa.created",
                          digitalSourceType: TRAINED_ALGORITHMIC_MEDIA,
                          softwareAgent: { name: job.model },
                          when: job.when,
                        },
                      ],
                    },
                  },
                ]),
            {
              label: GENERATOR_ASSERTION_LABEL,
              data: { generator: generatorInfo, model: job.model, when: job.when },
            },
          ],
        };
        await Promise.all([
          writeFile(inputPath, job.inputBytes),
          writeFile(manifestPath, JSON.stringify(manifest)),
          writeFile(settingsPath, SETTINGS_NO_VERIFY),
        ]);

        const args = [inputPath, "-m", manifestPath, "-o", outputPath, "-f"];
        args.push("--settings", settingsPath);
        if (job.hasParent) {
          args.push("-p", inputPath);
        } else {
          args.push("--create", TRAINED_ALGORITHMIC_MEDIA);
        }

        let stdout: string;
        try {
          stdout = await run(args);
        } catch (err) {
          throw new Error(`gsengai: c2patool signing failed: ${describe(err)}`);
        }

        const signedBytes = await readFile(outputPath);
        // c2patool prints the signed output's manifest store — its read-back.
        let manifestLabel: string | null | undefined;
        try {
          manifestLabel = (JSON.parse(stdout) as ManifestStoreJson).active_manifest;
        } catch {
          manifestLabel = (await readStore(signedBytes, job.mimeType, SETTINGS_NO_VERIFY))
            ?.active_manifest;
        }
        if (!manifestLabel) {
          throw new Error("gsengai: signed output has no readable active manifest");
        }
        return { signedBytes, manifestLabel };
      });
    },
  };
}
