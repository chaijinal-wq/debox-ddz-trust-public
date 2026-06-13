export type Suit = "spades" | "hearts" | "clubs" | "diamonds";

export type Rank =
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "2"
  | "SJ"
  | "BJ";

export interface Card {
  id: string;
  rank: Rank;
  suit?: Suit;
  label: string;
  value: number;
}

const STANDARD_RANKS: Rank[] = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
];

const SUITS: Suit[] = ["spades", "hearts", "clubs", "diamonds"];

const RANK_VALUES: Record<Rank, number> = {
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  "2": 15,
  SJ: 16,
  BJ: 17,
};

const SUIT_LABELS: Record<Suit, string> = {
  spades: "S",
  hearts: "H",
  clubs: "C",
  diamonds: "D",
};

export function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

export function createDeck(): Card[] {
  const cards = STANDARD_RANKS.flatMap((rank) =>
    SUITS.map((suit) => ({
      id: `${suit}-${rank}`,
      rank,
      suit,
      label: `${SUIT_LABELS[suit]}${rank}`,
      value: rankValue(rank),
    })),
  );

  return [
    ...cards,
    { id: "joker-small", rank: "SJ", label: "SJ", value: rankValue("SJ") },
    { id: "joker-big", rank: "BJ", label: "BJ", value: rankValue("BJ") },
  ];
}

export function sortCardsDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function sortCardsAsc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.value - b.value || a.label.localeCompare(b.label));
}

export function dealDdz(deck: Card[]): {
  players: [Card[], Card[], Card[]];
  bottom: Card[];
} {
  if (deck.length !== 54) {
    throw new Error("A Dou Dizhu deck must contain 54 cards.");
  }

  return {
    players: [
      sortCardsDesc(deck.slice(0, 17)),
      sortCardsDesc(deck.slice(17, 34)),
      sortCardsDesc(deck.slice(34, 51)),
    ],
    bottom: sortCardsDesc(deck.slice(51)),
  };
}

