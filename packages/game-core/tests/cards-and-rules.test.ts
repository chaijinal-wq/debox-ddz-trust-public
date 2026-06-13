import assert from "node:assert/strict";
import test from "node:test";
import { counterClockwiseBidSeatIndex, counterClockwiseSeatIndexForOffset } from "@debox-ddz/protocol";
import {
  bidSeatOrder,
  chooseTrusteeMove,
  classifyHand,
  compareHands,
  createDeck,
  createNonceCommitment,
  dealDdz,
  deriveDdzRoundDeal,
  deriveFirstBidderSeat,
  deriveRoundSeed,
  deriveShuffleSeed,
  sha256HexSync,
  shuffleDeck,
  shuffleDeckByHash,
  type Card,
} from "../src/index.js";

function card(rank: Card["rank"], value: number, id: string): Card {
  return { id, rank, value, label: id };
}

test("creates and deals a full Dou Dizhu deck", () => {
  const deck = createDeck();
  const shuffled = shuffleDeck(deck, "room-1|a|b|c");
  const deal = dealDdz(shuffled);

  assert.equal(deck.length, 54);
  assert.equal(deal.players[0].length, 17);
  assert.equal(deal.players[1].length, 17);
  assert.equal(deal.players[2].length, 17);
  assert.equal(deal.bottom.length, 3);
});

test("shuffle is deterministic for the same seed", () => {
  const deck = createDeck();
  assert.deepEqual(
    shuffleDeck(deck, "same").map((item) => item.id),
    shuffleDeck(deck, "same").map((item) => item.id),
  );
});

test("round seed derives stable shuffle seed and first bidder seat", async () => {
  const roundSeed = await deriveRoundSeed({
    roomId: "room-1",
    sessionId: "session-1",
    roundId: "round-1",
    serverNonce: "server-secret",
    playerReadyNonces: ["a-secret", "b-secret", "c-secret"],
  });
  const sameRoundSeed = await deriveRoundSeed({
    roomId: "room-1",
    sessionId: "session-1",
    roundId: "round-1",
    serverNonce: "server-secret",
    playerReadyNonces: ["a-secret", "b-secret", "c-secret"],
  });
  const differentRoundSeed = await deriveRoundSeed({
    roomId: "room-1",
    sessionId: "session-1",
    roundId: "round-2",
    serverNonce: "server-secret",
    playerReadyNonces: ["a-secret", "b-secret", "c-secret"],
  });

  assert.equal(roundSeed, sameRoundSeed);
  assert.notEqual(roundSeed, differentRoundSeed);

  const shuffleSeed = await deriveShuffleSeed(roundSeed);
  const firstBidderSeat = await deriveFirstBidderSeat(roundSeed);

  assert.match(shuffleSeed, /^[a-f0-9]{64}$/);
  assert.ok(firstBidderSeat === 0 || firstBidderSeat === 1 || firstBidderSeat === 2);
  assert.deepEqual([0, 1, 2].map((offset) => counterClockwiseSeatIndexForOffset(0, offset, 3)), [0, 2, 1]);
  assert.deepEqual([0, 1, 2].map((offset) => counterClockwiseBidSeatIndex(2, offset, 3)), [2, 1, 0]);
  assert.deepEqual(bidSeatOrder(2), [2, 1, 0]);

  const serverCommitment = await createNonceCommitment("server-secret");
  assert.match(serverCommitment, /^[a-f0-9]{64}$/);
  assert.equal(serverCommitment, await createNonceCommitment("server-secret"));
});

test("shared DDZ round deal derivation is deterministic and replayable", async () => {
  const input = {
    roomId: "room-1",
    sessionId: "session-1",
    roundId: "round-1",
    serverNonce: "server-secret",
    playerReadyNonces: ["a-secret", "b-secret", "c-secret"] as [string, string, string],
  };
  const first = deriveDdzRoundDeal(input);
  const second = deriveDdzRoundDeal(input);

  assert.deepEqual(
    first.deal.players.map((hand) => hand.map((card) => card.id)),
    second.deal.players.map((hand) => hand.map((card) => card.id)),
  );
  assert.deepEqual(first.deal.bottom.map((card) => card.id), second.deal.bottom.map((card) => card.id));
  assert.equal(first.roundSeed, await deriveRoundSeed(input));
  assert.equal(first.shuffleSeed, await deriveShuffleSeed(first.roundSeed));
  assert.equal(first.firstBidderSeat, await deriveFirstBidderSeat(first.roundSeed));
  assert.equal(sha256HexSync("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("hash-based shuffle is deterministic and preserves the deck", async () => {
  const deck = createDeck();
  const firstShuffle = await shuffleDeckByHash(deck, "shuffle-seed");
  const secondShuffle = await shuffleDeckByHash(deck, "shuffle-seed");

  assert.deepEqual(
    firstShuffle.map((item) => item.id),
    secondShuffle.map((item) => item.id),
  );
  assert.deepEqual(
    firstShuffle.map((item) => item.id).sort(),
    deck.map((item) => item.id).sort(),
  );
  assert.notDeepEqual(
    firstShuffle.map((item) => item.id),
    deck.map((item) => item.id),
  );
});

test("classifies common Dou Dizhu hands", () => {
  assert.equal(classifyHand([card("SJ", 16, "sj"), card("BJ", 17, "bj")])?.kind, "rocket");
  assert.equal(
    classifyHand([card("A", 14, "a1"), card("A", 14, "a2"), card("A", 14, "a3"), card("A", 14, "a4")])
      ?.kind,
    "bomb",
  );
  assert.equal(
    classifyHand([
      card("3", 3, "3"),
      card("4", 4, "4"),
      card("5", 5, "5"),
      card("6", 6, "6"),
      card("7", 7, "7"),
    ])?.kind,
    "straight",
  );
});

test("bombs beat ordinary hands and rockets beat bombs", () => {
  const bomb = [card("K", 13, "k1"), card("K", 13, "k2"), card("K", 13, "k3"), card("K", 13, "k4")];
  const tripleWithSingle = [card("Q", 12, "q1"), card("Q", 12, "q2"), card("Q", 12, "q3"), card("3", 3, "3")];
  const rocket = [card("SJ", 16, "sj"), card("BJ", 17, "bj")];

  assert.equal(compareHands(bomb, tripleWithSingle), 1);
  assert.equal(compareHands(rocket, bomb), 1);
});

test("trustee leading move prefers the smallest true single without splitting pairs", () => {
  const hand = [
    card("9", 9, "9a"),
    card("9", 9, "9b"),
    card("J", 11, "ja"),
    card("J", 11, "jb"),
    card("Q", 12, "q"),
  ];

  assert.deepEqual(chooseTrusteeMove({ hand, mustLead: true }), {
    kind: "play",
    cards: [card("Q", 12, "q")],
  });
});

test("trustee leading move falls back to the smallest card when every value is grouped", () => {
  const hand = [
    card("9", 9, "9a"),
    card("9", 9, "9b"),
    card("J", 11, "ja"),
    card("J", 11, "jb"),
  ];

  assert.deepEqual(chooseTrusteeMove({ hand, mustLead: true }), {
    kind: "play",
    cards: [card("9", 9, "9a")],
  });
});
