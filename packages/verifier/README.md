# Verifier

Public verifier for DeBox Dou Dizhu trust evidence.

The package accepts a public trust bundle or a full room snapshot JSON and verifies:

- transcript hash-chain integrity
- server shuffle commitment and reveal
- canonical deal derivation through `game-core`
- first-bidder and disclosed card evidence
- profit-only fee and settlement conservation

Build from the repo root:

```bash
npm run build -w @debox-ddz/verifier
```

Verify a bundle:

```bash
npx debox-ddz-verify ./round-transcript.json
```
