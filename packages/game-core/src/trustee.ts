import { sortCardsAsc, type Card } from "./cards.js";

export type TrusteeMove =
  | {
      kind: "play";
      cards: [Card];
    }
  | {
      kind: "pass";
      cards: [];
    };

export interface TrusteeMoveInput {
  hand: Card[];
  mustLead: boolean;
}

export function chooseTrusteeMove(input: TrusteeMoveInput): TrusteeMove {
  if (!input.mustLead) {
    return { kind: "pass", cards: [] };
  }

  const sortedHand = sortCardsAsc(input.hand);
  const valueCounts = new Map<number, number>();
  for (const card of sortedHand) {
    valueCounts.set(card.value, (valueCounts.get(card.value) ?? 0) + 1);
  }
  const smallest = sortedHand.find((card) => valueCounts.get(card.value) === 1) ?? sortedHand[0];
  if (!smallest) {
    throw new Error("Trustee cannot lead with an empty hand.");
  }

  return { kind: "play", cards: [smallest] };
}
