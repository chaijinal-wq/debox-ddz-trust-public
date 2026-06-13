import assert from "node:assert/strict";
import test from "node:test";
import { classifyHand, compareHands, type Card } from "../src/index.js";

function c(rank: Card["rank"], value: number, index: number): Card {
  return { id: `${rank}-${index}`, rank, value, label: `${rank}${index}` };
}

function cards(values: Array<[Card["rank"], number, number]>): Card[] {
  return values.flatMap(([rank, value, count]) => Array.from({ length: count }, (_, index) => c(rank, value, index)));
}

const classificationFixtures: Array<{
  name: string;
  hand: Card[];
  kind: NonNullable<ReturnType<typeof classifyHand>>["kind"];
  mainValue: number;
}> = [
  { name: "single", hand: cards([["3", 3, 1]]), kind: "single", mainValue: 3 },
  { name: "pair", hand: cards([["7", 7, 2]]), kind: "pair", mainValue: 7 },
  { name: "triple", hand: cards([["Q", 12, 3]]), kind: "triple", mainValue: 12 },
  { name: "triple with single", hand: cards([["9", 9, 3], ["3", 3, 1]]), kind: "triple_with_single", mainValue: 9 },
  { name: "triple with pair", hand: cards([["8", 8, 3], ["4", 4, 2]]), kind: "triple_with_pair", mainValue: 8 },
  {
    name: "straight",
    hand: cards([["3", 3, 1], ["4", 4, 1], ["5", 5, 1], ["6", 6, 1], ["7", 7, 1]]),
    kind: "straight",
    mainValue: 7,
  },
  {
    name: "consecutive pairs",
    hand: cards([["5", 5, 2], ["6", 6, 2], ["7", 7, 2]]),
    kind: "consecutive_pairs",
    mainValue: 7,
  },
  {
    name: "airplane",
    hand: cards([["4", 4, 3], ["5", 5, 3]]),
    kind: "airplane",
    mainValue: 5,
  },
  {
    name: "airplane with singles",
    hand: cards([["6", 6, 3], ["7", 7, 3], ["3", 3, 1], ["K", 13, 1]]),
    kind: "airplane_with_singles",
    mainValue: 7,
  },
  {
    name: "airplane with pairs",
    hand: cards([["8", 8, 3], ["9", 9, 3], ["4", 4, 2], ["J", 11, 2]]),
    kind: "airplane_with_pairs",
    mainValue: 9,
  },
  {
    name: "four with two",
    hand: cards([["10", 10, 4], ["3", 3, 1], ["A", 14, 1]]),
    kind: "four_with_two",
    mainValue: 10,
  },
  {
    name: "four with two pairs",
    hand: cards([["J", 11, 4], ["5", 5, 2], ["6", 6, 2]]),
    kind: "four_with_two_pairs",
    mainValue: 11,
  },
  { name: "bomb", hand: cards([["A", 14, 4]]), kind: "bomb", mainValue: 14 },
  { name: "rocket", hand: cards([["SJ", 16, 1], ["BJ", 17, 1]]), kind: "rocket", mainValue: 17 },
];

for (const fixture of classificationFixtures) {
  test(`classifies ${fixture.name}`, () => {
    const result = classifyHand(fixture.hand);
    assert.equal(result?.kind, fixture.kind);
    assert.equal(result?.mainValue, fixture.mainValue);
  });
}

test("rejects sequences containing 2 or jokers", () => {
  assert.equal(
    classifyHand(cards([["10", 10, 1], ["J", 11, 1], ["Q", 12, 1], ["K", 13, 1], ["A", 14, 1], ["2", 15, 1]])),
    null,
  );
  assert.equal(
    classifyHand(cards([["Q", 12, 2], ["K", 13, 2], ["A", 14, 2], ["2", 15, 2]])),
    null,
  );
  assert.equal(classifyHand(cards([["A", 14, 3], ["2", 15, 3]])), null);
});

const invalidClassificationFixtures: Array<{ name: string; hand: Card[] }> = [
  { name: "straight with fewer than five cards", hand: cards([["3", 3, 1], ["4", 4, 1], ["5", 5, 1], ["6", 6, 1]]) },
  { name: "consecutive pairs with fewer than three pairs", hand: cards([["3", 3, 2], ["4", 4, 2]]) },
  { name: "straight containing a joker", hand: cards([["10", 10, 1], ["J", 11, 1], ["Q", 12, 1], ["K", 13, 1], ["BJ", 17, 1]]) },
  { name: "consecutive pairs containing 2", hand: cards([["K", 13, 2], ["A", 14, 2], ["2", 15, 2]]) },
  { name: "non-consecutive airplane", hand: cards([["4", 4, 3], ["6", 6, 3]]) },
  { name: "four with two pairs missing one pair", hand: cards([["4", 4, 4], ["5", 5, 2], ["6", 6, 1], ["7", 7, 1]]) },
  { name: "rocket with extra card", hand: cards([["SJ", 16, 1], ["BJ", 17, 1], ["3", 3, 1]]) },
];

for (const fixture of invalidClassificationFixtures) {
  test(`rejects ${fixture.name}`, () => {
    assert.equal(classifyHand(fixture.hand), null);
  });
}

test("compares same-type hands by main value and length", () => {
  assert.equal(compareHands(cards([["4", 4, 1], ["5", 5, 1], ["6", 6, 1], ["7", 7, 1], ["8", 8, 1]]), cards([["3", 3, 1], ["4", 4, 1], ["5", 5, 1], ["6", 6, 1], ["7", 7, 1]])), 1);
  assert.equal(compareHands(cards([["7", 7, 3], ["8", 8, 3], ["3", 3, 1], ["4", 4, 1]]), cards([["5", 5, 3], ["6", 6, 3], ["Q", 12, 1], ["K", 13, 1]])), 1);
  assert.equal(compareHands(cards([["7", 7, 3], ["8", 8, 3]]), cards([["5", 5, 3], ["6", 6, 3], ["Q", 12, 1], ["K", 13, 1]])), -1);
});

test("compares bombs, rockets, and incompatible hands", () => {
  assert.equal(compareHands(cards([["A", 14, 4]]), cards([["K", 13, 4]])), 1);
  assert.equal(compareHands(cards([["SJ", 16, 1], ["BJ", 17, 1]]), cards([["A", 14, 4]])), 1);
  assert.equal(compareHands(cards([["6", 6, 4]]), cards([["3", 3, 3], ["4", 4, 3], ["8", 8, 2], ["9", 9, 2]])), 1);
  assert.equal(compareHands(cards([["3", 3, 3], ["4", 4, 3], ["8", 8, 2], ["9", 9, 2]]), cards([["6", 6, 4]])), -1);
  assert.equal(compareHands(cards([["Q", 12, 4], ["5", 5, 2], ["6", 6, 2]]), cards([["J", 11, 4], ["A", 14, 2], ["K", 13, 2]])), 1);
  assert.equal(compareHands(cards([["4", 4, 1], ["5", 5, 1], ["6", 6, 1], ["7", 7, 1], ["8", 8, 1], ["9", 9, 1]]), cards([["3", 3, 1], ["4", 4, 1], ["5", 5, 1], ["6", 6, 1], ["7", 7, 1]])), -1);
});
