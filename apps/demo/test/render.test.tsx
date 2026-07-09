// SPDX-License-Identifier: Apache-2.0
// Render/a11y smoke over both flows: labelled controls, headings, the
// statically visible dev-cert caveat, role="status" on the chain badge, and
// the §9 items in the limits block.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChainBadge, EvidenceRecordView } from "../components/EvidenceRecordView";
import { ImageFlow } from "../components/ImageFlow";
import { LimitsBlock } from "../components/LimitsBlock";
import { TextFlow } from "../components/TextFlow";
import { DEV_CERT_CAVEAT, S9_LIMIT_ITEMS } from "../lib/copy";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

describe("render/a11y smoke (both flows)", () => {
  it("TextFlow: labelled textarea, named button, headed section", () => {
    const html = renderToStaticMarkup(<TextFlow />);
    const labelFor = html.match(/<label[^>]*for="([^"]+)"/u)?.[1];
    expect(labelFor).toBeTruthy();
    expect(html).toContain(`<textarea id="${labelFor}"`);
    expect(html).toContain("Generate evidence");
    expect(html).toMatch(/<section[^>]*aria-labelledby=/u);
    expect(html).toContain("never leaves this page");
  });

  it("ImageFlow: labelled file input, named button, caveat visible before any result", () => {
    const html = renderToStaticMarkup(<ImageFlow />);
    const labelFor = html.match(/<label[^>]*for="([^"]+)"/u)?.[1];
    expect(labelFor).toBeTruthy();
    expect(html).toContain(`id="${labelFor}"`);
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).toContain("Sign with C2PA");
    // ADR-0030: the caveat is part of the initial view — no result needed.
    expect(html).toContain(escapeHtml(DEV_CERT_CAVEAT));
  });

  it("ChainBadge announces its outcome via role=status", () => {
    const ok = renderToStaticMarkup(<ChainBadge chain={{ ok: true, checked: 3 }} />);
    expect(ok).toContain('role="status"');
    expect(ok).toContain("Chain verified — 3 records checked");
    const bad = renderToStaticMarkup(
      <ChainBadge chain={{ ok: false, checked: 2, brokenAtSeq: 2 }} />,
    );
    expect(bad).toContain("Chain BROKEN at seq 2");
  });

  it("EvidenceRecordView renders every §4 field with row headers", () => {
    const html = renderToStaticMarkup(
      <EvidenceRecordView
        record={{
          id: "00000000-0000-4000-8000-000000000000",
          ts: "2026-07-07T00:00:00.000Z",
          modality: "text",
          model: "example-model",
          system_id: "gsengai-demo/text-flow",
          prompt_hash: null,
          output_hash: "a".repeat(64),
          output_hash_normalized: "b".repeat(64),
          hash_version: 1,
          marking_methods: ["logging"],
          manifest_ref: null,
          disclosure_context: null,
          prev_hash: null,
          record_hash: "c".repeat(64),
        }}
      />,
    );
    for (const field of ["output_hash", "record_hash", "system_id", "marking_methods"]) {
      expect(html).toContain(`<th scope="row">${field}</th>`);
    }
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("no raw content is stored");
  });

  it("LimitsBlock renders the full §9 list under its heading", () => {
    const html = renderToStaticMarkup(<LimitsBlock />);
    expect(html).toContain("What this does NOT do");
    for (const item of S9_LIMIT_ITEMS) {
      expect(html).toContain(escapeHtml(item));
    }
  });
});
