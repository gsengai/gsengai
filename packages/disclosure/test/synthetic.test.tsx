// SPDX-License-Identifier: Apache-2.0

import { SyntheticContentLabel } from "@gsengai/disclosure";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("<SyntheticContentLabel/> (Art. 50(4) deepfake / public-interest text)", () => {
  it("renders a labelled icon+text disclosure with an accessible role", () => {
    const html = renderToStaticMarkup(<SyntheticContentLabel />);
    expect(html).toContain('role="note"');
    expect(html).toContain(
      'aria-label="This content was artificially generated or manipulated with AI."',
    );
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("This content was artificially generated or manipulated with AI.");
  });

  it("supports the public-interest-text context", () => {
    const html = renderToStaticMarkup(<SyntheticContentLabel context="public-interest-text" />);
    expect(html).toContain("This text was generated with AI.");
    expect(html).toContain("gsengai-synthetic-label--public-interest-text");
  });

  it("localizes (DE)", () => {
    const html = renderToStaticMarkup(<SyntheticContentLabel locale="de" />);
    expect(html).toContain("Dieser Inhalt wurde mit KI künstlich erzeugt oder verändert.");
  });
});
