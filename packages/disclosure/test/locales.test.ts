// SPDX-License-Identifier: Apache-2.0

import { STRINGS } from "@gsengai/disclosure";
import { describe, expect, it } from "vitest";

const LOCALES = ["en", "de", "fr"] as const;
const BADGE_VARIANTS = ["generated", "modified", "basic"] as const;
const SYNTHETIC_CONTEXTS = ["deepfake", "public-interest-text"] as const;

// The locale token every default string must carry ("AI" / "KI" / "IA").
const AI_TOKEN: Record<(typeof LOCALES)[number], RegExp> = {
  en: /\bAI\b|AI-/u,
  de: /\bKI\b|KI-/u,
  fr: /\bIA\b/u,
};

describe("locale coverage (EN/DE/FR, no missing keys)", () => {
  it("every component has a non-empty string for every locale", () => {
    for (const locale of LOCALES) {
      const table = STRINGS[locale];
      expect(table, `missing locale ${locale}`).toBeDefined();
      expect(table.interactionNotice.length).toBeGreaterThan(0);
      for (const variant of BADGE_VARIANTS) {
        expect(table.badge[variant], `${locale} badge.${variant}`).toBeTruthy();
      }
      for (const context of SYNTHETIC_CONTEXTS) {
        expect(table.synthetic[context], `${locale} synthetic.${context}`).toBeTruthy();
      }
    }
  });

  it("every default string discloses AI in the locale's own token", () => {
    for (const locale of LOCALES) {
      const table = STRINGS[locale];
      const all = [
        table.interactionNotice,
        ...BADGE_VARIANTS.map((v) => table.badge[v]),
        ...SYNTHETIC_CONTEXTS.map((c) => table.synthetic[c]),
      ];
      for (const s of all) {
        expect(AI_TOKEN[locale].test(s), `"${s}" (${locale}) lacks the AI token`).toBe(true);
      }
    }
  });
});
