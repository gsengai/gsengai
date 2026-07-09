// SPDX-License-Identifier: Apache-2.0
// Framework-agnostic entry (@gsengai/disclosure/html): functions returning HTML strings
// structurally identical to the React components' output (test-enforced). Pair with the
// shipped stylesheet: @gsengai/disclosure/disclosure.css.

import {
  type AIGeneratedBadgeOptions,
  aiGeneratedBadgeSpec,
  type DisclosureSpec,
  type InteractionNoticeOptions,
  interactionNoticeSpec,
  type SyntheticContentLabelOptions,
  syntheticContentLabelSpec,
} from "./spec.js";

export type {
  AIGeneratedBadgeOptions,
  InteractionNoticeOptions,
  SyntheticContentLabelOptions,
} from "./spec.js";
export type { BadgeVariant, Locale, SyntheticContext } from "./strings.js";

// Same character set React escapes, so both entries emit identical markup.
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] as string);
}

function renderSpec(spec: DisclosureSpec): string {
  const icon = spec.iconSvg
    ? `<span class="gsengai-icon" aria-hidden="true">${spec.iconSvg}</span>`
    : "";
  const text = `<span class="gsengai-disclosure-text">${escapeHtml(spec.label)}</span>`;
  const attrs = `class="${escapeHtml(spec.className)}" role="${spec.role}" aria-label="${escapeHtml(spec.label)}"`;
  return `<${spec.tag} ${attrs}>${icon}${text}</${spec.tag}>`;
}

/** Art. 50(1) interaction disclosure as an HTML string. */
export function interactionNoticeHTML(opts: InteractionNoticeOptions = {}): string {
  return renderSpec(interactionNoticeSpec(opts));
}

/** Art. 50(4) AI-generated content badge (official EU icon + text) as an HTML string. */
export function aiGeneratedBadgeHTML(opts: AIGeneratedBadgeOptions = {}): string {
  return renderSpec(aiGeneratedBadgeSpec(opts));
}

/** Art. 50(4) deepfake / public-interest-text label as an HTML string. */
export function syntheticContentLabelHTML(opts: SyntheticContentLabelOptions = {}): string {
  return renderSpec(syntheticContentLabelSpec(opts));
}
