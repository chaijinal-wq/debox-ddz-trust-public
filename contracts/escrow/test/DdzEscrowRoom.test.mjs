import test from "node:test";
import assert from "node:assert/strict";
import { INITIAL_FEE_RATE_BPS, bytes32, createEscrowHarness } from "./helpers/evm.mjs";

const PLAYERS = ["p1", "p2", "p3"];
const EXTRA_PLAYERS = ["p4", "p5", "p6"];
const DEPOSIT = 200_000n;
const LOCK = 100_000n;
const FEE_RATE = Number(INITIAL_FEE_RATE_BPS);

async function fundPlayers(harness, players = PLAYERS, depositAmount = DEPOSIT) {
  for (const player of players) {
    await harness.mintApproveDeposit(player, depositAmount);
  }
}

async function lockSession(harness, label, players = PLAYERS, lockAmount = LOCK) {
  const sessionId = bytes32(label);
  await harness.write(harness.escrow, "relayer", "lockForSession", [
    sessionId,
    harness.addressesOf(players),
    [lockAmount, lockAmount, lockAmount],
  ]);
  return sessionId;
}

async function fundAndLock(harness, label, players = PLAYERS) {
  await fundPlayers(harness, players);
  return lockSession(harness, label, players);
}

async function settleStandardSession(harness, sessionId, {
  settlementId,
  nonceLabel = "nonce",
  transcriptLabel = "transcript",
  finalBalances = [120_000n, 90_000n, 90_000n],
  fees = [20n, 0n, 0n],
  withdrawToWallet = [false, false, false],
  feeRateBps = FEE_RATE,
} = {}) {
  const settlementNonce = bytes32(nonceLabel);
  const transcriptHash = bytes32(transcriptLabel);
  const digest = settlementId ?? await harness.scalar(harness.escrow, "computeSettlementId", [
    sessionId,
    settlementNonce,
    finalBalances,
    fees,
    withdrawToWallet,
    transcriptHash,
    feeRateBps,
  ]);
  await harness.write(harness.escrow, "relayer", "settleSession", [
    sessionId,
    digest,
    settlementNonce,
    finalBalances,
    fees,
    withdrawToWallet,
    transcriptHash,
    feeRateBps,
  ]);
  return digest;
}

test("deposit and lock move BOX into one active Session only", async () => {
  const h = await createEscrowHarness();
  await h.mintApproveDeposit("p1", 150_000n);
  assert.equal(await h.available("p1"), 150_000n);
  assert.equal(await h.boxBalance(h.escrow.address), 150_000n);

  await fundPlayers(h, ["p2", "p3"], 150_000n);
  const sessionId = await lockSession(h, "deposit-lock", PLAYERS, 100_000n);

  assert.equal(await h.available("p1"), 50_000n);
  assert.equal(await h.available("p2"), 50_000n);
  assert.equal(await h.available("p3"), 50_000n);
  assert.equal(await h.activeSessionOf("p1"), sessionId);

  const snapshot = await h.read(h.escrow, "sessionSnapshot", [sessionId]);
  assert.deepEqual([...snapshot[0]].map((address) => address.toLowerCase()), h.addressesOf(PLAYERS));
  assert.deepEqual([...snapshot[1]], [100_000n, 100_000n, 100_000n]);
  assert.equal(snapshot[2], 300_000n);
  assert.equal(snapshot[3], INITIAL_FEE_RATE_BPS);
  assert.equal(snapshot[4], 1n);

  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "lockForSession", [
      bytes32("insufficient"),
      h.addressesOf(EXTRA_PLAYERS),
      [1n, 1n, 1n],
    ]),
    "insufficient balance lock",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "lockForSession", [
      bytes32("active-reuse"),
      h.addressesOf(["p1", "p4", "p5"]),
      [1n, 1n, 1n],
    ]),
    "active player lock",
  );
});

