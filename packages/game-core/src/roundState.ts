import {
  ROUND_MULTIPLIER_CAP,
  counterClockwiseSeatIndexForOffset,
  type AssetSymbol,
  type BidScore,
  type PlayerStake,
  type RoundActiveMoveSnapshot,
  type RoundCardSnapshot,
  type RoundMoveSnapshot,
  type RoundPlayStateSnapshot,
  type RoundResultSnapshot,
  type WinnerSide,
} from "@debox-ddz/protocol";
import { sortCardsDesc, type Card } from "./cards.js";
import { classifyHand, compareHands } from "./ddzRules.js";
import { settleRoom } from "./settlement.js";

export interface InitializePlayableRoundInput {
  asset: AssetSymbol;
  players: [PlayerStake, PlayerStake, PlayerStake];
  landlordId: string;
  bidScore: BidScore;
  baseStake: number;
  hands: Record<string, Card[]>;
  bottomCards: Card[];
}

export interface PlayCardsInput {
  playerId: string;
  turnId: string;
  cardIds: string[];
  createdAt?: string;
}

export interface PassTurnInput {
  playerId: string;
  turnId: string;
  createdAt?: string;
}

function nowIso(input?: string): string {
  return input ?? new Date().toISOString();
}

function toCardSnapshot(card: Card): RoundCardSnapshot {
  const snapshot: RoundCardSnapshot = {
    id: card.id,
    rank: card.rank,
    label: card.label,
    value: card.value,
  };
  if (card.suit) snapshot.suit = card.suit;
  return snapshot;
}

function fromCardSnapshot(card: RoundCardSnapshot): Card {
  return {
    id: card.id,
    rank: card.rank as Card["rank"],
    suit: card.suit as Card["suit"],
    label: card.label,
    value: card.value,
  };
}

function sortSnapshotCards(cards: RoundCardSnapshot[]): RoundCardSnapshot[] {
  return sortCardsDesc(cards.map(fromCardSnapshot)).map(toCardSnapshot);
}

function handCounts(hands: Record<string, RoundCardSnapshot[]>): Record<string, number> {
  return Object.fromEntries(Object.entries(hands).map(([playerId, hand]) => [playerId, hand.length]));
}

function requirePlayer(state: RoundPlayStateSnapshot, playerId: string): void {
  if (!state.seatOrder.includes(playerId)) {
    throw new Error("Player is not in this Round.");
  }
}

function requireCurrentTurn(state: RoundPlayStateSnapshot, playerId: string, turnId: string): void {
  requirePlayer(state, playerId);
  if (state.result) {
    throw new Error("Round is already complete.");
  }
  if (state.currentTurnPlayerId !== playerId) {
    throw new Error("It is not this player's turn.");
  }
  if (state.turnId !== turnId) {
    throw new Error("Turn id is stale.");
  }
}

function nextPlayerId(state: RoundPlayStateSnapshot, playerId: string): string {
  const index = state.seatOrder.indexOf(playerId);
  if (index < 0) throw new Error("Player is not in this Round.");
  return state.seatOrder[counterClockwiseSeatIndexForOffset(index, 1, state.seatOrder.length)];
}

function nextTurnId(state: RoundPlayStateSnapshot): string {
  return `turn-${state.moves.length + 2}`;
}

function doubleMultiplier(multiplier: number): number {
  return Math.min(multiplier * 2, ROUND_MULTIPLIER_CAP);
}

function buildPlayersFromState(state: RoundPlayStateSnapshot): [PlayerStake, PlayerStake, PlayerStake] {
  return state.seatOrder.map((playerId) => {
    return {
      id: playerId,
      name: playerId,
      address: "",
      cap: state.tableBalances[playerId] ?? 0,
    };
  }) as [PlayerStake, PlayerStake, PlayerStake];
}

function balanceDeltas(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(Object.keys(before).map((playerId) => [playerId, (after[playerId] ?? 0) - (before[playerId] ?? 0)]));
}

