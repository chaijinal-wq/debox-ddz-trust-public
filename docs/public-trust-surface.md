# Public Trust Surface

The project should not be open-sourced as one complete production repository. The public surface is a separate trust package that contains only the parts needed to verify fairness, settlement math, and escrow behavior.

## Open By Default

- `packages/protocol`: public constants, payload shapes, room transcript types, chain/asset constants.
- `packages/game-core`: card model, rule classification, deterministic shuffle, first-bidder derivation, settlement math, transcript hash-chain helpers.
- `packages/verifier`: CLI and library for checking public room transcripts.
- `contracts/escrow`: Solidity escrow source and local contract tests.
- trust docs: rules, shuffle commitment, settlement, threat model, release verification checklist.

## Private By Default

- `apps/server`: authoritative room lifecycle, action/session auth, anti-replay storage, relayer coordination, private room views.
- `apps/web`: DeBox adapters, wallet adapters, runtime UX, product assets, and any integration code that can expose platform behavior.
- admin/support console, operations scripts, deployment files, environment templates, monitoring internals, relayer runtime details, and all generated evidence artifacts.
- secrets, RPC URLs with credentials, DeBox app credentials, support/admin tokens, relayer keys, owner/treasury operational notes.

## Verification Contract

Every public transcript bundle should let an independent verifier check:

1. Transcript hash-chain continuity.
2. Server nonce reveal matches the pre-commitment.
3. Player ready nonces plus server nonce derive the same round seed.
4. Canonical deal, first bidder, disclosed hand counts, and bottom cards match `game-core`.
5. Settlement final balances conserve locked funds.
6. Fees match the published profit-only fee formula.
7. Settlement transcript hash points to the transcript event that the settlement committed to.

## Export Command

Generate the public trust tree from the private repository:

```bash
npm run trust:export
```

The default output is `artifacts/public-trust-surface`. To export into a separate local Git checkout:

```bash
npm run trust:export -- --out ../debox-ddz-trust-public
```

The exporter uses an allowlist. It does not copy `apps/server`, `apps/web`, `ops`, `.env*`, broad `artifacts`, or private deployment material.
