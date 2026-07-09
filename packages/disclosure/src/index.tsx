// SPDX-License-Identifier: Apache-2.0
// React entry (@gsengai/disclosure): Article 50 disclosure components. These components
// render disclosure; they do not claim or establish legal sufficiency (see
// docs/DISCLOSURE.md and the limits block there). Pair with the shipped stylesheet:
// @gsengai/disclosure/disclosure.css.

import type { ReactElement } from "react";
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
  DisclosureSpec,
  IconTreatment,
  IconVariant,
  InteractionNoticeOptions,
  SyntheticContentLabelOptions,
} from "./spec.js";
export type { BadgeVariant, Locale, SyntheticContext } from "./strings.js";
export { STRINGS } from "./strings.js";

function renderSpec(spec: DisclosureSpec): ReactElement {
  const Tag = spec.tag;
  return (
    <Tag className={spec.className} role={spec.role} aria-label={spec.label}>
      {spec.iconSvg ? (
        <span
          className="gsengai-icon"
          aria-hidden="true"
          // Bundled official EU icon markup (static, sanitized at build time).
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static bundled asset
          dangerouslySetInnerHTML={{ __html: spec.iconSvg }}
        />
      ) : null}
      <span className="gsengai-disclosure-text">{spec.label}</span>
    </Tag>
  );
}

/** Art. 50(1) interaction disclosure: visible text notice, `role="note"` by default. */
export function AIInteractionNotice(props: InteractionNoticeOptions = {}): ReactElement {
  return renderSpec(interactionNoticeSpec(props));
}

/** Art. 50(4) AI-generated content badge: official EU icon + text label by default. */
export function AIGeneratedBadge(props: AIGeneratedBadgeOptions = {}): ReactElement {
  return renderSpec(aiGeneratedBadgeSpec(props));
}

/** Art. 50(4) deepfake / public-interest-text label: icon + clear text disclosure. */
export function SyntheticContentLabel(props: SyntheticContentLabelOptions = {}): ReactElement {
  return renderSpec(syntheticContentLabelSpec(props));
}
