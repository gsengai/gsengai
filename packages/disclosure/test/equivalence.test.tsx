// SPDX-License-Identifier: Apache-2.0
// The framework-agnostic HTML entry must stay structurally equivalent to the React
// render (ADR-0022). Both consume the same specs, so the outputs are compared verbatim.

import { AIGeneratedBadge, AIInteractionNotice, SyntheticContentLabel } from "@gsengai/disclosure";
import {
  aiGeneratedBadgeHTML,
  interactionNoticeHTML,
  syntheticContentLabelHTML,
} from "@gsengai/disclosure/html";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("plain-HTML entry ≡ React render", () => {
  it("interactionNoticeHTML matches <AIInteractionNotice/>", () => {
    expect(interactionNoticeHTML()).toBe(renderToStaticMarkup(<AIInteractionNotice />));
    expect(interactionNoticeHTML({ locale: "fr", className: "x" })).toBe(
      renderToStaticMarkup(<AIInteractionNotice locale="fr" className="x" />),
    );
  });

  it("aiGeneratedBadgeHTML matches <AIGeneratedBadge/> across variants and treatments", () => {
    expect(aiGeneratedBadgeHTML()).toBe(renderToStaticMarkup(<AIGeneratedBadge />));
    for (const variant of ["generated", "modified", "basic"] as const) {
      expect(aiGeneratedBadgeHTML({ variant, treatment: "white" })).toBe(
        renderToStaticMarkup(<AIGeneratedBadge variant={variant} treatment="white" />),
      );
    }
    expect(aiGeneratedBadgeHTML({ withIcon: false, locale: "de" })).toBe(
      renderToStaticMarkup(<AIGeneratedBadge withIcon={false} locale="de" />),
    );
  });

  it("syntheticContentLabelHTML matches <SyntheticContentLabel/>", () => {
    expect(syntheticContentLabelHTML()).toBe(renderToStaticMarkup(<SyntheticContentLabel />));
    expect(syntheticContentLabelHTML({ context: "public-interest-text", locale: "fr" })).toBe(
      renderToStaticMarkup(<SyntheticContentLabel context="public-interest-text" locale="fr" />),
    );
  });
});
