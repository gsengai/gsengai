// SPDX-License-Identifier: Apache-2.0
// Opens an evidence store in its own process and prints its chain state —
// the competing opener in upgrade.test.ts's migration-race test.
// Usage: node --import tsx packages/core/test/helpers/open-store.ts <store path>
import { createEvidenceStore } from "../../src/index";

const path = process.argv[2];
if (path === undefined) {
  throw new Error("usage: open-store.ts <store path>");
}
const store = createEvidenceStore({ path });
process.stdout.write(JSON.stringify(store.verifyChain()));
store.close();