test("relayer can increase one active player's locked balance in the same Session", async () => {
  const h = await createEscrowHarness();
  await fundPlayers(h);
  const sessionId = await lockSession(h, "increase-session-lock");

  await h.write(h.escrow, "relayer", "increaseSessionLock", [sessionId, h.addressOf("p1"), 50_000n]);

  assert.equal(await h.available("p1"), 50_000n);
  assert.equal(await h.available("p2"), 100_000n);
  assert.equal(await h.available("p3"), 100_000n);

  const snapshot = await h.read(h.escrow, "sessionSnapshot", [sessionId]);
  assert.deepEqual([...snapshot[1]], [150_000n, 100_000n, 100_000n]);
  assert.equal(snapshot[2], 350_000n);

  await settleStandardSession(h, sessionId, {
    finalBalances: [170_000n, 90_000n, 90_000n],
    fees: [20n, 0n, 0n],
  });
  assert.equal(await h.available("p1"), 219_980n);
  assert.equal(await h.available("p2"), 190_000n);
  assert.equal(await h.available("p3"), 190_000n);
});

test("increaseSessionLock rejects unauthorized actors and invalid active Session state", async () => {
  const h = await createEscrowHarness();
  await fundPlayers(h, [...PLAYERS, "p4"]);
  const sessionId = await lockSession(h, "increase-rejections");

  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "increaseSessionLock", [sessionId, h.addressOf("p1"), 1n]),
    "unauthorized increase",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "increaseSessionLock", [sessionId, h.addressOf("p4"), 1n]),
    "non active player increase",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "increaseSessionLock", [sessionId, h.addressOf("p1"), 100_001n]),
    "insufficient available increase",
  );

  await h.write(h.escrow, "owner", "setPauseState", [false, true, false]);
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "increaseSessionLock", [sessionId, h.addressOf("p1"), 1n]),
    "paused increase",
  );
  await h.write(h.escrow, "owner", "setPauseState", [false, false, false]);

  await settleStandardSession(h, sessionId, {
    finalBalances: [100_000n, 100_000n, 100_000n],
    fees: [0n, 0n, 0n],
  });
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "increaseSessionLock", [sessionId, h.addressOf("p1"), 1n]),
    "settled increase",
  );
});

test("self-service withdrawals, exact BOX receipt accounting, and pause controls", async () => {
  const h = await createEscrowHarness();
  await h.mintApproveDeposit("p1", 150_000n);

  await h.write(h.escrow, "p1", "withdrawAvailable", [50_000n]);
  assert.equal(await h.available("p1"), 100_000n);
  assert.equal(await h.boxBalance("p1"), 50_000n);
  assert.equal(await h.boxBalance(h.escrow.address), 100_000n);

  await h.expectRevert(
    () => h.write(h.escrow, "p1", "withdrawAvailable", [100_001n]),
    "withdraw more than available",
  );

  await fundPlayers(h, ["p2", "p3"], 150_000n);
  await h.write(h.escrow, "owner", "setPauseState", [true, true, true]);
  assert.equal(await h.scalar(h.escrow, "depositsPaused"), true);
  assert.equal(await h.scalar(h.escrow, "lockingPaused"), true);
  assert.equal(await h.scalar(h.escrow, "settlementPaused"), true);

  await h.write(h.box, "owner", "mint", [h.addressOf("p4"), 10_000n]);
  await h.write(h.box, "p4", "approve", [h.escrow.address, 10_000n]);
  await h.expectRevert(
    () => h.write(h.escrow, "p4", "deposit", [10_000n]),
    "deposit while paused",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "lockForSession", [
      bytes32("paused-lock"),
      h.addressesOf(PLAYERS),
      [LOCK, LOCK, LOCK],
    ]),
    "lock while paused",
  );

  await h.write(h.escrow, "owner", "setPauseState", [false, false, true]);
  const sessionId = await lockSession(h, "paused-settle");
  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      finalBalances: [100_000n, 100_000n, 100_000n],
      fees: [0n, 0n, 0n],
    }),
    "settlement while paused",
  );
  await h.write(h.escrow, "owner", "setPauseState", [false, false, false]);
  await settleStandardSession(h, sessionId, {
    finalBalances: [100_000n, 100_000n, 100_000n],
    fees: [0n, 0n, 0n],
  });
});

