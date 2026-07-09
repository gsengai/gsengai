// SPDX-License-Identifier: Apache-2.0
// Builds the rendered audit-report sample: sample data →
// the real `buildAuditReport` Markdown → HTML via marked, with the wide hash
// tables wrapped in a scroll container so they never clip. Server-only.
import { marked } from "marked";
import { BRAND } from "./brand";
import { withEphemeralStore } from "./ephemeral-store";

const SAMPLE_TEXTS = [
  "The quarterly summary was drafted with model assistance and reviewed by the team.",
  "Bonjour ! Voici la réponse générée pour la démonstration.",
  "A third sample generation, streamed and hashed delta by delta.",
];

export async function renderSampleReport(): Promise<string> {
  const markdown = await withEphemeralStore((store) => {
    for (const text of SAMPLE_TEXTS) {
      store.append({
        modality: "text",
        model: "example-model",
        systemId: `${BRAND}-demo/report-sample`,
        outputText: text,
        markingMethods: ["logging"],
      });
    }
    // A media-modality sample: hashes of sample bytes, marked as C2PA-signed.
    store.append({
      modality: "image",
      model: "example-image-model",
      systemId: `${BRAND}-demo/report-sample`,
      outputBytes: new TextEncoder().encode("sample signed-image bytes for the report demo"),
      markingMethods: ["c2pa"],
      manifestRef: "urn:c2pa:demo-sample-manifest",
    });
    return store.buildAuditReport().markdown;
  });
  const html = await marked.parse(markdown);
  // Wide hash tables scroll inside the article instead of clipping.
  return html
    .replaceAll("<table>", '<div class="table-scroll"><table>')
    .replaceAll("</table>", "</table></div>");
}
