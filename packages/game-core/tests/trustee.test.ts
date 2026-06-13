import assert from "node:assert/strict";
import test from "node:test";
import { chooseTrusteeMove, type Card } from "../src/index.js";

function card(rank: Card["rank"], value: number, id: string): Card {
  return { id, rank, value, label: id };
}

test("trustee leads with the smallest single card", () => {
  const move = chooseTrusteeMove({
    mustLead: true,
    hand: [card("A", 14, "a"), card("3", 3, "3"), card("7", 7, "7")],
  });

  assert.equal(move.kind, "play");
  assert.deepEqual(
    move.cards.map((item) => item.id),
    ["3"],
  );
});

test("trustee always passes when following", () => {
  const move = chooseTrusteeMove({
    mustLead: false,
    hand: [card("BJ", 17, "bj"), card("A", 14, "a"), card("3", 3, "3")],
  });

  assert.deepEqual(move, { kind: "pass", cards: [] });
});

test("trustee cannot lead with an empty hand", () => {
  assert.throws(() => chooseTrusteeMove({ mustLead: true, hand: [] }), /empty hand/);
});
