// SPDX-License-Identifier: Apache-2.0
// Single source of truth for every user-facing disclosure string, consumed by both the
// React entry and the framework-agnostic HTML entry. Positioning law: these strings
// disclose; they never claim or promise compliance.

export type Locale = "en" | "de" | "fr";

export type BadgeVariant = "generated" | "modified" | "basic";

export type SyntheticContext = "deepfake" | "public-interest-text";

export interface LocaleStrings {
  interactionNotice: string;
  badge: Record<BadgeVariant, string>;
  synthetic: Record<SyntheticContext, string>;
}

export const STRINGS: Record<Locale, LocaleStrings> = {
  en: {
    interactionNotice: "You are interacting with an AI system.",
    badge: {
      generated: "Fully AI-generated",
      modified: "Partially AI-modified",
      basic: "AI-generated content",
    },
    synthetic: {
      deepfake: "This content was artificially generated or manipulated with AI.",
      "public-interest-text": "This text was generated with AI.",
    },
  },
  de: {
    interactionNotice: "Sie interagieren mit einem KI-System.",
    badge: {
      generated: "Vollständig KI-generiert",
      modified: "Teilweise mit KI verändert",
      basic: "KI-generierter Inhalt",
    },
    synthetic: {
      deepfake: "Dieser Inhalt wurde mit KI künstlich erzeugt oder verändert.",
      "public-interest-text": "Dieser Text wurde mit KI erstellt.",
    },
  },
  fr: {
    interactionNotice: "Vous interagissez avec un système d'IA.",
    badge: {
      generated: "Entièrement généré par IA",
      modified: "Partiellement modifié par IA",
      basic: "Contenu généré par IA",
    },
    synthetic: {
      deepfake: "Ce contenu a été généré ou manipulé artificiellement par IA.",
      "public-interest-text": "Ce texte a été généré par IA.",
    },
  },
};

export function localeStrings(locale: Locale | undefined): LocaleStrings {
  return STRINGS[locale ?? "en"] ?? STRINGS.en;
}
