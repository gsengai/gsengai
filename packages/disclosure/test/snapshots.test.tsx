// SPDX-License-Identifier: Apache-2.0

import { AIGeneratedBadge, AIInteractionNotice, SyntheticContentLabel } from "@gsengai/disclosure";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("snapshots", () => {
  it("<AIInteractionNotice/> markup is stable", () => {
    expect(renderToStaticMarkup(<AIInteractionNotice />)).toMatchSnapshot();
    expect(renderToStaticMarkup(<AIInteractionNotice locale="de" />)).toMatchSnapshot();
  });

  it("<AIGeneratedBadge/> markup is stable (text part; icons pinned by icons.test)", () => {
    // Snapshot without the inline icon to keep snapshots reviewable; the full
    // icon markup is integrity-checked against the asset files in icons.test.ts.
    expect(
      renderToStaticMarkup(<AIGeneratedBadge withIcon={false} variant="generated" />),
    ).toMatchSnapshot();
    expect(renderToStaticMarkup(<AIGeneratedBadge withIcon={false} />)).toMatchSnapshot();
  });

  it("<SyntheticContentLabel/> markup is stable", () => {
    const html = renderToStaticMarkup(<SyntheticContentLabel locale="fr" />);
    // Strip the (large, integrity-checked) inline svg body for a reviewable snapshot.
    expect(html.replace(/<svg.*<\/svg>/u, "<svg…/>")).toMatchSnapshot();
  });
});
