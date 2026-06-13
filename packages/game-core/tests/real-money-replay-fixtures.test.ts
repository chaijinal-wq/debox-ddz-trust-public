import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerStake, TranscriptEvent } from "@debox-ddz/protocol";
import {
  appendTranscriptEvent,
  chooseTrusteeMove,
  deriveDdzRoundDeal,
  deriveFirstBidderSeat,
  deriveRoundSeed,
  deriveShuffleSeed,
  settleRoom,
  verifyTranscriptHashChain,
} from "../src/index.js";

const createdAt = "2026-05-29T00:00:00.000Z";
const roomId = "fixture-room";
const sessionId = "fixture-session";
const players: [PlayerStake, PlayerStake, PlayerStake] = [
  { id: "p0", name: "P0", address: "0x0000000000000000000000000000000000000000", cap: 10_00 },
  { id: "p1", name: "P1", address: "0x1111111111111111111111111111111111111111", cap: 50_00 },
  { id: "p2", name: "P2", address: "0x2222222222222222222222222222222222222222", cap: 100_00 },
];

async function append(transcript: TranscriptEvent[], type: string, actorId: string, payload: Record<string, unknown>) {
  return appendTranscriptEvent(transcript, {
    type,
    actorId,
    payload,
    createdAt,
  });
}

async function buildRoundPayload(roundId: string, serverNonce: string, playerReadyNonces: [string, string, string]) {
  const input = {
    roomId,
    sessionId,
    roundId,
    serverNonce,
    playerReadyNonces,
  };
  const { roundSeed, shuffleSeed, firstBidderSeat, deal } = deriveDdzRoundDeal(input);
  return {
    roomId,
    sessionId,
    roundId,
    serverNonce,
    playerReadyNonces,
    roundSeed,
    shuffleSeed,
    firstBidderSeat,
    bottomCards: deal.bottom.map((card) => card.id),
    handSizes: deal.players.map((hand) => hand.length),
    deal,
  };
}

test("public replay helpers use the same game-core deal derivation as real rounds", async () => {
  const input = {
    roomId,
    sessionId,
    roundId: "fixture-round-shared-deal",
    serverNonce: "server-nonce-shared",
    playerReadyNonces: ["r-p0", "r-p1", "r-p2"] as [string, string, string],
  };
  const derived = deriveDdzRoundDeal(input);

  assert.equal(derived.roundSeed, await deriveRoundSeed(input));
  assert.equal(derived.shuffleSeed, await deriveShuffleSeed(derived.roundSeed));
  assert.equal(derived.firstBidderSeat, await deriveFirstBidderSeat(derived.roundSeed));
  assert.deepEqual(
    [...derived.deal.players.flat(), ...derived.deal.bottom].map((card) => card.id).sort(),
    [...new Set([...derived.deal.players.flat(), ...derived.deal.bottom].map((card) => card.id))].sort(),
  );
});

test("verifies a real-money replay fixture covering redeal, bid 3, trustee, multipliers, and final deltas", async () => {
  const transcript: TranscriptEvent[] = [];
  await append(transcript, "session.started", "system", {
    roomId,
    sessionId,
    players: players.map(({ id, address, cap }) => ({ id, address, cap })),
    startingBalances: Object.fromEntries(players.map((player) => [player.id, player.cap])),
  });

  const allPassRound = await buildRoundPayload("fixture-round-1", "server-nonce-1", ["r1-p0", "r1-p1", "r1-p2"]);
  await append(transcript, "round.started", "system", {
    ...allPassRound,
    deal: undefined,
  });
  for (const player of ["p0", "p1", "p2"]) {
    await append(transcript, "round.bid", player, { roundId: "fixture-round-1", bidScore: null });
  }
  await append(transcript, "round.void", "system", {
    roundId: "fixture-round-1",
    reason: "all-pass",
  });

  const moneyRound = await buildRoundPayload("fixture-round-2", "server-nonce-2", ["r2-p0", "r2-p1", "r2-p2"]);
  await append(transcript, "round.started", "system", {
    ...moneyRound,
    deal: undefined,
  });
  await append(transcript, "round.bid", "p0", {
    roundId: "fixture-round-2",
    bidScore: 3,
  });
  await append(transcript, "round.landlord_selected", "system", {
    roundId: "fixture-round-2",
    landlordId: "p0",
    bidScore: 3,
    bottomCards: moneyRound.bottomCards,
  });

  const trusteeLead = chooseTrusteeMove({ hand: moneyRound.deal.players[1], mustLead: true });
  const trusteeFollow = chooseTrusteeMove({ hand: moneyRound.deal.players[2], mustLead: false });
  await append(transcript, "trustee.move", "p1", {
    mode: "must-lead",
    kind: trusteeLead.kind,
    cardIds: trusteeLead.cards.map((card) => card.id),
  });
  await append(transcript, "trustee.move", "p2", {
    mode: "follow",
    kind: trusteeFollow.kind,
    cardIds: trusteeFollow.cards.map((card) => card.id),
  });

  let multiplier = 1;
  for (const eventType of ["bomb", "bomb", "bomb", "bomb", "rocket", "spring"]) {
    multiplier = Math.min(multiplier * 2, 16);
    await append(transcript, "round.multiplier", "system", {
      roundId: "fixture-round-2",
      eventType,
      multiplier,
    });
  }

  const settlement = settleRoom({
    asset: "BOX",
    players,
    landlordId: "p0",
    winnerSide: "farmers",
    baseStake: 1_00,
    bidScore: 3,
    multiplier,
  });
  await append(transcript, "round.settled", "system", {
    roundId: "fixture-round-2",
    winnerSide: "farmers",
    multiplier,
    transfers: settlement.transfers,
    finalBalances: settlement.payouts,
  });

  const result = await verifyTranscriptHashChain(transcript);

  assert.equal(result.ok, true, result.error);
  assert.equal(result.finalHash, transcript.at(-1)?.eventHash);
  assert.equal(allPassRound.handSizes.join(","), "17,17,17");
  assert.equal(moneyRound.firstBidderSeat >= 0 && moneyRound.firstBidderSeat <= 2, true);
  assert.equal(trusteeLead.kind, "play");
  assert.equal(trusteeFollow.kind, "pass");
  assert.equal(multiplier, 16);
  assert.deepEqual(settlement.payouts, { p0: 0, p1: 55_00, p2: 105_00 });
});

test("detects transcript hash-chain tampering", async () => {
  const transcript: TranscriptEvent[] = [];
  await append(transcript, "session.started", "system", { roomId, sessionId });
  await append(transcript, "round.bid", "p0", { roundId: "fixture-round", bidScore: 3 });

  transcript[1] = {
    ...transcript[1],
    payload: { roundId: "fixture-round", bidScore: 2 },
  };

  const result = await verifyTranscriptHashChain(transcript);

  assert.equal(result.ok, false);
  assert.equal(result.failedIndex, 1);
});
