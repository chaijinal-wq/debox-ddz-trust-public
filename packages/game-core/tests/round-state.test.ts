import assert from "node:assert/strict";
import test from "node:test";
import { V1_ASSET, type PlayerStake, type RoundCardSnapshot } from "@debox-ddz/protocol";
import {
  applyPlayableRoundPass,
  applyPlayableRoundPlay,
  createDeck,
  dealDdz,
  initializePlayableRound,
  shuffleDeck,
  sortCardsAsc,
  type Card,
} from "../src/index.js";

const deck = createDeck();

function c(id: string): Card {
  const card = deck.find((item) => item.id === id);
  if (!card) throw new Error(`Missing card ${id}`);
  return card;
}

function players(caps: [number, number, number] = [1000, 1000, 1000]): [PlayerStake, PlayerStake, PlayerStake] {
  return [
    { id: "p0", name: "地主", address: "0x0", cap: caps[0] },
    { id: "p1", name: "农民甲", address: "0x1", cap: caps[1] },
    { id: "p2", name: "农民乙", address: "0x2", cap: caps[2] },
  ];
}

function init(
  hands: Record<string, Card[]>,
  options: { caps?: [number, number, number]; baseStake?: number } = {},
) {
  return initializePlayableRound({
    asset: V1_ASSET,
    players: players(options.caps),
    landlordId: "p0",
    bidScore: 1,
    baseStake: options.baseStake ?? 100,
    hands,
    bottomCards: [],
  });
}

function snapshotToCard(card: RoundCardSnapshot): Card {
  return {
    id: card.id,
    rank: card.rank as Card["rank"],
    suit: card.suit as Card["suit"],
    label: card.label,
    value: card.value,
  };
}

