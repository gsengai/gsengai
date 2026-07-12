# @gsengai/disclosure

Article 50 disclosure UI kit: AI-interaction notices and AI-generated content labels as React components **and** plain-HTML string functions, localized EN/DE/FR, bundling the official EU transparency icons. Zero runtime dependencies. Supports compliance with **EU AI Act Article 50** and **California SB 942**.

Part of [gsengai](https://github.com/gsengai/gsengai), open-source transparency and provenance tooling for AI product teams.

## Install

```sh
pnpm add @gsengai/disclosure
```

Requires Node ≥ 22. React is an optional peer — the `@gsengai/disclosure/html` entry works without it.

## Usage

React:

```tsx
import { AIInteractionNotice, AIGeneratedBadge } from "@gsengai/disclosure";
import "@gsengai/disclosure/disclosure.css";

export function Chat() {
  return (
    <>
      <AIInteractionNotice />                  {/* "You are interacting with an AI system." */}
      {/* ...your chat UI... */}
      <AIGeneratedBadge variant="generated" /> {/* official EU icon + "Fully AI-generated" */}
    </>
  );
}
```

Not using React? The same components exist as plain-HTML string functions:

```ts
import { interactionNoticeHTML } from "@gsengai/disclosure/html";

const html = interactionNoticeHTML({ locale: "fr" });
```

`locale="de"` / `locale="fr"` switch the copy ("KI" / "IA"). One stylesheet (`disclosure.css`) styles both entries. The bundled icons are the official EU transparency icons published with the Code of Practice on marking and labelling of AI-generated content — read the caveats in [docs/DISCLOSURE.md](https://github.com/gsengai/gsengai/blob/main/docs/DISCLOSURE.md) before shipping them.

## Positioning

This package supports compliance with EU AI Act Article 50 and California SB 942. It does not make you compliant — compliance depends on your system, your deployment context, and your processes. It is not legal advice.

## License

Apache-2.0
