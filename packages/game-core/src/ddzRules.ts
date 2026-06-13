import type { Card } from "./cards.js";

export type HandKind =
  | "single"
  | "pair"
  | "triple"
  | "triple_with_single"
  | "triple_with_pair"
  | "straight"
  | "consecutive_pairs"
  | "airplane"
  | "airplane_with_singles"
  | "airplane_with_pairs"
  | "four_with_two"
  | "four_with_two_pairs"
  | "bomb"
  | "rocket";

export interface HandRank {
  kind: HandKind;
  mainValue: number;
  length: number;
}

function valueCounts(cards: Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) {
    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  }
  return counts;
}

function isConsecutive(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function noHighCards(values: number[]): boolean {
  return values.every((value) => value < 15);
}

function valuesWithCount(entries: Array<[number, number]>, count: number): number[] {
  return entries.filter(([, itemCount]) => itemCount === count).map(([value]) => value);
}

function hasConsecutiveValues(values: number[], expectedLength: number): boolean {
  return values.length === expectedLength && noHighCards(values) && isConsecutive(values);
}

function classifyAirplane(entries: Array<[number, number]>, length: number): HandRank | null {
  const tripleValues = valuesWithCount(entries, 3);

  if (length >= 6 && length % 3 === 0) {
    const planeLength = length / 3;
    if (hasConsecutiveValues(tripleValues, planeLength) && entries.every(([, count]) => count === 3)) {
      return { kind: "airplane", mainValue: tripleValues.at(-1) ?? 0, length };
    }
  }

  if (length >= 8 && length % 4 === 0) {
    const planeLength = length / 4;
    if (hasConsecutiveValues(tripleValues, planeLength)) {
      const wingCount = entries.reduce((sum, [value, count]) => sum + (tripleValues.includes(value) ? 0 : count), 0);
      if (wingCount === planeLength) {
        return { kind: "airplane_with_singles", mainValue: tripleValues.at(-1) ?? 0, length };
      }
    }
  }

  if (length >= 10 && length % 5 === 0) {
    const planeLength = length / 5;
    if (hasConsecutiveValues(tripleValues, planeLength)) {
      const pairWingValues = entries
        .filter(([value, count]) => !tripleValues.includes(value) && count === 2)
        .map(([value]) => value);
      const hasOnlyPairWings = entries.every(([value, count]) => tripleValues.includes(value) || count === 2);
      if (hasOnlyPairWings && pairWingValues.length === planeLength) {
        return { kind: "airplane_with_pairs", mainValue: tripleValues.at(-1) ?? 0, length };
      }
    }
  }

  return null;
}

export function classifyHand(cards: Card[]): HandRank | null {
  const length = cards.length;
  if (length === 0) return null;

  const counts = valueCounts(cards);
  const entries = [...counts.entries()].sort(([a], [b]) => a - b);
  const values = entries.map(([value]) => value);
  const countValues = entries.map(([, count]) => count);

  if (length === 2 && values.includes(16) && values.includes(17)) {
    return { kind: "rocket", mainValue: 17, length };
  }

  if (length === 4 && countValues[0] === 4) {
    return { kind: "bomb", mainValue: values[0], length };
  }

  if (length === 1) {
    return { kind: "single", mainValue: values[0], length };
  }

  if (length === 2 && countValues[0] === 2) {
    return { kind: "pair", mainValue: values[0], length };
  }

  if (length === 3 && countValues[0] === 3) {
    return { kind: "triple", mainValue: values[0], length };
  }

  if (length === 4 && countValues.includes(3)) {
    const mainValue = entries.find(([, count]) => count === 3)?.[0];
    return mainValue ? { kind: "triple_with_single", mainValue, length } : null;
  }

  if (length === 5 && countValues.includes(3) && countValues.includes(2)) {
    const mainValue = entries.find(([, count]) => count === 3)?.[0];
    return mainValue ? { kind: "triple_with_pair", mainValue, length } : null;
  }

  if (length >= 5 && countValues.every((count) => count === 1) && noHighCards(values) && isConsecutive(values)) {
    return { kind: "straight", mainValue: values.at(-1) ?? 0, length };
  }

  if (
    length >= 6 &&
    length % 2 === 0 &&
    countValues.every((count) => count === 2) &&
    noHighCards(values) &&
    isConsecutive(values)
  ) {
    return { kind: "consecutive_pairs", mainValue: values.at(-1) ?? 0, length };
  }

  const airplane = classifyAirplane(entries, length);
  if (airplane) {
    return airplane;
  }

  if (length === 6 && countValues.includes(4)) {
    const mainValue = entries.find(([, count]) => count === 4)?.[0];
    return mainValue ? { kind: "four_with_two", mainValue, length } : null;
  }

  if (length === 8) {
    const bombLikeValues = valuesWithCount(entries, 4);
    const pairValues = valuesWithCount(entries, 2);
    if (bombLikeValues.length === 1 && pairValues.length === 2) {
      return { kind: "four_with_two_pairs", mainValue: bombLikeValues[0], length };
    }
  }

  return null;
}

export function compareHands(challenger: Card[], table: Card[]): number {
  const challengerRank = classifyHand(challenger);
  const tableRank = classifyHand(table);

  if (!challengerRank || !tableRank) {
    throw new Error("Both hands must be valid Dou Dizhu hands.");
  }

  if (challengerRank.kind === "rocket") return tableRank.kind === "rocket" ? 0 : 1;
  if (tableRank.kind === "rocket") return -1;

  if (challengerRank.kind === "bomb" && tableRank.kind !== "bomb") return 1;
  if (challengerRank.kind !== "bomb" && tableRank.kind === "bomb") return -1;

  if (challengerRank.kind !== tableRank.kind || challengerRank.length !== tableRank.length) {
    return -1;
  }

  return Math.sign(challengerRank.mainValue - tableRank.mainValue);
}
