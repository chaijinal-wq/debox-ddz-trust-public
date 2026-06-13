# DeBox Dou Dizhu Public Trust Surface

This repository contains the public verification surface for the DeBox Dou Dizhu project.

It intentionally excludes authoritative server code, admin/support tooling, deployment files, runtime adapters, monitoring internals, generated operational artifacts, and secrets.

## What Is Included

- `packages/protocol`: public types and constants
- `packages/game-core`: deterministic rules, shuffle, settlement, transcript hashing
- `packages/verifier`: public transcript verifier CLI
- `contracts/escrow`: BOX escrow contract and local tests
- `docs`: trust, rules, settlement, threat model, and release verification docs

## Basic Commands

```bash
npm install
npm run build
npm run test
```

Verify a public transcript bundle after building:

```bash
node packages/verifier/dist/cli.js ./examples/round-transcript.json
```

Run the included sample bundle:

```bash
npm run verify:example
```

## License

MIT. See `LICENSE`.