function chooseSingleCardMove(state: ReturnType<typeof initializePlayableRound>): string[] | undefined {
  const hand = (state.hands[state.currentTurnPlayerId] ?? []).map(snapshotToCard);
  if (hand.length === 0) throw new Error("Current player has no cards left.");

  if (!state.activeMove) {
    return [sortCardsAsc(hand)[0].id];
  }

  if (state.activeMove.handKind !== "single") {
    return undefined;
  }

  const activeCard = state.activeMove.cards[0];
  const candidate = sortCardsAsc(hand).find((card) => card.value > activeCard.value);
  return candidate ? [candidate.id] : undefined;
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

test("playable round accepts a legal leading play", () => {
  const state = init({
    p0: [c("spades-3"), c("spades-4")],
    p1: [c("spades-5")],
    p2: [c("spades-6")],
  });

  const next = applyPlayableRoundPlay(state, {
    playerId: "p0",
    turnId: "turn-1",
    cardIds: ["spades-3"],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(next.handCounts.p0, 1);
  assert.equal(next.currentTurnPlayerId, "p2");
  assert.equal(next.activeMove?.playerId, "p0");
  assert.equal(next.activeMove?.handKind, "single");
});

test("playable round accepts a legal response that beats the active move", () => {
  const state = init({
    p0: [c("spades-3"), c("spades-7")],
    p1: [c("spades-5")],
    p2: [c("spades-6")],
  });
  const led = applyPlayableRoundPlay(state, { playerId: "p0", turnId: "turn-1", cardIds: ["spades-3"] });

  const next = applyPlayableRoundPlay(led, { playerId: "p2", turnId: led.turnId, cardIds: ["spades-6"] });

  assert.equal(next.activeMove?.playerId, "p2");
  assert.equal(next.handCounts.p2, 0);
  assert.equal(next.result?.winnerSide, "farmers");
});

test("playable round rejects an illegal response", () => {
  const state = init({
    p0: [c("spades-5"), c("spades-7")],
    p1: [c("spades-6")],
    p2: [c("spades-4")],
  });
  const led = applyPlayableRoundPlay(state, { playerId: "p0", turnId: "turn-1", cardIds: ["spades-5"] });

  assert.throws(
    () => applyPlayableRoundPlay(led, { playerId: "p2", turnId: led.turnId, cardIds: ["spades-4"] }),
    /do not beat/,
  );
});

test("playable round rejects pass while leading", () => {
  const state = init({
    p0: [c("spades-3")],
    p1: [c("spades-5")],
    p2: [c("spades-6")],
  });

  assert.throws(() => applyPlayableRoundPass(state, { playerId: "p0", turnId: "turn-1" }), /leading/);
});

test("two consecutive passes clear the active move and return lead", () => {
  const state = init({
    p0: [c("spades-3"), c("spades-7")],
    p1: [c("spades-5")],
    p2: [c("spades-6")],
  });
  const led = applyPlayableRoundPlay(state, { playerId: "p0", turnId: "turn-1", cardIds: ["spades-3"] });
  const p2PassedFirst = applyPlayableRoundPass(led, { playerId: "p2", turnId: led.turnId });
  const p1Passed = applyPlayableRoundPass(p2PassedFirst, { playerId: "p1", turnId: p2PassedFirst.turnId });

  assert.equal(p1Passed.activeMove, undefined);
  assert.equal(p1Passed.passStreak, 0);
  assert.equal(p1Passed.currentTurnPlayerId, "p0");
});

test("bomb play doubles the multiplier up to the cap", () => {
  const state = init({
    p0: [c("spades-3"), c("hearts-3"), c("clubs-3"), c("diamonds-3"), c("spades-4")],
    p1: [c("spades-5")],
    p2: [c("spades-6")],
  });

  const next = applyPlayableRoundPlay(state, {
    playerId: "p0",
    turnId: "turn-1",
    cardIds: ["spades-3", "hearts-3", "clubs-3", "diamonds-3"],
  });

  assert.equal(next.activeMove?.handKind, "bomb");
  assert.equal(next.moves.at(-1)?.multiplierAfter, 2);
});

test("rocket play doubles the multiplier", () => {
  const state = init({
    p0: [c("joker-small"), c("joker-big"), c("spades-3")],
    p1: [c("spades-5")],
    p2: [c("spades-6")],
  });

  const next = applyPlayableRoundPlay(state, {
    playerId: "p0",
    turnId: "turn-1",
    cardIds: ["joker-small", "joker-big"],
  });

  assert.equal(next.activeMove?.handKind, "rocket");
  assert.equal(next.moves.at(-1)?.multiplierAfter, 2);
});

test("bomb followed by rocket stacks the multiplier", () => {
  const state = init({
    p0: [c("spades-3"), c("hearts-3"), c("clubs-3"), c("diamonds-3"), c("spades-7")],
    p1: [c("spades-9")],
    p2: [c("joker-small"), c("joker-big"), c("spades-8")],
  });
  const bomb = applyPlayableRoundPlay(state, {
    playerId: "p0",
    turnId: "turn-1",
    cardIds: ["spades-3", "hearts-3", "clubs-3", "diamonds-3"],
  });

  const rocket = applyPlayableRoundPlay(bomb, {
    playerId: "p2",
    turnId: bomb.turnId,
    cardIds: ["joker-small", "joker-big"],
  });

  assert.equal(bomb.moves.at(-1)?.multiplierAfter, 2);
  assert.equal(rocket.activeMove?.handKind, "rocket");
  assert.equal(rocket.moves.at(-1)?.multiplierAfter, 4);
});

test("bomb and rocket chains keep the multiplier capped at sixteen", () => {
  let state = init({
    p0: [
      c("spades-3"),
      c("hearts-3"),
      c("clubs-3"),
      c("diamonds-3"),
      c("spades-8"),
      c("hearts-8"),
      c("clubs-8"),
      c("diamonds-8"),
      c("spades-J"),
    ],
    p1: [
      c("spades-5"),
      c("hearts-5"),
      c("clubs-5"),
      c("diamonds-5"),
      c("hearts-Q"),
    ],
    p2: [c("spades-4"), c("hearts-4"), c("clubs-4"), c("diamonds-4"), c("joker-small"), c("joker-big"), c("spades-10")],
  });

  state = applyPlayableRoundPlay(state, {
    playerId: "p0",
    turnId: state.turnId,
    cardIds: ["spades-3", "hearts-3", "clubs-3", "diamonds-3"],
  });
  assert.equal(state.moves.at(-1)?.multiplierAfter, 2);
  state = applyPlayableRoundPlay(state, {
    playerId: "p2",
    turnId: state.turnId,
    cardIds: ["spades-4", "hearts-4", "clubs-4", "diamonds-4"],
  });
  assert.equal(state.moves.at(-1)?.multiplierAfter, 4);
  state = applyPlayableRoundPlay(state, {
    playerId: "p1",
    turnId: state.turnId,
    cardIds: ["spades-5", "hearts-5", "clubs-5", "diamonds-5"],
  });
  assert.equal(state.moves.at(-1)?.multiplierAfter, 8);
  state = applyPlayableRoundPlay(state, {
    playerId: "p0",
    turnId: state.turnId,
    cardIds: ["spades-8", "hearts-8", "clubs-8", "diamonds-8"],
  });
  assert.equal(state.moves.at(-1)?.multiplierAfter, 16);
  state = applyPlayableRoundPlay(state, {
    playerId: "p2",
    turnId: state.turnId,
    cardIds: ["joker-small", "joker-big"],
  });
  assert.equal(state.moves.at(-1)?.multiplierAfter, 16);
});

test("bomb multiplier contributes to the completed round result", () => {
  let state = init(
    {
      p0: [c("spades-3"), c("hearts-3"), c("clubs-3"), c("diamonds-3"), c("spades-4")],
      p1: [c("spades-5")],
      p2: [c("spades-6")],
    },
    { caps: [5000, 5000, 5000] },
  );

  state = applyPlayableRoundPlay(state, {
    playerId: "p0",
    turnId: "turn-1",
    cardIds: ["spades-3", "hearts-3", "clubs-3", "diamonds-3"],
  });
  state = applyPlayableRoundPass(state, { playerId: "p2", turnId: state.turnId });
  state = applyPlayableRoundPass(state, { playerId: "p1", turnId: state.turnId });
  state = applyPlayableRoundPlay(state, { playerId: "p0", turnId: state.turnId, cardIds: ["spades-4"] });

  assert.equal(state.result?.winnerSide, "landlord");
  assert.equal(state.result?.multiplier, 4);
  assert.deepEqual(state.result?.finalBalances, { p0: 5800, p1: 4600, p2: 4600 });
  assert.deepEqual(state.result?.balanceDeltas, { p0: 800, p1: -400, p2: -400 });
});

test("landlord completion applies spring multiplier and capped balance deltas", () => {
  const state = init({
    p0: [c("spades-3")],
    p1: [c("spades-5")],
    p2: [c("spades-6")],
  });

  const complete = applyPlayableRoundPlay(state, { playerId: "p0", turnId: "turn-1", cardIds: ["spades-3"] });

  assert.equal(complete.result?.winnerSide, "landlord");
  assert.equal(complete.result?.multiplier, 2);
  assert.deepEqual(complete.result?.finalBalances, { p0: 1400, p1: 800, p2: 800 });
  assert.deepEqual(complete.result?.balanceDeltas, { p0: 400, p1: -200, p2: -200 });
});

test("landlord win does not apply spring after a farmer plays", () => {
  let state = init({
    p0: [c("spades-3"), c("spades-7")],
    p1: [c("spades-6")],
    p2: [c("spades-4"), c("hearts-4")],
  });

  state = applyPlayableRoundPlay(state, { playerId: "p0", turnId: "turn-1", cardIds: ["spades-3"] });
  state = applyPlayableRoundPlay(state, { playerId: "p2", turnId: state.turnId, cardIds: ["spades-4"] });
  state = applyPlayableRoundPass(state, { playerId: "p1", turnId: state.turnId });
  state = applyPlayableRoundPlay(state, { playerId: "p0", turnId: state.turnId, cardIds: ["spades-7"] });

  assert.equal(state.result?.winnerSide, "landlord");
  assert.equal(state.result?.multiplier, 1);
  assert.deepEqual(state.result?.balanceDeltas, { p0: 200, p1: -100, p2: -100 });
});

test("farmer completion applies anti-spring multiplier and balance deltas", () => {
  const state = init({
    p0: [c("spades-3"), c("spades-7")],
    p1: [c("spades-6")],
    p2: [c("spades-4")],
  });
  const led = applyPlayableRoundPlay(state, { playerId: "p0", turnId: "turn-1", cardIds: ["spades-3"] });

  const complete = applyPlayableRoundPlay(led, { playerId: "p2", turnId: led.turnId, cardIds: ["spades-4"] });

  assert.equal(complete.result?.winnerSide, "farmers");
  assert.equal(complete.result?.multiplier, 2);
  assert.deepEqual(complete.result?.finalBalances, { p0: 600, p1: 1200, p2: 1200 });
  assert.deepEqual(complete.result?.balanceDeltas, { p0: -400, p1: 200, p2: 200 });
});

test("farmer win does not apply anti-spring after the landlord plays a second hand", () => {
  let state = init({
    p0: [c("spades-3"), c("spades-4"), c("spades-7")],
    p1: [c("spades-6")],
    p2: [c("spades-5")],
  });

  state = applyPlayableRoundPlay(state, { playerId: "p0", turnId: "turn-1", cardIds: ["spades-3"] });
  state = applyPlayableRoundPass(state, { playerId: "p2", turnId: state.turnId });
  state = applyPlayableRoundPass(state, { playerId: "p1", turnId: state.turnId });
  state = applyPlayableRoundPlay(state, { playerId: "p0", turnId: state.turnId, cardIds: ["spades-4"] });
  state = applyPlayableRoundPlay(state, { playerId: "p2", turnId: state.turnId, cardIds: ["spades-5"] });

  assert.equal(state.result?.winnerSide, "farmers");
  assert.equal(state.result?.multiplier, 1);
  assert.deepEqual(state.result?.balanceDeltas, { p0: -200, p1: 100, p2: 100 });
});

test("playable round state finishes dozens of deterministic games with balance conservation", () => {
  const playerIds = ["p0", "p1", "p2"] as const;
  const caps: [number, number, number] = [50_000, 50_000, 50_000];
  const roundCount = 72;
  let landlordWins = 0;
  let farmerWins = 0;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const shuffled = shuffleDeck(createDeck(), `round-state-stress-${roundIndex}`);
    const deal = dealDdz(shuffled);
    const landlordId = playerIds[roundIndex % playerIds.length];
    const bidScore = ([1, 2, 3] as const)[roundIndex % 3];
    const baseStake = ([100, 1_000, 10_000] as const)[roundIndex % 3];
    const statePlayers = players(caps);
    let state = initializePlayableRound({
      asset: V1_ASSET,
      players: statePlayers,
      landlordId,
      bidScore,
      baseStake,
      hands: {
        p0: deal.players[0],
        p1: deal.players[1],
        p2: deal.players[2],
      },
      bottomCards: deal.bottom,
    });

    for (let actionCount = 0; actionCount < 300 && !state.result; actionCount += 1) {
      const cardIds = chooseSingleCardMove(state);
      state = cardIds
        ? applyPlayableRoundPlay(state, { playerId: state.currentTurnPlayerId, turnId: state.turnId, cardIds })
        : applyPlayableRoundPass(state, { playerId: state.currentTurnPlayerId, turnId: state.turnId });
    }

    assert.ok(state.result, `stress round ${roundIndex} should complete`);
    assert.equal(state.handCounts[state.result.winnerPlayerId], 0);
    assert.equal(sum(state.result.balanceDeltas), 0);
    assert.equal(sum(state.result.finalBalances), sum(Object.fromEntries(statePlayers.map((player) => [player.id, player.cap]))));
    assert.ok(Object.values(state.result.finalBalances).every((balance) => balance >= 0));

    if (state.result.winnerSide === "landlord") {
      landlordWins += 1;
      assert.equal(state.result.winnerPlayerId, state.result.landlordId);
    } else {
      farmerWins += 1;
      assert.notEqual(state.result.winnerPlayerId, state.result.landlordId);
    }
  }

  assert.equal(landlordWins + farmerWins, roundCount);
  assert.ok(landlordWins > 0, "stress should include landlord wins");
  assert.ok(farmerWins > 0, "stress should include farmer wins");
});