function applySpringMultiplier(state: RoundPlayStateSnapshot, winnerSide: WinnerSide, currentMultiplier: number): number {
  const playCounts = Object.fromEntries(state.seatOrder.map((playerId) => [playerId, 0]));
  for (const move of state.moves) {
    if (move.kind === "play") {
      playCounts[move.playerId] = (playCounts[move.playerId] ?? 0) + 1;
    }
  }

  if (winnerSide === "landlord") {
    const farmersNeverPlayed = state.seatOrder
      .filter((playerId) => playerId !== state.landlordId)
      .every((playerId) => (playCounts[playerId] ?? 0) === 0);
    return farmersNeverPlayed ? doubleMultiplier(currentMultiplier) : currentMultiplier;
  }

  const landlordPlayedOnlyOpening = (playCounts[state.landlordId] ?? 0) <= 1;
  return landlordPlayedOnlyOpening ? doubleMultiplier(currentMultiplier) : currentMultiplier;
}

function completeRound(
  state: RoundPlayStateSnapshot,
  winnerPlayerId: string,
  multiplier: number,
  completedAt: string,
): RoundResultSnapshot {
  const winnerSide: WinnerSide = winnerPlayerId === state.landlordId ? "landlord" : "farmers";
  const finalMultiplier = applySpringMultiplier(state, winnerSide, multiplier);
  const players = buildPlayersFromState(state);
  const currentBalances = { ...state.tableBalances };
  const result = settleRoom({
    asset: state.asset,
    players,
    landlordId: state.landlordId,
    winnerSide,
    baseStake: state.baseStake,
    bidScore: state.bidScore,
    multiplier: finalMultiplier || multiplier,
  });

  return {
    winnerSide,
    winnerPlayerId,
    landlordId: state.landlordId,
    bidScore: state.bidScore,
    multiplier: finalMultiplier || multiplier,
    balanceDeltas: balanceDeltas(currentBalances, result.payouts),
    finalBalances: result.payouts,
    completedAt,
  };
}

function cloneState(state: RoundPlayStateSnapshot): RoundPlayStateSnapshot {
  return {
    ...state,
    hands: Object.fromEntries(Object.entries(state.hands).map(([playerId, hand]) => [playerId, [...hand]])),
    handCounts: { ...state.handCounts },
    bottomCards: [...state.bottomCards],
    activeMove: state.activeMove ? { ...state.activeMove, cards: [...state.activeMove.cards], cardIds: [...state.activeMove.cardIds] } : undefined,
    moves: state.moves.map((move) => ({
      ...move,
      cardIds: [...move.cardIds],
      cards: move.cards ? [...move.cards] : undefined,
    })),
    exitAfterRoundPlayerIds: [...state.exitAfterRoundPlayerIds],
    result: state.result ? { ...state.result, balanceDeltas: { ...state.result.balanceDeltas }, finalBalances: { ...state.result.finalBalances } } : undefined,
  };
}

export function initializePlayableRound(input: InitializePlayableRoundInput): RoundPlayStateSnapshot {
  const seatOrder = input.players.map((player) => player.id) as [string, string, string];
  if (!seatOrder.includes(input.landlordId)) {
    throw new Error("landlordId must match a seated player.");
  }

  const hands = Object.fromEntries(
    input.players.map((player) => {
      const playerCards = [...(input.hands[player.id] ?? [])];
      if (player.id === input.landlordId) {
        playerCards.push(...input.bottomCards);
      }
      return [player.id, sortCardsDesc(playerCards).map(toCardSnapshot)];
    }),
  );

  return {
    seatOrder,
    landlordId: input.landlordId,
    bidScore: input.bidScore,
    baseStake: input.baseStake,
    asset: input.asset,
    hands,
    handCounts: handCounts(hands),
    tableBalances: Object.fromEntries(input.players.map((player) => [player.id, player.cap])),
    bottomCards: sortCardsDesc(input.bottomCards).map(toCardSnapshot),
    currentTurnPlayerId: input.landlordId,
    turnId: "turn-1",
    passStreak: 0,
    moves: [],
    exitAfterRoundPlayerIds: [],
  };
}

