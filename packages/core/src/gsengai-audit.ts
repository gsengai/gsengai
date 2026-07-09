#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Bin entry for `gsengai-audit` — all logic lives in (and is tested via) runAuditCli.
import { runAuditCli } from "./cli";

runAuditCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);
