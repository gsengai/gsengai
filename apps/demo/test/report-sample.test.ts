// SPDX-License-Identifier: Apache-2.0
// The rendered audit-report sample: real `buildAuditReport`
// output, rendered to HTML, §9 intact, integrity section present, and the wide
// hash tables wrapped so they scroll instead of clipping.
import { describe, expect, it } from "vitest";
import { renderSampleReport } from "../lib/report-sample";

describe("rendered audit-report sample", () => {
  it("renders the real report with integrity, records, and scrollable tables", async () => {
    const html = await renderSampleReport();
    // Integrity is surfaced (ADR-0025) — seeded stores verify clean.
    expect(html).toMatch(/Integrity/u);
    expect(html).toMatch(/Chain verified/u);
    // The sample mix: text + image modalities, logging + c2pa methods.
    expect(html).toContain("example-model");
    expect(html).toContain("example-image-model");
    expect(html).toContain("urn:c2pa:demo-sample-manifest");
    // §9 anchors survive the Markdown → HTML rendering.
    expect(html).toContain("What this does NOT do");
    expect(html).toContain(
      "It is not legal advice. Consult qualified counsel about your obligations.",
    );
    // Wide tables are wrapped in the scroll container.
    expect(html).toContain('<div class="table-scroll"><table>');
    expect(html).toContain("</table></div>");
    // No raw sample text needed — but hashes must be there.
    expect(html).toMatch(/[0-9a-f]{64}/u);
  });
});
