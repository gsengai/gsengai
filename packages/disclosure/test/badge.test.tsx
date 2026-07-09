// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AIGeneratedBadge } from "@gsengai/disclosure";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const ICONS_DIR = fileURLToPath(new URL("../icons", import.meta.url));

/** A whitespace-free fingerprint of the official icon's first vector path. */
function iconPathFingerprint(file: string): string {
  const svg = readFileSync(join(ICONS_DIR, file), "utf8");
  const match = svg.match(/ d="([^"\s]{30,})/u);
  if (!match?.[1]) {
    throw new Error(`no path fingerprint found in ${file}`);
  }
  return match[1].slice(0, 40);
}

describe("<AIGeneratedBadge/> (Art. 50(4) surfacing)", () => {
  it("variant='generated' renders the official fully-AI-generated icon plus text label", () => {
    const html = renderToStaticMarkup(<AIGeneratedBadge variant="generated" />);
    expect(html).toContain(iconPathFingerprint("eu-ai-label-generated-black.svg"));
    expect(html).toContain("Fully AI-generated");
    expect(html).toContain("gsengai-ai-badge--generated");
  });

  it("variant='modified' renders the official partially-AI-modified icon", () => {
    const html = renderToStaticMarkup(<AIGeneratedBadge variant="modified" />);
    expect(html).toContain(iconPathFingerprint("eu-ai-label-modified-black.svg"));
    expect(html).toContain("Partially AI-modified");
  });

  it("variant='basic' renders the official basic icon (and is the default, ADR-0021)", () => {
    const explicit = renderToStaticMarkup(<AIGeneratedBadge variant="basic" />);
    expect(explicit).toContain(iconPathFingerprint("eu-ai-label-basic-black.svg"));
    expect(renderToStaticMarkup(<AIGeneratedBadge />)).toBe(explicit);
  });

  it("renders icon AND text by default — icon-only regression guard (ADR-0023)", () => {
    const html = renderToStaticMarkup(<AIGeneratedBadge />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<svg");
    expect(html).toMatch(/<span class="gsengai-disclosure-text">[^<]+<\/span>/u);
  });

  it("withIcon={false} still renders the visible text label (never label-less)", () => {
    const html = renderToStaticMarkup(<AIGeneratedBadge withIcon={false} />);
    expect(html).not.toContain("<svg");
    expect(html).toContain("AI-generated content");
  });

  it("colour treatments map to the matching official file", () => {
    const html = renderToStaticMarkup(
      <AIGeneratedBadge variant="generated" treatment="white-50" />,
    );
    expect(html).toContain(iconPathFingerprint("eu-ai-label-generated-white-50.svg"));
  });
});
