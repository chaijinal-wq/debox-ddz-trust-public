# Escrow Contract

Draft Solidity escrow for the DeBox Dou Dizhu room model.

This contract is visible so the fund flow can be discussed and tested early, but it is not production-ready. Before mainnet use it still needs a production relayer adapter, reproducible deployment/source verification, adversarial review, and an external audit.

The v1 target is BSC-only, with BOX deposits only. Players pay deposit/approval gas; the platform relayer pays Session settlement gas, and wallet-bound settlement results are released to the player address by the relayer transaction.

Current draft shape:

- Fixed BOX token address on BSC.
- Internal `availableBalance`, `activeSessionOf`, and legacy `pendingWithdrawal` accounting with exact BOX balance-delta checks.
- Relayer-controlled `lockForSession`, `settleSession`, `releaseAvailableBalance`, `releasePendingWithdrawal`, and `markManualReview`, plus user `withdrawAvailable`, `claimPendingWithdrawal`, and timeout `refundExpiredSession`.
- Session-level fee snapshot with initial `0.1%` fee, 24h minimum fee-change notice, and owner-announced future fee changes.
- Payload-bound settlement id and nonce replay protection.
- Owner pause switches for deposit, lock, and settlement paths while keeping withdrawal/claim/refund paths available.
- Profit-only fee guard and total locked-balance conservation check.

## Local Safety Tests

Run from the repo root:

```bash
npm run contract:check
```

The contract check compiles `DdzEscrowRoom.sol` and runs `node --test` unit tests on an EthereumJS VM. Tests install a mock BOX token at the fixed BSC BOX address, then exercise normal ERC-20 `mint`, `approve`, `transfer`, and `transferFrom` paths against the escrow.

Covered in the unit suite:

- `deposit` and `lockForSession`, including insufficient balance and one-active-Session-per-player rejection.
- Relayer/owner release of a player's available balance back to that same player address, including over-release and permission rejection.
- Settlement conservation using pre-fee final balances, net table routing, direct wallet withdrawal release, treasury fee transfer, and transfer-exactness rejection.
- Invalid totals, profit-only fee bounds, payload-bound settlement id, settlement id replay, and settlement nonce replay.
- Manual review entry, settlement from manual review, and timeout refund from manual review.
- Fee cap announcement, minimum notice, per-Session fee snapshot, pause controls, and owner/relayer permission boundaries.

## Local Relayer Integration Tests

Server tests include a test-only contract escrow adapter that implements the backend `EscrowAdapter` interface and submits `SettlementJob` data to local `DdzEscrowRoom.settleSession(...)` through the EthereumJS VM harness.

Covered in the server integration suite:

- Room `SettlementJob` confirmation through `SettlementCoordinator` and local escrow.
- Conversion of player settlement choices into escrow `withdrawToWallet` flags.
- txHash return, room release, transcript update, and withdrawal queue state.
- Relayer health failure retry and retry exhaustion to manual review.
- Contract rejection retry behavior for invalid settlement data.
- chain payload digest binding and settlement nonce replay through the backend relayer path.

Custody decision for v1:

- v1 intentionally keeps the low-friction trusted-relayer custody model. Per-player EIP-712 lock/settlement signatures are deferred to a v1.1/v2 upgrade path if user feedback or operating risk justifies the extra signature steps.
- This means relayer/owner key custody, exposure monitoring, pause/refund drills, support evidence, and incident compensation handling remain production-operational requirements.

Still missing before real BOX deployment:

- Production relayer worker that submits to BSC RPC, manages the relayer key, estimates gas, polls receipts, and reconciles events.
- Production confirmation polling/retry/manual-review tests across RPC failure, relayer gas shortage, pending transaction, reverted transaction, and duplicate nonce cases.
- Deployment script, BSC testnet or fork validation, source verification artifact, and independent review/audit remediation notes.