export function applyPlayableRoundPlay(
  inputState: RoundPlayStateSnapshot,
  input: PlayCardsInput,
): RoundPlayStateSnapshot {
  const state = cloneState(inputState);
  requireCurrentTurn(state, input.playerId, input.turnId);

  if (input.cardIds.length === 0) {
    throw new Error("Play action must include cards.");
  }
  if (new Set(input.cardIds).size !== input.cardIds.length) {
    throw new Error("Play action contains duplicate cards.");
  }

  const hand = state.hands[input.playerId] ?? [];
  const handById = new Map(hand.map((card) => [card.id, card]));
  const selected = input.cardIds.map((cardId) => {
    const card = handById.get(cardId);
    if (!card) {
      throw new Error("Played card is not in player's hand.");
    }
    return card;
  });
  const selectedCards = selected.map(fromCardSnapshot);
  const handRank = classifyHand(selectedCards);
  if (!handRank) {
    throw new Error("Played cards are not a valid Dou Dizhu hand.");
  }

  if (state.activeMove) {
    const comparison = compareHands(selectedCards, state.activeMove.cards.map(fromCardSnapshot));
    if (comparison <= 0) {
      throw new Error("Played cards do not beat the active table move.");
    }
  }

  const remaining = hand.filter((card) => !input.cardIds.includes(card.id));
  const multiplierAfter =
    handRank.kind === "bomb" || handRank.kind === "rocket"
      ? doubleMultiplier(state.moves.at(-1)?.multiplierAfter ?? 1)
      : state.moves.at(-1)?.multiplierAfter ?? 1;
  const move: RoundMoveSnapshot = {
    turnId: state.turnId,
    kind: "play",
    playerId: input.playerId,
    cardIds: [...input.cardIds],
    cards: sortSnapshotCards(selected),
    handKind: handRank.kind,
    multiplierAfter,
    passStreakAfter: 0,
    createdAt: nowIso(input.createdAt),
  };
  const activeMove: RoundActiveMoveSnapshot = {
    playerId: input.playerId,
    turnId: state.turnId,
    cardIds: [...input.cardIds],
    cards: sortSnapshotCards(selected),
    handKind: handRank.kind,
    mainValue: handRank.mainValue,
    length: handRank.length,
  };

  state.hands[input.playerId] = sortSnapshotCards(remaining);
  state.handCounts = handCounts(state.hands);
  state.moves.push(move);
  state.activeMove = activeMove;
  state.passStreak = 0;

  if (remaining.length === 0) {
    state.result = completeRound(state, input.playerId, multiplierAfter, move.createdAt);
    state.currentTurnPlayerId = input.playerId;
    state.turnId = "complete";
    return state;
  }

  state.currentTurnPlayerId = nextPlayerId(state, input.playerId);
  state.turnId = nextTurnId(state);
  return state;
}

export function applyPlayableRoundPass(
  inputState: RoundPlayStateSnapshot,
  input: PassTurnInput,
): RoundPlayStateSnapshot {
  const state = cloneState(inputState);
  requireCurrentTurn(state, input.playerId, input.turnId);

  if (!state.activeMove || state.activeMove.playerId === input.playerId) {
    throw new Error("Player cannot pass while leading.");
  }

  const passStreakAfter = state.passStreak + 1;
  const multiplierAfter = state.moves.at(-1)?.multiplierAfter ?? 1;
  const move: RoundMoveSnapshot = {
    turnId: state.turnId,
    kind: "pass",
    playerId: input.playerId,
    cardIds: [],
    multiplierAfter,
    passStreakAfter,
    createdAt: nowIso(input.createdAt),
  };
  state.moves.push(move);

  if (passStreakAfter >= 2) {
    state.currentTurnPlayerId = state.activeMove.playerId;
    state.activeMove = undefined;
    state.passStreak = 0;
  } else {
    state.currentTurnPlayerId = nextPlayerId(state, input.playerId);
    state.passStreak = passStreakAfter;
  }

  state.turnId = nextTurnId(state);
  return state;
}
