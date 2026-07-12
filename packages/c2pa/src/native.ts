// SPDX-License-Identifier: Apache-2.0
// Native backend: @contentauth/c2pa-node. Only type imports here — the runtime
// module is dynamically imported by backend.ts so a dlopen failure on
// unsupported platforms is caught and routed to the c2patool fallback.
import { readFile } from "node:fs/promises";
import type * as C2paNode from "@contentauth/c2pa-node";
import type { C2paBackend, ManifestStoreJson, SignJob, SignOutcome } from "./backend";
import {
  GENERATOR_ASSERTION_LABEL,
  GENERATOR_NAME,
  TRAINED_ALGORITHMIC_MEDIA,
  VERSION,
} from "./constants";
import type { ImageMime } from "./mime";
import { OFFLINE_NO_VERIFY_SETTINGS, OFFLINE_VALIDATE_SETTINGS } from "./settings";

export function createNativeBackend(mod: typeof C2paNode): C2paBackend {
  const { Builder, LocalSigner, Reader } = mod;

  async function readStore(
    bytes: Buffer,
    mimeType: ImageMime,
    settings: typeof OFFLINE_NO_VERIFY_SETTINGS | typeof OFFLINE_VALIDATE_SETTINGS,
  ): Promise<ManifestStoreJson | null> {
    const reader = await Reader.fromAsset({ buffer: bytes, mimeType }, settings);
    if (!reader) {
      return null;
    }
    return reader.json() as ManifestStoreJson;
  }

  return {
    name: "native",

    peekStore(bytes, mimeType) {
      return readStore(bytes, mimeType, OFFLINE_NO_VERIFY_SETTINGS);
    },

    validateStore(bytes, mimeType) {
      return readStore(bytes, mimeType, OFFLINE_VALIDATE_SETTINGS);
    },

    async sign(job: SignJob): Promise<SignOutcome> {
      const builder = Builder.withJson(
        {
          // The backend allows exactly one claim_generator_info entry (ADR-0019);
          // model info lives in the created action and the org.gsengai.generator assertion.
          claim_generator_info: [{ name: GENERATOR_NAME, version: VERSION }],
          title: job.title,
        },
        OFFLINE_NO_VERIFY_SETTINGS,
      );
      if (job.hasParent) {
        // Edit path: the builder generates the parent ingredient and its
        // c2pa.opened action itself — adding our own opened action would drop
        // the ingredient reference and fail validation (ADR-0019).
        builder.setIntent("edit");
      } else {
        builder.setIntent({ create: TRAINED_ALGORITHMIC_MEDIA });
        builder.addAction(
          JSON.stringify({
            action: "c2pa.created",
            digitalSourceType: TRAINED_ALGORITHMIC_MEDIA,
            softwareAgent: { name: job.model },
            when: job.when,
          }),
        );
      }
      // Generator/model info + timestamp on both paths (PRD B2, ADR-0019).
      builder.addAssertion(GENERATOR_ASSERTION_LABEL, {
        generator: { name: GENERATOR_NAME, version: VERSION },
        model: job.model,
        when: job.when,
      });

      const signer = LocalSigner.newSigner(job.certBytes, job.keyBytes, "es256"); // no TSA URL — offline by design
      const asset = { buffer: job.inputBytes, mimeType: job.mimeType };
      let signedBytes: Buffer;
      if (job.outputPath !== undefined) {
        builder.sign(signer, asset, { path: job.outputPath });
        signedBytes = await readFile(job.outputPath);
      } else {
        const dest: { buffer: Buffer | null } = { buffer: null };
        builder.sign(signer, asset, dest);
        if (!dest.buffer) {
          throw new Error("gsengai: signing produced no output buffer");
        }
        signedBytes = dest.buffer;
      }

      const readBack = await Reader.fromAsset(
        { buffer: signedBytes, mimeType: job.mimeType },
        OFFLINE_NO_VERIFY_SETTINGS,
      );
      const manifestLabel = readBack?.activeLabel();
      if (!manifestLabel) {
        throw new Error("gsengai: signed output has no readable active manifest");
      }
      return { signedBytes, manifestLabel };
    },
  };
}
