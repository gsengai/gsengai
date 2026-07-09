// SPDX-License-Identifier: Apache-2.0
// Framework-neutral element specs shared by the React entry and the HTML-string entry.
// Both renderers consume the same spec, which keeps their output structurally identical
// (equivalence is test-enforced). a11y baseline (ADR-0023): a role and an accessible name
// on the container, visible text always present, icons always aria-hidden and paired with
// a text label — never icon-only.

import { ICON_SVGS, type IconTreatment, type IconVariant } from "./icon-svgs.js";
import { type BadgeVariant, type Locale, localeStrings, type SyntheticContext } from "./strings.js";

export type { IconTreatment, IconVariant };

export interface DisclosureSpec {
  tag: "div" | "span";
  /** Space-separated class list, base classes first. */
  className: string;
  role: "note" | "status";
  /** Accessible name; also the visible text (never icon-only). */
  label: string;
  /** Inline SVG markup for the icon slot; omitted → text-only. */
  iconSvg?: string;
}

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export interface InteractionNoticeOptions {
  locale?: Locale;
  /** Override the default localized copy. Must remain a visible AI disclosure. */
  text?: string;
  className?: string;
  /**
   * "note" for statically present notices (default); "status" when the notice is injected
   * at the start of a live interaction and should be announced.
   */
  role?: "note" | "status";
}

export function interactionNoticeSpec(opts: InteractionNoticeOptions = {}): DisclosureSpec {
  return {
    tag: "div",
    className: classes("gsengai-disclosure gsengai-interaction-notice", opts.className),
    role: opts.role ?? "note",
    label: opts.text ?? localeStrings(opts.locale).interactionNotice,
  };
}

export interface AIGeneratedBadgeOptions {
  /**
   * Maps to the three official EU icon variants (ADR-0021). The generated/modified
   * distinction is an optional presentation choice, not a legal requirement.
   */
  variant?: BadgeVariant;
  locale?: Locale;
  /** Override the default localized label. Must remain a visible AI disclosure. */
  label?: string;
  /** Icon is on by default; the text label always renders (ADR-0023). */
  withIcon?: boolean;
  /** Official colour treatment of the bundled icon; pick for contrast. */
  treatment?: IconTreatment;
  className?: string;
  /** Override the icon slot (defaults to the official EU icon for the variant). */
  iconSvg?: string;
}

export function aiGeneratedBadgeSpec(opts: AIGeneratedBadgeOptions = {}): DisclosureSpec {
  const variant = opts.variant ?? "basic";
  const spec: DisclosureSpec = {
    tag: "span",
    className: classes(
      `gsengai-disclosure gsengai-ai-badge gsengai-ai-badge--${variant}`,
      opts.className,
    ),
    role: "note",
    label: opts.label ?? localeStrings(opts.locale).badge[variant],
  };
  if (opts.withIcon !== false) {
    spec.iconSvg = opts.iconSvg ?? ICON_SVGS[variant][opts.treatment ?? "black"];
  }
  return spec;
}

export interface SyntheticContentLabelOptions {
  /** Art. 50(4) context: deepfake (default) or public-interest text. */
  context?: SyntheticContext;
  locale?: Locale;
  /** Override the default localized copy. Must remain a visible AI disclosure. */
  text?: string;
  /** Official colour treatment of the bundled icon; pick for contrast. */
  treatment?: IconTreatment;
  className?: string;
  /** Override the icon slot (defaults to the official EU basic icon). */
  iconSvg?: string;
}

export function syntheticContentLabelSpec(opts: SyntheticContentLabelOptions = {}): DisclosureSpec {
  const context = opts.context ?? "deepfake";
  return {
    tag: "div",
    className: classes(
      `gsengai-disclosure gsengai-synthetic-label gsengai-synthetic-label--${context}`,
      opts.className,
    ),
    role: "note",
    label: opts.text ?? localeStrings(opts.locale).synthetic[context],
    iconSvg: opts.iconSvg ?? ICON_SVGS.basic[opts.treatment ?? "black"],
  };
}
