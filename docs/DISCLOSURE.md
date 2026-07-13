# Disclosure UI kit (`@gsengai/disclosure`)

Framework-agnostic UI for the user-facing transparency notices under EU AI Act Article 50.
Every component ships twice — as a React component (main entry, peer dep `react >= 18`) and
as a plain-HTML string function (`@gsengai/disclosure/html`) — with one shared stylesheet and
EN/DE/FR localizations from a single string table. The package has zero runtime
dependencies.

These components render disclosure. They do not, and cannot, establish that a disclosure is
legally sufficient in your deployment context.

## Component → Article 50 duty map

| Component | HTML equivalent | Article 50 duty it supports |
| --- | --- | --- |
| `<AIInteractionNotice/>` | `interactionNoticeHTML()` | Art. 50(1): informing natural persons that they are interacting with an AI system (unless obvious from context). A duty the Act places on *providers*. |
| `<AIGeneratedBadge/>` | `aiGeneratedBadgeHTML()` | Art. 50(4) surfacing of content provenance: a visible label that content is AI-generated, complementing the machine-readable marking (Art. 50(2), a *provider* duty) done by the text/media pipelines. |
| `<SyntheticContentLabel/>` | `syntheticContentLabelHTML()` | Art. 50(4): disclosing deepfakes (AI-generated or manipulated image/audio/video resembling real persons, places, entities or events) and AI-generated text published to inform the public on matters of public interest. A duty the Act places on *deployers*. |

Whether you act as *provider* or *deployer* for a given system — and therefore which of these
duties are yours — is a legal determination the components cannot make for you; settle it with
qualified counsel. Likewise, Article 50 exemptions and limitations (evidently
artistic/creative/satirical works, content under human editorial control, uses authorised by
law) are the integrator's call — the components render whatever disclosure you decide is
required.

## Usage

React (pair with the shipped stylesheet):

```tsx
import { AIInteractionNotice, AIGeneratedBadge, SyntheticContentLabel } from "@gsengai/disclosure";
import "@gsengai/disclosure/disclosure.css";

<AIInteractionNotice locale="de" />                       // Art. 50(1) banner
<AIGeneratedBadge variant="generated" treatment="white" /> // icon + text chip
<SyntheticContentLabel context="deepfake" locale="fr" />   // prominent label
```

No React (server templates, static sites, any framework):

```ts
import { interactionNoticeHTML, aiGeneratedBadgeHTML } from "@gsengai/disclosure/html";

const banner = interactionNoticeHTML({ locale: "fr" });   // returns an HTML string
const badge = aiGeneratedBadgeHTML({ variant: "modified" });
```

Link the same stylesheet (`@gsengai/disclosure/disclosure.css`) — the HTML strings are
structurally identical to the React output (test-enforced), so one stylesheet styles both.

## The official EU transparency icons

The package bundles the official EU icons for labelling AI-generated content, published
2026-06-10 as part of Section 2 of the Code of Practice on marking and labelling of
AI-generated content: 3 provenance variants (basic · fully AI-generated · partially
AI-modified) × 4 colour treatments (black / white / each at 50% transparency), as SVG under
`packages/disclosure/icons/` with full provenance in
[`PROVENANCE.md`](../packages/disclosure/icons/PROVENANCE.md). The Commission makes them
freely usable with no attribution required.

Read these caveats before shipping them:

- **Using the EU icons does not by itself establish compliance.** The icons are optional;
  the Article 50 transparency obligations are not. Placement, timing (first exposure), and
  persistence requirements still apply to you.
- **Use by a non-signatory of the Code of Practice does not signal adherence to the Code.**
  Signatories commit to the detailed placement specifications in Section 2 of the Code.
- `AIGeneratedBadge`'s `variant` maps to the three official icons, but the
  fully-generated vs partially-modified distinction is an **optional presentation choice**
  (the Code dropped the mandatory taxonomy) — pick it editorially, not as a legal category.
  The default is the `basic` icon.
- The icon slot is overridable (`iconSvg`) if you must render your own marking instead.

## Accessibility

Commission user-testing found icon-plus-text outperforms icon-only, and the Code requires
disclosures to be clear, distinguishable, accessible, and recognizable at first
interaction/exposure. Accordingly (ADR-0023):

- Every component renders **visible text**; icons are decorative (`aria-hidden`) and never
  appear without a label. `withIcon={false}` exists; a text-less mode does not.
- Every component exposes a role (`note`, or `status` for notices injected at interaction
  start) and an accessible name (`aria-label`).
- Components are safe to render at first interaction/exposure: no focus traps, no
  interaction needed to perceive them. The four official colour treatments let you keep
  contrast on any background — choosing a treatment with sufficient contrast is part of
  your accessibility duty.

## Localization

EN/DE/FR string tables live in one module consumed by both entries; `locale` selects the
table (default `en`, unknown values fall back to `en`). Custom copy can be passed via
`text`/`label` — keep it a plain-language, visible AI disclosure.

## Out of scope (P1)

- **Audible disclaimers for audio content** — follows audio signing (P1); until then, audio
  disclosure needs your own player UI.
- The **interactive/uniform EU icon** proposed by the Code of Practice task force — not yet
  published; the icon slot is where it will land.
- Vue/Svelte/web-component wrappers and CMS plugins.

## Limits

> **What this does NOT do**
>
> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.
> - It does not embed imperceptible watermarks (MVP). It implements the signed-metadata and logging/fingerprinting layers of a multi-layer marking strategy.
> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.
> - It does not detect third-party AI content.
> - It is not legal advice. Consult qualified counsel about your obligations.
