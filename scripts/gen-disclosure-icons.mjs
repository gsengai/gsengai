// SPDX-License-Identifier: Apache-2.0
// Regenerates packages/disclosure/src/icon-svgs.ts from the bundled official EU icon SVGs.
// The transform is provenance-preserving (see icons/PROVENANCE.md): strip the XML
// declaration, drop the root id/data-name attributes, prefix internal CSS class names so
// several inlined icons never collide in one document, collapse whitespace.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("../packages/disclosure", import.meta.url));

const VARIANTS = ["basic", "generated", "modified"];
const TREATMENTS = ["black", "black-50", "white", "white-50"];

function inline(variant, treatment) {
  const file = join(pkgDir, "icons", `eu-ai-label-${variant}-${treatment}.svg`);
  const prefix = `gsengai-${variant}-${treatment.replace("-50", "t")}-`;
  return readFileSync(file, "utf8")
    .replace(/<\?xml[^?]*\?>/, "")
    .replace(/ id="Calque_1" data-name="Calque 1"/, "")
    .replaceAll("cls-", prefix)
    .replace(/\s+/gu, " ")
    .trim();
}

let out = `// SPDX-License-Identifier: Apache-2.0
// GENERATED FILE — do not edit by hand. Regenerate with:
//   node scripts/gen-disclosure-icons.mjs
// Inline copies of the official EU transparency icons bundled under ../icons/
// (see ../icons/PROVENANCE.md for source, terms, and the transform applied).

export type IconVariant = "basic" | "generated" | "modified";
export type IconTreatment = "black" | "black-50" | "white" | "white-50";

export const ICON_SVGS: Record<IconVariant, Record<IconTreatment, string>> = {
`;

for (const variant of VARIANTS) {
  out += `  ${JSON.stringify(variant)}: {\n`;
  for (const treatment of TREATMENTS) {
    out += `    ${JSON.stringify(treatment)}: ${JSON.stringify(inline(variant, treatment))},\n`;
  }
  out += "  },\n";
}
out += "};\n";

writeFileSync(join(pkgDir, "src", "icon-svgs.ts"), out);
console.log("wrote packages/disclosure/src/icon-svgs.ts");