test("relayer releases available balance back to the owning player only", async () => {
  const h = await createEscrowHarness();
  await h.mintApproveDeposit("p1", 150_000n);

  const firstReleaseId = bytes32("release-p1-40");
  const secondReleaseId = bytes32("release-p1-10");
  await h.write(h.escrow, "relayer", "releaseAvailableBalance", [h.addressOf("p1"), 40_000n, firstReleaseId]);
  assert.equal(await h.available("p1"), 110_000n);
  assert.equal(await h.boxBalance("p1"), 40_000n);
  assert.equal(await h.boxBalance(h.escrow.address), 110_000n);
  assert.equal(await h.scalar(h.escrow, "usedAvailableBalanceReleaseIds", [firstReleaseId]), true);

  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "releaseAvailableBalance", [h.addressOf("p1"), 40_000n, firstReleaseId]),
    "reused release id",
  );

  await h.write(h.escrow, "owner", "releaseAvailableBalance", [h.addressOf("p1"), 10_000n, secondReleaseId]);
  assert.equal(await h.available("p1"), 100_000n);
  assert.equal(await h.boxBalance("p1"), 50_000n);
  assert.equal(await h.boxBalance(h.escrow.address), 100_000n);

  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "releaseAvailableBalance", [h.addressOf("p1"), 100_001n, bytes32("release-too-much")]),
    "release more than available",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "releaseAvailableBalance", [h.addressOf("p1"), 0n, bytes32("release-zero")]),
    "release zero available balance",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "releaseAvailableBalance", [h.addressOf("p1"), 1n, `0x${"0".repeat(64)}`]),
    "release zero id",
  );
});

test("deposit rejects non-1:1 BOX transfer receipts", async () => {
  const h = await createEscrowHarness();
  await h.write(h.box, "owner", "setTransferFeeBps", [100]);
  await h.write(h.box, "owner", "mint", [h.addressOf("p1"), 10_000n]);
  await h.write(h.box, "p1", "approve", [h.escrow.address, 10_000n]);

  await h.expectRevert(
    () => h.write(h.escrow, "p1", "deposit", [10_000n]),
    "fee-on-transfer deposit",
  );
  assert.equal(await h.available("p1"), 0n);
  assert.equal(await h.boxBalance(h.escrow.address), 0n);
});

test("valid settlement conserves balances, routes table balance, and releases wallet withdrawals", async () => {
  const h = await createEscrowHarness();
  const sessionId = await fundAndLock(h, "valid-settlement");

  await settleStandardSession(h, sessionId, {
    withdrawToWallet: [false, true, false],
  });

  assert.equal(await h.available("p1"), 219_980n);
  assert.equal(await h.available("p2"), 100_000n);
  assert.equal(await h.available("p3"), 190_000n);
  assert.equal(await h.pending("p2"), 0n);
  assert.equal(await h.boxBalance(h.addressOf("p2")), 90_000n);
  assert.equal(await h.boxBalance(h.addressOf("treasury")), 20n);
  assert.equal(await h.boxBalance(h.escrow.address), 509_980n);
});

test("settlement rejects non-1:1 BOX fee transfers", async () => {
  const h = await createEscrowHarness();
  const sessionId = await fundAndLock(h, "fee-transfer-exactness");
  await h.write(h.box, "owner", "setTransferFeeBps", [100]);

  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      finalBalances: [200_000n, 50_000n, 50_000n],
      fees: [100n, 0n, 0n],
    }),
    "fee-on-transfer treasury payout",
  );

  const snapshot = await h.read(h.escrow, "sessionSnapshot", [sessionId]);
  assert.equal(snapshot[4], 1n);
  assert.equal(await h.boxBalance(h.addressOf("treasury")), 0n);
});

test("settlement rejects non-1:1 BOX wallet withdrawals", async () => {
  const h = await createEscrowHarness();
  const sessionId = await fundAndLock(h, "withdrawal-transfer-exactness");
  await h.write(h.box, "owner", "setTransferFeeBps", [100]);

  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      withdrawToWallet: [false, true, false],
    }),
    "fee-on-transfer wallet withdrawal",
  );

  const snapshot = await h.read(h.escrow, "sessionSnapshot", [sessionId]);
  assert.equal(snapshot[4], 1n);
  assert.equal(await h.pending("p2"), 0n);
  assert.equal(await h.boxBalance(h.addressOf("p2")), 0n);
});

test("settlement rejects non-conservation and invalid profit-only fees", async () => {
  const h = await createEscrowHarness();
  const sessionId = await fundAndLock(h, "invalid-settlement");

  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      nonceLabel: "bad-total-nonce",
      finalBalances: [120_000n, 90_000n, 89_999n],
      fees: [20n, 0n, 0n],
    }),
    "non-conserving settlement",
  );

  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      nonceLabel: "loss-fee-nonce",
      finalBalances: [99_999n, 100_001n, 100_000n],
      fees: [1n, 0n, 0n],
    }),
    "fee on losing player",
  );

  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      nonceLabel: "over-rate-nonce",
      finalBalances: [119_980n, 90_020n, 90_000n],
      fees: [20n, 0n, 0n],
    }),
    "fee above fee-rate calculation",
  );

  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      nonceLabel: "fee-above-final-nonce",
      finalBalances: [1n, 199_999n, 100_000n],
      fees: [2n, 0n, 0n],
    }),
    "fee above final balance",
  );
});

