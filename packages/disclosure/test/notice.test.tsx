// SPDX-License-Identifier: Apache-2.0

import { AIInteractionNotice } from "@gsengai/disclosure";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("<AIInteractionNotice/> (Art. 50(1))", () => {
  it("renders the default EN copy with role='note'", () => {
    const html = renderToStaticMarkup(<AIInteractionNotice />);
    expect(html).toContain('role="note"');
    expect(html).toContain("You are interacting with an AI system.");
  });

  it("renders the DE copy", () => {
    const html = renderToStaticMarkup(<AIInteractionNotice locale="de" />);
    expect(html).toContain("Sie interagieren mit einem KI-System.");
  });

  it("renders the FR copy", () => {
    const html = renderToStaticMarkup(<AIInteractionNotice locale="fr" />);
    // React escapes the apostrophe in attribute/text positions.
    expect(html).toContain("Vous interagissez avec un système d&#x27;IA.");
  });

  it("supports role='status' for notices injected at interaction start (ADR-0023)", () => {
    const html = renderToStaticMarkup(<AIInteractionNotice role="status" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("You are interacting with an AI system.");
  });

  it("merges a custom className after the base classes", () => {
    const html = renderToStaticMarkup(<AIInteractionNotice className="my-notice" />);
    expect(html).toContain('class="gsengai-disclosure gsengai-interaction-notice my-notice"');
  });
});
