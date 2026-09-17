# Verification

`npm test` runs three dependency-free Node regression suites. `npm run check`
checks every runtime/vendor/test JS file and manifest/lockfile consistency.

For browser smoke verification, serve this repository on localhost:8765 using an
ordinary static HTTP server, then open an **isolated** Playwright CLI session:

```text
playwright-cli -s=contract-repair open http://127.0.0.1:8765 --headed
playwright-cli -s=contract-repair snapshot
playwright-cli -s=contract-repair run-code --filename tests/browser-smoke.js
playwright-cli -s=contract-repair eval "() => window.browserSmokeResult"
```

The smoke function is intended for Playwright CLI, not `node` directly. It clears
only the isolated localhost test profile, imports `fixtures/recovery-contract.txt`
through the real file input/FileReader, edits/reloads/compares/reverts, checks search and
translation, restores cloud AI settings in a second clean browser context, sends
a mocked SSE chat response, then creates a third clean profile and reloads with
the network disabled after only one completed online installation. An uncached
probe request must fail while the full app and its dependencies load from cache.
Its screenshot goes to `output/playwright/regression-offline.png` (gitignored).
No real API keys, provider requests, Firebase account or production writes are used.
Some CLI versions return early when the native revert confirmation appears;
the script accepts that confirmation and continues. Read `browserSmokeResult`
to confirm the **entire** suite completed rather than treating an early return as a pass.

The mock replaces only remote cloud load/upload; sync, merge, actual browser
IndexedDB/localStorage, model selection, rendering and API request construction
are exercised. This does **not** validate deployed Firebase Auth/Firestore rules
or a real Netlify deployment. Use the Firebase Rules Playground for owner,
other-user and unauthenticated read/write cases on main/subcollection/batch paths.

Old snapshots without `originalContent` cannot recover a lost import baseline:
their surviving current body becomes an explicitly marked migration baseline.
Fresh imports and newly saved cloud snapshots retain the true import baseline.