test("settlement id is bound to full payload and rejects mutated settlement data", async () => {
  const h = await createEscrowHarness();
  const sessionId = await fundAndLock(h, "payload-bound-settlement");
  const settlementNonce = bytes32("payload-bound-nonce");
  const transcriptHash = bytes32("payload-bound-transcript");
  const expectedId = await h.scalar(h.escrow, "computeSettlementId", [
    sessionId,
    settlementNonce,
    [100_000n, 100_000n, 100_000n],
    [0n, 0n, 0n],
    [false, false, false],
    transcriptHash,
    FEE_RATE,
  ]);

  await h.expectRevert(
    () => h.write(h.escrow, "relayer", "settleSession", [
      sessionId,
      expectedId,
      settlementNonce,
      [120_000n, 90_000n, 90_000n],
      [20n, 0n, 0n],
      [false, false, false],
      transcriptHash,
      FEE_RATE,
    ]),
    "mutated settlement payload",
  );
});

test("settlement id and nonce cannot be replayed across Sessions", async () => {
  const h = await createEscrowHarness();
  await fundPlayers(h);

  const firstSession = await lockSession(h, "replay-source");
  const firstSettlementId = await settleStandardSession(h, firstSession, {
    nonceLabel: "replay-nonce",
    finalBalances: [100_000n, 100_000n, 100_000n],
    fees: [0n, 0n, 0n],
  });

  const sameIdSession = await lockSession(h, "same-id-target");
  await h.expectRevert(
    () => settleStandardSession(h, sameIdSession, {
      settlementId: firstSettlementId,
      nonceLabel: "fresh-nonce",
      finalBalances: [100_000n, 100_000n, 100_000n],
      fees: [0n, 0n, 0n],
    }),
    "settlement id replay",
  );

  const h2 = await createEscrowHarness();
  await fundPlayers(h2);
  const nonceSourceSession = await lockSession(h2, "nonce-source");
  await settleStandardSession(h2, nonceSourceSession, {
    nonceLabel: "replayed-nonce",
    finalBalances: [100_000n, 100_000n, 100_000n],
    fees: [0n, 0n, 0n],
  });
  const sameNonceSession = await lockSession(h2, "same-nonce-target");
  await h2.expectRevert(
    () => settleStandardSession(h2, sameNonceSession, {
      nonceLabel: "replayed-nonce",
      finalBalances: [100_000n, 100_000n, 100_000n],
      fees: [0n, 0n, 0n],
    }),
    "settlement nonce replay",
  );
});

test("manual review can be marked by relayer or owner and settled afterward", async () => {
  const h = await createEscrowHarness();
  const sessionId = await fundAndLock(h, "manual-review");

  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "markManualReview", [sessionId, "not allowed"]),
    "unauthorized manual review",
  );

  await h.write(h.escrow, "relayer", "markManualReview", [sessionId, "relayer escalation"]);
  let snapshot = await h.read(h.escrow, "sessionSnapshot", [sessionId]);
  assert.equal(snapshot[4], 3n);

  await settleStandardSession(h, sessionId, {
    finalBalances: [100_000n, 100_000n, 100_000n],
    fees: [0n, 0n, 0n],
  });
  snapshot = await h.read(h.escrow, "sessionSnapshot", [sessionId]);
  assert.equal(snapshot[4], 2n);
  await h.expectRevert(
    () => h.write(h.escrow, "owner", "markManualReview", [sessionId, "after settlement"]),
    "manual review after settlement",
  );

  const h2 = await createEscrowHarness();
  const ownerSession = await fundAndLock(h2, "owner-manual-review");
  await h2.write(h2.escrow, "owner", "markManualReview", [ownerSession, "owner escalation"]);
  const ownerSnapshot = await h2.read(h2.escrow, "sessionSnapshot", [ownerSession]);
  assert.equal(ownerSnapshot[4], 3n);
});

