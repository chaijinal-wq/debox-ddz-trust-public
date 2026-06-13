# Game Core

Pure TypeScript package for deterministic card/deal logic, Dou Dizhu hand classification, settlement math, and future transcript replay.

This package should stay independent from React, DeBox, wallets, databases, and RPC clients. Server and frontend code may import it so that replay, settlement previews, and backend verification use the same rules.

Current rule coverage is intentionally incomplete and will be replaced or hardened after the `evaluate-doudizhu-rules-engine` change.
