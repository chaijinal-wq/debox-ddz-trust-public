import type { SignedActionEnvelope, TranscriptEvent } from "@debox-ddz/protocol";
import { sha256Hex } from "./rng.js";

export const TRANSCRIPT_EVENT_DOMAIN = "debox-ddz-transcript-event-v1";
export const ZERO_TRANSCRIPT_HASH = "0".repeat(64);

export interface TranscriptActionEvidence {
  actionId: string;
  authSource: SignedActionEnvelope["authSource"];
  playerSignature?: string;
}

export interface TranscriptEventInput {
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  actionEvidence?: TranscriptActionEvidence;
}

export interface TranscriptVerificationResult {
  ok: boolean;
  finalHash: string;
  error?: string;
  failedIndex?: number;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function transcriptEventHashMaterial(
  input: Omit<TranscriptEvent, "eventHash">,
): string {
  return canonicalStringify({
    domain: TRANSCRIPT_EVENT_DOMAIN,
    index: input.index,
    type: input.type,
    actorId: input.actorId,
    payload: input.payload,
    previousHash: input.previousHash,
    createdAt: input.createdAt,
    actionId: input.actionId,
    authSource: input.authSource,
    playerSignature: input.playerSignature,
  });
}

export async function hashTranscriptEvent(input: Omit<TranscriptEvent, "eventHash">): Promise<string> {
  return sha256Hex(transcriptEventHashMaterial(input));
}

export async function appendTranscriptEvent(
  transcript: TranscriptEvent[],
  input: TranscriptEventInput,
): Promise<TranscriptEvent> {
  const eventWithoutHash: Omit<TranscriptEvent, "eventHash"> = {
    index: transcript.length,
    type: input.type,
    actorId: input.actorId,
    payload: input.payload,
    previousHash: transcript.at(-1)?.eventHash ?? ZERO_TRANSCRIPT_HASH,
    createdAt: input.createdAt,
    actionId: input.actionEvidence?.actionId,
    authSource: input.actionEvidence?.authSource,
    playerSignature: input.actionEvidence?.playerSignature,
  };
  const event: TranscriptEvent = {
    ...eventWithoutHash,
    eventHash: await hashTranscriptEvent(eventWithoutHash),
  };
  transcript.push(event);
  return event;
}

export async function verifyTranscriptHashChain(transcript: TranscriptEvent[]): Promise<TranscriptVerificationResult> {
  let previousHash = ZERO_TRANSCRIPT_HASH;
  for (let index = 0; index < transcript.length; index += 1) {
    const event = transcript[index];
    if (event.index !== index) {
      return {
        ok: false,
        finalHash: previousHash,
        failedIndex: index,
        error: `Transcript index mismatch at ${index}.`,
      };
    }
    if (event.previousHash !== previousHash) {
      return {
        ok: false,
        finalHash: previousHash,
        failedIndex: index,
        error: `Transcript previousHash mismatch at ${index}.`,
      };
    }

    const { eventHash: _eventHash, ...eventWithoutHash } = event;
    const expectedHash = await hashTranscriptEvent(eventWithoutHash);
    if (event.eventHash !== expectedHash) {
      return {
        ok: false,
        finalHash: previousHash,
        failedIndex: index,
        error: `Transcript eventHash mismatch at ${index}.`,
      };
    }
    previousHash = event.eventHash;
  }

  return {
    ok: true,
    finalHash: previousHash,
  };
}
