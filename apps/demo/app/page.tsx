// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";
import { ImageFlow } from "../components/ImageFlow";
import { LimitsBlock } from "../components/LimitsBlock";
import { TextFlow } from "../components/TextFlow";
import { BRAND } from "../lib/brand";
import { NOT_LEGAL_ADVICE, TAGLINE } from "../lib/copy";

export default function DemoPage() {
  return (
    <main className="wrap">
      <header className="masthead">
        <span className="wordmark">{BRAND}</span>
        <span className="masthead-role">evidence layer demo</span>
      </header>

      <div className="hero">
        <h1>See the evidence layer work — no install, no API key.</h1>
        <p>{TAGLINE}</p>
      </div>

      <p className="privacy-strip">
        <span>Text is hashed in your browser — it never leaves this page</span>
        <span>Images are signed in memory and never persisted</span>
        <span>The demo store is in-memory, hash-only, wiped per request</span>
      </p>

      <div className="flows">
        <TextFlow />
        <ImageFlow />
      </div>

      <div className="report-teaser card" style={{ marginTop: 22 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>The artifact you hand your counsel</h2>
          <p className="card-sub" style={{ margin: "6px 0 0" }}>
            Every record above can be exported as CSV, JSONL, or a human-readable audit report with
            a chain-integrity section.
          </p>
        </div>
        <Link className="download" href="/audit-report-sample">
          View a rendered audit report sample →
        </Link>
      </div>

      <LimitsBlock />

      <footer className="site">
        <span>{BRAND} — a development demo that runs locally with no API key.</span>
        <span>{NOT_LEGAL_ADVICE}</span>
      </footer>
    </main>
  );
}
