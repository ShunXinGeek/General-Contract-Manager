# Verification

`npm test` runs five dependency-free Node regression suites. `npm run check`
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

## Assistant retrieval verification

`node scripts/verify-assistant-browser.js` runs the smoke function and assistant
scenarios in isolated Chromium profiles using bundled Playwright (no installation,
provider calls, real credentials or user-profile clearing). Set
`GCM_PLAYWRIGHT_MODULE` / `GCM_BROWSER_EXECUTABLE` for existing alternative paths.

The 64 source-grounded questions in `tests/fixtures/retrieval-cases.json` are split
before tuning into alternating 32-case calibration and held-out partitions.
`node scripts/evaluate-retrieval.js --baseline` measures the recorded original
commit; omit `--baseline` for candidate, add `--heldout` for held-out partition.
`--output path.json` saves measurement artifacts. This is an OFFLINE comparison
with unavailable semantic APIs, not a live quality claim. Required sets are
minimum evidence labels, not exhaustive relevance labels; precision cannot be
inferred. Source heading duplicates are explicitly retained by the reader.

Optional live comparison:

```text
node scripts/evaluate-retrieval-live.js --config path-to-private-config.json --execute --output output/playwright/live-report.json
```

The caller-owned private JSON uses existing AI_CONFIG fields and must not be
committed. Its path may instead be passed in `GCM_EVAL_CONFIG`. Without config or
`--execute`, no live requests are made. A bounded run compares 32 held-out retrieval
cases and 16 representative answers per mode (160-call cap; no automatic replay).
`--index path-to-vector-records.json` optionally supplies an identical array of
vector records to both modes; without it semantic quality remains unassessed.
Both modes use the same provider adapter; old comparator keeps legacy index
eligibility and title-only reranking. Actual answers need source review before
claiming semantic improvement; structural validation does not establish it.
