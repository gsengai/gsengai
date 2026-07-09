// SPDX-License-Identifier: Apache-2.0
// a11y baseline (ADR-0023): every component exposes a role and an accessible name and is
// never icon-only — the visible text label always renders.

import { AIGeneratedBadge, AIInteractionNotice, SyntheticContentLabel } from "@gsengai/disclosure";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const CASES: ReadonlyArray<[string, string]> = [
  ["AIInteractionNotice", renderToStaticMarkup(<AIInteractionNotice />)],
  ["AIGeneratedBadge", renderToStaticMarkup(<AIGeneratedBadge />)],
  ["SyntheticContentLabel", renderToStaticMarkup(<SyntheticContentLabel />)],
];

describe("a11y roles and names (ADR-0023)", () => {
  it.each(CASES)("%s exposes a role and a non-empty accessible name", (_name, html) => {
    expect(html).toMatch(/role="(note|status)"/u);
    const label = html.match(/aria-label="([^"]+)"/u);
    expect(label?.[1]?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(CASES)("%s is never icon-only: visible text is present", (_name, html) => {
    const text = html.match(/<span class="gsengai-disclosure-text">([^<]+)<\/span>/u);
    expect(text?.[1]?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it.each(CASES)("%s marks any icon as decorative (aria-hidden)", (_name, html) => {
    if (html.includes("<svg")) {
      expect(html).toMatch(/<span class="gsengai-icon" aria-hidden="true">/u);
    }
  });
});
