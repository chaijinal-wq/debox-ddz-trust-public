import {
  BPS_DENOMINATOR,
  type RoomSnapshot,
  type RoundCardSnapshot,
  type RoundSnapshot,
  type SessionSnapshot,
  type SettlementJobSnapshot,
  type SettlementRoute,
  type TranscriptEvent,
} from "@debox-ddz/protocol";
import {
  canonicalStringify,
  deriveDdzRoundDeal,
  sha256HexSync,
  verifyTranscriptHashChain,
  type DdzRoundDealDerivation,
} from "@debox-ddz/game-core";

export type TrustCheckStatus = "ok" | "failed" | "skipped";

export interface TrustCheck {
  id: string;
  status: TrustCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface TrustVerificationReport {
  ok: boolean;
  finalTranscriptHash?: string;
  checks: TrustCheck[];
}

export interface PublicTrustBundle {
  schemaVersion?: number;
  room?: RoomSnapshot;
  transcript?: TranscriptEvent[];
  sessions?: SessionSnapshot[];
  rounds?: RoundSnapshot[];
  settlement?: SettlementJobSnapshot;
  settlements?: SettlementJobSnapshot[];
}

interface NormalizedBundle {
  room?: RoomSnapshot;
  transcript: TranscriptEvent[];
  sessions: SessionSnapshot[];
  rounds: RoundSnapshot[];
  settlements: SettlementJobSnapshot[];
}

interface TranscriptSessionEvidence {
  id: string;
  playerIds?: [string, string, string];
  lockedBalances?: Record<string, number>;
  startingBalances?: Record<string, number>;
  baseStake?: number;
  feeRateBps?: number;
}

interface TranscriptRoundEvidence {
  id: string;
  sessionId: string;
  roundNumber: number;
  serverCommitment: string;
  serverNonce: string;
  playerReadyNonces: Record<string, string>;
  firstBidderSeat?: number;
  handCounts?: Record<string, number>;
  bottomCards?: RoundCardSnapshot[];
  roundSeed?: string;
  shuffleSeed?: string;
}

function checkOk(id: string, message: string, details?: Record<string, unknown>): TrustCheck {
  return { id, status: "ok", message, details };
}

function checkFailed(id: string, message: string, details?: Record<string, unknown>): TrustCheck {
  return { id, status: "failed", message, details };
}

function checkSkipped(id: string, message: string, details?: Record<string, unknown>): TrustCheck {
  return { id, status: "skipped", message, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isRoomSnapshotLike(value: unknown): value is RoomSnapshot {
  return isRecord(value) && typeof value.id === "string" && Array.isArray(value.transcript) && Array.isArray(value.seats);
}

function dedupeById<T extends { id: string }>(items: Array<T | undefined>): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    if (item?.id) seen.set(item.id, item);
  }
  return [...seen.values()];
}

function normalizeBundle(input: unknown): NormalizedBundle {
  const record = isRecord(input) ? input : {};
  const room = isRoomSnapshotLike(record.room) ? record.room : isRoomSnapshotLike(input) ? input : undefined;
  const transcript = asArray<TranscriptEvent>(record.transcript).length > 0
    ? asArray<TranscriptEvent>(record.transcript)
    : room?.transcript ?? [];
  const explicitSettlement = isRecord(record.settlement) ? (record.settlement as unknown as SettlementJobSnapshot) : undefined;

  return {
    room,
    transcript,
    sessions: dedupeById<SessionSnapshot>([
      ...asArray<SessionSnapshot>(record.sessions),
      ...(room?.sessionHistory ?? []),
      room?.currentSession,
    ]),
    rounds: dedupeById<RoundSnapshot>([
      ...asArray<RoundSnapshot>(record.rounds),
      ...(room?.roundHistory ?? []),
      room?.currentRound,
    ]),
    settlements: dedupeById<SettlementJobSnapshot>([
      ...asArray<SettlementJobSnapshot>(record.settlements),
      explicitSettlement,
      ...(room?.settlementHistory ?? []),
      room?.settlementJob,
    ]),
  };
}

function deriveServerCommitment(roomId: string, roundNumber: number, serverNonce: string): string {
  return sha256HexSync(
    JSON.stringify({
      domain: "debox-ddz-server-nonce-commitment-v2",
      roomId,
      roundNumber,
      serverNonce,
    }),
  );
}

function cardIds(cards: readonly RoundCardSnapshot[]): string[] {
  return cards.map((card) => card.id);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function numericRecordSum(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function assertAmountRecord(values: Record<string, number>, label: string): string | undefined {
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return `${label}.${key} must be a non-negative safe integer.`;
    }
  }
  return undefined;
}

function sessionFromTranscript(transcript: TranscriptEvent[]): TranscriptSessionEvidence[] {
  return transcript
    .filter((event) => event.type === "session.started")
    .map((event) => {
      const payload = event.payload;
      return {
        id: typeof payload.sessionId === "string" ? payload.sessionId : "",
        playerIds: Array.isArray(payload.playerIds) && payload.playerIds.length === 3
          ? (payload.playerIds as [string, string, string])
          : undefined,
        lockedBalances: isRecord(payload.lockedBalances) ? (payload.lockedBalances as Record<string, number>) : undefined,
        startingBalances: isRecord(payload.lockedBalances) ? (payload.lockedBalances as Record<string, number>) : undefined,
        feeRateBps: typeof payload.feeRateBps === "number" ? payload.feeRateBps : undefined,
      };
    })
    .filter((session) => session.id);
}

function roundsFromTranscript(transcript: TranscriptEvent[]): TranscriptRoundEvidence[] {
  return transcript
    .filter((event) => event.type === "round.started")
    .map((event) => {
      const payload = event.payload;
      return {
        id: typeof payload.roundId === "string" ? payload.roundId : "",
        sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
        roundNumber: typeof payload.roundNumber === "number" ? payload.roundNumber : 0,
        serverCommitment: typeof payload.serverCommitment === "string" ? payload.serverCommitment : "",
        serverNonce: typeof payload.serverNonce === "string" ? payload.serverNonce : "",
        playerReadyNonces: isRecord(payload.playerReadyNonces)
          ? (payload.playerReadyNonces as Record<string, string>)
          : {},
        firstBidderSeat: typeof payload.firstBidderSeat === "number" ? payload.firstBidderSeat : undefined,
        handCounts: isRecord(payload.handCounts) ? (payload.handCounts as Record<string, number>) : undefined,
        roundSeed: typeof payload.roundSeed === "string" ? payload.roundSeed : undefined,
        shuffleSeed: typeof payload.shuffleSeed === "string" ? payload.shuffleSeed : undefined,
      };
    })
    .filter((round) => round.id && round.sessionId);
}

function settlementJobsFromTranscript(transcript: TranscriptEvent[]): SettlementJobSnapshot[] {
  return transcript
    .filter((event) => event.type === "settlement.queued")
    .map((event): SettlementJobSnapshot => {
      const payload = event.payload;
      return {
        id: typeof payload.settlementId === "string" ? payload.settlementId : "",
        roomId: "",
        sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
        status: "queued" as const,
        expectedAsset: "BOX" as const,
        finalBalances: isRecord(payload.finalBalances) ? (payload.finalBalances as Record<string, number>) : {},
        fees: isRecord(payload.fees) ? (payload.fees as Record<string, number>) : {},
        settlementChoices: isRecord(payload.settlementChoices)
          ? (payload.settlementChoices as Record<string, SettlementRoute>)
          : undefined,
        transcriptHash: typeof payload.transcriptHash === "string" ? payload.transcriptHash : "",
        supportContact: {
          channel: "debox-group",
          label: "public transcript",
          value: "public transcript",
        },
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      };
    })
    .filter((settlement) => settlement.id && settlement.sessionId);
}

function sessionEvidenceFromSnapshot(session: SessionSnapshot): TranscriptSessionEvidence {
  return {
    id: session.id,
    playerIds: session.playerIds,
    lockedBalances: session.lockedBalances,
    startingBalances: session.startingBalances,
    baseStake: session.baseStake,
    feeRateBps: session.feeConfig.feeRateBps,
  };
}

function roundEvidenceFromSnapshot(round: RoundSnapshot): TranscriptRoundEvidence | undefined {
  if (!round.serverNonce) return undefined;
  return {
    id: round.id,
    sessionId: round.sessionId,
    roundNumber: round.roundNumber,
    serverCommitment: round.serverCommitment,
    serverNonce: round.serverNonce,
    playerReadyNonces: round.playerReadyNonces,
    firstBidderSeat: round.firstBidderSeat,
    handCounts: round.biddingHandCounts,
    bottomCards: round.playState?.bottomCards,
  };
}

function verifyRoundDeal(
  round: TranscriptRoundEvidence,
  session: TranscriptSessionEvidence | undefined,
  roomId: string | undefined,
): TrustCheck[] {
  const idPrefix = `round:${round.id}`;
  if (!roomId) {
    return [checkSkipped(`${idPrefix}:room-id`, "Cannot verify round deal without roomId.")];
  }
  if (!session?.playerIds) {
    return [checkSkipped(`${idPrefix}:session`, "Cannot verify round deal without session player order.")];
  }
  if (!round.serverNonce || !round.serverCommitment || !round.roundNumber) {
    return [checkFailed(`${idPrefix}:evidence`, "Round is missing commitment, reveal, or round number.")];
  }

  const checks: TrustCheck[] = [];
  const expectedCommitment = deriveServerCommitment(roomId, round.roundNumber, round.serverNonce);
  checks.push(
    expectedCommitment === round.serverCommitment
      ? checkOk(`${idPrefix}:commitment`, "Server nonce matches pre-commitment.")
      : checkFailed(`${idPrefix}:commitment`, "Server nonce does not match pre-commitment.", {
          expectedCommitment,
          actualCommitment: round.serverCommitment,
        }),
  );

  const orderedReadyNonces = session.playerIds.map((playerId) => round.playerReadyNonces[playerId]);
  if (orderedReadyNonces.some((nonce) => typeof nonce !== "string" || nonce.length === 0)) {
    checks.push(checkFailed(`${idPrefix}:ready-nonces`, "Round is missing one or more player ready nonces."));
    return checks;
  }

  const derivation: DdzRoundDealDerivation = deriveDdzRoundDeal({
    roomId,
    sessionId: round.sessionId,
    roundId: round.id,
    serverNonce: round.serverNonce,
    playerReadyNonces: orderedReadyNonces as [string, string, string],
  });

  checks.push(
    round.firstBidderSeat === undefined || round.firstBidderSeat === derivation.firstBidderSeat
      ? checkOk(`${idPrefix}:first-bidder`, "First bidder matches canonical derivation.", {
          firstBidderSeat: derivation.firstBidderSeat,
        })
      : checkFailed(`${idPrefix}:first-bidder`, "First bidder does not match canonical derivation.", {
          expected: derivation.firstBidderSeat,
          actual: round.firstBidderSeat,
        }),
  );

  if (round.roundSeed) {
    checks.push(
      round.roundSeed === derivation.roundSeed
        ? checkOk(`${idPrefix}:round-seed`, "Round seed matches canonical derivation.")
        : checkFailed(`${idPrefix}:round-seed`, "Round seed does not match canonical derivation.", {
            expected: derivation.roundSeed,
            actual: round.roundSeed,
          }),
    );
  }

  if (round.shuffleSeed) {
    checks.push(
      round.shuffleSeed === derivation.shuffleSeed
        ? checkOk(`${idPrefix}:shuffle-seed`, "Shuffle seed matches canonical derivation.")
        : checkFailed(`${idPrefix}:shuffle-seed`, "Shuffle seed does not match canonical derivation.", {
            expected: derivation.shuffleSeed,
            actual: round.shuffleSeed,
          }),
    );
  }

  if (round.handCounts) {
    const expectedHandCounts = Object.fromEntries(session.playerIds.map((playerId, index) => [playerId, derivation.deal.players[index].length]));
    checks.push(
      sameJson(round.handCounts, expectedHandCounts)
        ? checkOk(`${idPrefix}:hand-counts`, "Disclosed hand counts match canonical deal.")
        : checkFailed(`${idPrefix}:hand-counts`, "Disclosed hand counts do not match canonical deal.", {
            expected: expectedHandCounts,
            actual: round.handCounts,
          }),
    );
  }

  if (round.bottomCards) {
    checks.push(
      sameJson(cardIds(round.bottomCards), cardIds(derivation.deal.bottom))
        ? checkOk(`${idPrefix}:bottom-cards`, "Bottom cards match canonical deal.")
        : checkFailed(`${idPrefix}:bottom-cards`, "Bottom cards do not match canonical deal.", {
            expected: cardIds(derivation.deal.bottom),
            actual: cardIds(round.bottomCards),
          }),
    );
  }

  return checks;
}

function verifySettlement(
  settlement: SettlementJobSnapshot,
  session: TranscriptSessionEvidence | undefined,
  transcript: TranscriptEvent[],
): TrustCheck[] {
  const idPrefix = `settlement:${settlement.id}`;
  if (!session?.lockedBalances || !session.startingBalances) {
    return [checkSkipped(`${idPrefix}:session`, "Cannot verify settlement without session balances.")];
  }

  const checks: TrustCheck[] = [];
  const finalBalancesError = assertAmountRecord(settlement.finalBalances, "finalBalances");
  const feesError = assertAmountRecord(settlement.fees, "fees");
  if (finalBalancesError) checks.push(checkFailed(`${idPrefix}:final-balances`, finalBalancesError));
  if (feesError) checks.push(checkFailed(`${idPrefix}:fees`, feesError));
  if (finalBalancesError || feesError) return checks;

  const lockedTotal = numericRecordSum(session.lockedBalances);
  const finalTotal = numericRecordSum(settlement.finalBalances);
  checks.push(
    lockedTotal === finalTotal
      ? checkOk(`${idPrefix}:conservation`, "Final balances conserve locked funds.", { total: finalTotal })
      : checkFailed(`${idPrefix}:conservation`, "Final balances do not conserve locked funds.", {
          lockedTotal,
          finalTotal,
        }),
  );

  const feeRateBps = session.feeRateBps ?? 0;
  const expectedFees = Object.fromEntries(
    Object.entries(settlement.finalBalances).map(([playerId, finalBalance]) => {
      const profit = Math.max(finalBalance - (session.startingBalances?.[playerId] ?? 0), 0);
      return [playerId, Math.floor((profit * feeRateBps) / BPS_DENOMINATOR)];
    }),
  );
  checks.push(
    sameJson(settlement.fees, expectedFees)
      ? checkOk(`${idPrefix}:profit-fee`, "Fees match profit-only fee formula.", { feeRateBps })
      : checkFailed(`${idPrefix}:profit-fee`, "Fees do not match profit-only fee formula.", {
          feeRateBps,
          expected: expectedFees,
          actual: settlement.fees,
        }),
  );

  if (transcript.length > 0 && settlement.transcriptHash) {
    const matchingEvent = transcript.find((event) => event.eventHash === settlement.transcriptHash);
    checks.push(
      matchingEvent
        ? checkOk(`${idPrefix}:transcript-hash`, "Settlement transcriptHash points to a transcript event.", {
            eventIndex: matchingEvent.index,
            eventType: matchingEvent.type,
          })
        : checkFailed(`${idPrefix}:transcript-hash`, "Settlement transcriptHash is not present in transcript."),
    );
  }

  return checks;
}

export async function verifyTrustBundle(input: unknown): Promise<TrustVerificationReport> {
  const bundle = normalizeBundle(input);
  const checks: TrustCheck[] = [];

  if (bundle.transcript.length === 0) {
    checks.push(checkSkipped("transcript:hash-chain", "No transcript provided."));
  } else {
    const transcriptCheck = await verifyTranscriptHashChain(bundle.transcript);
    checks.push(
      transcriptCheck.ok
        ? checkOk("transcript:hash-chain", "Transcript hash chain is valid.", {
            finalHash: transcriptCheck.finalHash,
          })
        : checkFailed("transcript:hash-chain", transcriptCheck.error ?? "Transcript hash chain is invalid.", {
            failedIndex: transcriptCheck.failedIndex,
            finalHash: transcriptCheck.finalHash,
          }),
    );
  }

  const roomId = bundle.room?.id ?? bundle.settlements.find((settlement) => settlement.roomId)?.roomId;
  const transcriptSessions = sessionFromTranscript(bundle.transcript);
  const sessions = new Map<string, TranscriptSessionEvidence>();
  for (const session of transcriptSessions) sessions.set(session.id, session);
  for (const session of bundle.sessions.map(sessionEvidenceFromSnapshot)) sessions.set(session.id, session);

  const transcriptRounds = roundsFromTranscript(bundle.transcript);
  const snapshotRounds = bundle.rounds.map(roundEvidenceFromSnapshot).filter((round): round is TranscriptRoundEvidence => Boolean(round));
  const rounds = dedupeById<TranscriptRoundEvidence>([...transcriptRounds, ...snapshotRounds]);
  if (rounds.length === 0) {
    checks.push(checkSkipped("rounds:deal", "No revealed rounds provided."));
  } else {
    for (const round of rounds) {
      checks.push(...verifyRoundDeal(round, sessions.get(round.sessionId), roomId));
    }
  }

  const settlements = dedupeById<SettlementJobSnapshot>([
    ...settlementJobsFromTranscript(bundle.transcript),
    ...bundle.settlements,
  ]);
  if (settlements.length === 0) {
    checks.push(checkSkipped("settlements:conservation", "No settlement evidence provided."));
  } else {
    for (const settlement of settlements) {
      checks.push(...verifySettlement(settlement, sessions.get(settlement.sessionId), bundle.transcript));
    }
  }

  const failed = checks.some((check) => check.status === "failed");
  return {
    ok: !failed,
    finalTranscriptHash: checks.find((check) => check.id === "transcript:hash-chain")?.details?.finalHash as string | undefined,
    checks,
  };
}
