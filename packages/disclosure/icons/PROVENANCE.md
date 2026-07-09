# PROVENANCE — EU transparency icons

The SVG files in this directory are the **official EU icons for labelling AI-generated
content**, published by the European Commission on **2026-06-10** as part of Section 2 of the
Code of Practice on marking and labelling of AI-generated content.

- **Source page:** https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content
- **Downloaded:** 2026-07-06 (SVG pack, Commission newsroom document 129546; a PNG pack is
  also available from the same page as document 129547 and is not bundled here)
- **Usage terms (as stated by the Commission):** the icons are made publicly available for
  everyone to use freely, without the need for attribution to the Commission or the AI Office.
- **Set:** 3 provenance variants (basic · fully AI-generated · partially AI-modified) × 4
  colour treatments (black, white, black 50% transparency, white 50% transparency) = 12 SVGs.

## Caveats (read before shipping these icons)

- Use of the EU icons is **optional**; the transparency obligations under Article 50 AI Act
  are not. Using these icons does **not by itself establish compliance**.
- Use of the icons by a **non-signatory** of the Code of Practice does not signal adherence
  to the Code.
- Signatories of the Code commit to the detailed placement specifications in Section 2 of the
  Code (first-exposure visibility, no intervening overlays, embedding rules). This library
  renders the icons; placement remains the integrator's responsibility.

## File integrity

Files are byte-identical to the Commission originals; only the filenames were normalized
(the original pack's filenames contain spaces and one Commission-side typo, `MOFIFIED`).

SHA-256 of the downloaded SVG pack (document 129546):
`5b58f85c91fec7c8ec201a0a2bfc367c2823e6031ae034e64a16024e27aea99f`

| Bundled file | Original filename in the pack | SHA-256 |
| --- | --- | --- |
| eu-ai-label-basic-black.svg | LABEL_AI_black.svg | 58ffe859a4d74829d397f534a988081bcefb716849c7d3b84fa7a026dd1d257f |
| eu-ai-label-basic-black-50.svg | LABEL_AI_black transparent.svg | f8e20f1dde8c7d95940da08960b1063620812acc9b4ea96eb5ad051f80f67c21 |
| eu-ai-label-basic-white.svg | LABEL_AI_white.svg | 5b3b94ae67fea55c4f2d013d0b8ed5b876c1533555ed0ed60e688f2f3ccf1a50 |
| eu-ai-label-basic-white-50.svg | LABEL_AI_white transparent.svg | 52d87cb3f6a191dba24796f745e1eeb80d342883acd1a2e6d856342ad853766c |
| eu-ai-label-generated-black.svg | LABEL_AI GENERATED_black.svg | 503af176b05fd725e68b0aa526977d31bcd657d74b15c6103a57ace81384940f |
| eu-ai-label-generated-black-50.svg | LABEL_AI GENERATED_black transparent.svg | 63d28ab55916b4548edff21d5fbcac065a13e5fb936e9b304ff0bada45f2fac1 |
| eu-ai-label-generated-white.svg | LABEL_AI GENERATED_white.svg | 10125cdef3fc60a351df72fe1266bb00ea046086921bd1bb20135f0f07b5ed36 |
| eu-ai-label-generated-white-50.svg | LABEL_AI GENERATED_white transparent.svg | d19736f6da9d38af3cffce8ba08f3f7658b573e1794c173fcd8b55a5c200ed44 |
| eu-ai-label-modified-black.svg | LABEL_AI MOFIFIED_black.svg | 2e7349e5eca4ee78eeef160dfef4545c31850932245373a07c5401e73e6599c0 |
| eu-ai-label-modified-black-50.svg | LABEL_AI MODIFIED_black transparent.svg | 9ab09f54c1ccef01799af43794cd93a8af6607ba9ac6b9526fb90a02be8ddf3d |
| eu-ai-label-modified-white.svg | LABEL_AI MODIFIED_white.svg | 0c72a7d569a1447e2982a843e156bd5f9cb2ab6f201943c6c68f988dc2f1bb6e |
| eu-ai-label-modified-white-50.svg | LABEL_AI MODIFIED_white transparent.svg | 7ccbce41f9f821a574007b32806ddb6d635ee8bbc5d753ccd05f66f5a3165845 |

The in-source copies used for inline rendering (`src/icon-svgs.ts`) are generated from these
files by `scripts/gen-disclosure-icons.mjs`, which only strips the XML declaration, removes
the root `id`/`data-name` attributes, prefixes the internal CSS class names to avoid
collisions when several icons are inlined into one document, and collapses whitespace. Path
data and styling are unchanged.
