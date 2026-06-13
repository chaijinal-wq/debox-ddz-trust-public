import assert from "node:assert/strict";
import test from "node:test";
import { settleRoom } from "../src/index.js";
import type { PlayerStake } from "@debox-ddz/protocol";

const players: [PlayerStake, PlayerStake, PlayerStake] = [
  { id: "a", name: "A", address: "0xa", cap: 1000 },
  { id: "b", name: "B", address: "0xb", cap: 5000 },
  { id: "c", name: "C", address: "0xc", cap: 10000 },
];

function assertSettlementCaps(result: ReturnType<typeof settleRoom>, stakes: PlayerStake[]): void {
  const totalPayout = Object.values(result.payouts).reduce((sum, value) => sum + value, 0);
  assert.equal(totalPayout, result.totalLocked);

  for (const player of stakes) {
    const payout = result.payouts[player.id] ?? 0;
    assert.ok(payout >= 0, `${player.id} payout must not go negative`);
    assert.ok(player.cap - payout <= player.cap, `${player.id} net loss must not exceed locked amount`);
    assert.ok(payout - player.cap <= player.cap, `${player.id} net win must not exceed locked amount`);
  }
}

test("caps a landlord win by the landlord locked amount when the landlord wins", () => {
  const result = settleRoom({
    asset: "BOX",
    players,
    landlordId: "b",
    winnerSide: "landlord",
    baseStake: 1500,
    bidScore: 2,
    multiplier: 2,
  });

  assert.equal(result.unit, 6000);
  assert.deepEqual(result.transfers, [
    { from: "a", to: "b", amount: 714 },
    { from: "c", to: "b", amount: 4286 },
  ]);
  assert.deepEqual(result.payouts, { a: 286, b: 10000, c: 5714 });
  assertSettlementCaps(result, players);
});

test("splits an underfunded landlord loss across two farmers", () => {
  const result = settleRoom({
    asset: "BOX",
    players,
    landlordId: "a",
    winnerSide: "farmers",
    baseStake: 800,
    bidScore: 1,
    multiplier: 1,
  });

  assert.deepEqual(result.transfers, [
    { from: "a", to: "b", amount: 500 },
    { from: "a", to: "c", amount: 500 },
  ]);
  assert.deepEqual(result.payouts, { a: 0, b: 5500, c: 10500 });
  assertSettlementCaps(result, players);
});

test("splits a landlord capped win across both farmers", () => {
  const allInPlayers: [PlayerStake, PlayerStake, PlayerStake] = [
    { id: "landlord", name: "地主", address: "0x1", cap: 20_00 },
    { id: "farmer-a", name: "农民 A", address: "0x2", cap: 20_00 },
    { id: "farmer-b", name: "农民 B", address: "0x3", cap: 20_00 },
  ];
  const result = settleRoom({
    asset: "BOX",
    players: allInPlayers,
    landlordId: "landlord",
    winnerSide: "landlord",
    baseStake: 1_00,
    bidScore: 3,
    multiplier: 16,
  });

  assert.equal(result.unit, 48_00);
  assert.deepEqual(result.transfers, [
    { from: "farmer-a", to: "landlord", amount: 10_00 },
    { from: "farmer-b", to: "landlord", amount: 10_00 },
  ]);
  assert.deepEqual(result.payouts, { landlord: 40_00, "farmer-a": 10_00, "farmer-b": 10_00 });
  assertSettlementCaps(result, allInPlayers);
});

test("splits a landlord capped loss across both farmers", () => {
  const allInPlayers: [PlayerStake, PlayerStake, PlayerStake] = [
    { id: "landlord", name: "地主", address: "0x1", cap: 20_00 },
    { id: "farmer-a", name: "农民 A", address: "0x2", cap: 20_00 },
    { id: "farmer-b", name: "农民 B", address: "0x3", cap: 20_00 },
  ];
  const result = settleRoom({
    asset: "BOX",
    players: allInPlayers,
    landlordId: "landlord",
    winnerSide: "farmers",
    baseStake: 1_00,
    bidScore: 3,
    multiplier: 16,
  });

  assert.equal(result.unit, 48_00);
  assert.deepEqual(result.transfers, [
    { from: "landlord", to: "farmer-a", amount: 10_00 },
    { from: "landlord", to: "farmer-b", amount: 10_00 },
  ]);
  assert.deepEqual(result.payouts, { landlord: 0, "farmer-a": 30_00, "farmer-b": 30_00 });
  assertSettlementCaps(result, allInPlayers);
});

test("preserves the total locked amount", () => {
  const result = settleRoom({
    asset: "BOX",
    players,
    landlordId: "a",
    winnerSide: "farmers",
    baseStake: 3000,
    bidScore: 3,
    multiplier: 2,
  });

  const totalPayout = Object.values(result.payouts).reduce((sum, value) => sum + value, 0);
  assert.equal(totalPayout, result.totalLocked);
});

test("rejects invalid bid scores", () => {
  assert.throws(
    () =>
      settleRoom({
        asset: "BOX",
        players,
        landlordId: "a",
        winnerSide: "landlord",
        baseStake: 1000,
        bidScore: 4 as never,
        multiplier: 1,
      }),
    /bidScore/,
  );
});

test("rejects multipliers above the platform cap", () => {
  assert.throws(
    () =>
      settleRoom({
        asset: "BOX",
        players,
        landlordId: "a",
        winnerSide: "landlord",
        baseStake: 1000,
        bidScore: 1,
        multiplier: 17,
      }),
    /must not exceed 16/,
  );
});

test("rejects zero multipliers and fractional money inputs", () => {
  assert.throws(
    () =>
      settleRoom({
        asset: "BOX",
        players,
        landlordId: "a",
        winnerSide: "landlord",
        baseStake: 1000,
        bidScore: 1,
        multiplier: 0,
      }),
    /greater than zero/,
  );

  assert.throws(
    () =>
      settleRoom({
        asset: "BOX",
        players,
        landlordId: "a",
        winnerSide: "landlord",
        baseStake: 1000.5,
        bidScore: 1,
        multiplier: 1,
      }),
    /baseStake/,
  );
});

test("rejects invalid player caps and unknown landlords", () => {
  const invalidCapPlayers: [PlayerStake, PlayerStake, PlayerStake] = [
    { id: "a", name: "A", address: "0xa", cap: 1000 },
    { id: "b", name: "B", address: "0xb", cap: -1 },
    { id: "c", name: "C", address: "0xc", cap: 10000 },
  ];

  assert.throws(
    () =>
      settleRoom({
        asset: "BOX",
        players: invalidCapPlayers,
        landlordId: "a",
        winnerSide: "landlord",
        baseStake: 1000,
        bidScore: 1,
        multiplier: 1,
      }),
    /cap/,
  );

  assert.throws(
    () =>
      settleRoom({
        asset: "BOX",
        players,
        landlordId: "missing",
        winnerSide: "landlord",
        baseStake: 1000,
        bidScore: 1,
        multiplier: 1,
      }),
    /landlordId/,
  );
});
