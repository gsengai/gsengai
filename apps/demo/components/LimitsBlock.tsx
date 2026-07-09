// SPDX-License-Identifier: Apache-2.0
// PRD §9 canonical limits block — rendered from the verbatim string in
// lib/copy.ts (never retyped, never paraphrased). Visible on the demo page.
import { S9_LIMIT_ITEMS } from "../lib/copy";

export function LimitsBlock() {
  return (
    <section className="limits" aria-labelledby="limits-heading">
      <h2 id="limits-heading">What this does NOT do</h2>
      <blockquote>
        <ul>
          {S9_LIMIT_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </blockquote>
    </section>
  );
}
