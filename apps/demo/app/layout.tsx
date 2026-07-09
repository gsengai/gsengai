// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND } from "../lib/brand";
import { TAGLINE } from "../lib/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND} — evidence layer demo`,
  description: TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