test("locked or manual-review sessions can be refunded after timeout", async () => {
  const h = await createEscrowHarness();
  const sessionId = await fundAndLock(h, "manual-review-refund");
  await h.write(h.escrow, "relayer", "markManualReview", [sessionId, "relayer unavailable"]);

  await h.expectRevert(
    () => h.write(h.escrow, "p1", "refundExpiredSession", [sessionId]),
    "refund before timeout",
  );

  const refundDelay = await h.scalar(h.escrow, "SESSION_REFUND_DELAY_SECONDS");
  h.increaseTime(refundDelay + 1n);
  await h.write(h.escrow, "p1", "refundExpiredSession", [sessionId]);

  const snapshot = await h.read(h.escrow, "sessionSnapshot", [sessionId]);
  assert.equal(snapshot[4], 4n);
  assert.equal(await h.available("p1"), DEPOSIT);
  assert.equal(await h.available("p2"), DEPOSIT);
  assert.equal(await h.available("p3"), DEPOSIT);
  assert.equal(await h.activeSessionOf("p1"), `0x${"00".repeat(32)}`);
  await h.expectRevert(
    () => settleStandardSession(h, sessionId, {
      finalBalances: [100_000n, 100_000n, 100_000n],
      fees: [0n, 0n, 0n],
    }),
    "settle refunded Session",
  );
});

test("fee cap, fee snapshots, and permission boundaries are enforced", async () => {
  const h = await createEscrowHarness({ feeRateMaxBps: 100n });
  await fundPlayers(h, [...PLAYERS, ...EXTRA_PLAYERS]);
  const firstSession = await lockSession(h, "fee-snapshot-old", PLAYERS);

  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "lockForSession", [
      bytes32("unauthorized-lock"),
      h.addressesOf(EXTRA_PLAYERS),
      [LOCK, LOCK, LOCK],
    ]),
    "unauthorized lock",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "settleSession", [
      firstSession,
      bytes32("outsider-settlement"),
      bytes32("outsider-nonce"),
      [100_000n, 100_000n, 100_000n],
      [0n, 0n, 0n],
      [false, false, false],
      bytes32("outsider-transcript"),
      FEE_RATE,
    ]),
    "unauthorized settlement",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "releasePendingWithdrawal", [h.addressOf("p1"), 1n]),
    "unauthorized release",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "releaseAvailableBalance", [h.addressOf("p1"), 1n, bytes32("unauthorized-release")]),
    "unauthorized available release",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "markManualReview", [firstSession, "not allowed"]),
    "unauthorized manual review",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "setRelayer", [h.addressOf("outsider")]),
    "unauthorized relayer change",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "setFeeTreasury", [h.addressOf("outsider")]),
    "unauthorized treasury change",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "transferOwnership", [h.addressOf("outsider")]),
    "unauthorized owner change",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "outsider", "setPauseState", [true, true, true]),
    "unauthorized pause",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "owner", "announceFeeRate", [101, h.timestamp + 60n, "above cap"]),
    "fee rate above cap",
  );
  await h.expectRevert(
    () => h.write(h.escrow, "owner", "announceFeeRate", [20, h.timestamp + 60n, "too soon"]),
    "fee notice too short",
  );

  const feeNotice = await h.scalar(h.escrow, "MIN_FEE_RATE_NOTICE_SECONDS");
  await h.write(h.escrow, "owner", "announceFeeRate", [20, h.timestamp + feeNotice, "raise to 0.2%"]);
  const oldSnapshot = await h.read(h.escrow, "sessionSnapshot", [firstSession]);
  assert.equal(oldSnapshot[3], 10n);

  h.increaseTime(feeNotice + 1n);
  const secondSession = await lockSession(h, "fee-snapshot-new", EXTRA_PLAYERS);
  const newSnapshot = await h.read(h.escrow, "sessionSnapshot", [secondSession]);
  assert.equal(newSnapshot[3], 20n);

  await h.write(h.escrow, "outsider", "applyAnnouncedFeeRate", []);
  assert.equal(await h.scalar(h.escrow, "feeRateBps"), 20n);

  await h.expectRevert(
    () => settleStandardSession(h, firstSession, {
      nonceLabel: "wrong-fee-rate-nonce",
      finalBalances: [100_000n, 100_000n, 100_000n],
      fees: [0n, 0n, 0n],
      feeRateBps: 20,
    }),
    "wrong Session fee snapshot",
  );
});
