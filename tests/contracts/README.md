# Contract tests (one file per join)
They call the REAL services and `parse` every response with the contract schema. Start the services first:
```bash
pnpm demo                 # leaves store, Safe Pay, Publisher running
pnpm test:contracts       # in another terminal
```
A join whose services are not running is skipped (not failed). Tests pass with store bugs on or off.

| File | Join |
| --- | --- |
| `safepay-store.test.ts` | Safe Pay → store order routes (Contract 3 + 6) |
| `publisher-store.test.ts` | Publisher http bindings → store |
| `publisher-safepay.test.ts` | Publisher safepay binding → Safe Pay |
| `crashtest-publisher.test.ts` | run header → `calls.jsonl` (Contract 2) |
| `crashtest-verify.test.ts` | Verify API (Contract 4) |
| `scanner-publisher.test.ts` | scanned manifest (Contract 1) → served tools |
| `crashtest-report.test.ts` | newest `report.json` (Contract 5) |
