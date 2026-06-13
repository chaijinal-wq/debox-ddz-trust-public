import { normalizeAddress, requireEvmAddress } from "./addressPolicy.js";
import type { PlayerActionType, SignedActionEnvelope } from "./index.js";

export type UnsignedActionEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = Omit<
  SignedActionEnvelope<TPayload>,
  "signature"
>;

export interface WalletActionTypedDataMessage {
  deboxUid: string;
  walletAddress: `0x${string}`;
  chainId: string;
  roomId: string;
  actionType: PlayerActionType;
  actionId: string;
  nonce: string;
  expiresAt: string;
  payloadHash: `0x${string}`;
}

export const WALLET_ACTION_TYPED_DATA_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
  ],
  DeBoxDdzAction: [
    { name: "deboxUid", type: "string" },
    { name: "walletAddress", type: "address" },
    { name: "chainId", type: "string" },
    { name: "roomId", type: "string" },
    { name: "actionType", type: "string" },
    { name: "actionId", type: "string" },
    { name: "nonce", type: "string" },
    { name: "expiresAt", type: "string" },
    { name: "payloadHash", type: "bytes32" },
  ],
} as const;

export interface WalletActionTypedData<TChainId extends number | bigint = number | bigint> {
  domain: {
    name: "DeBox DDZ";
    version: "1";
    chainId: TChainId;
  };
  types: typeof WALLET_ACTION_TYPED_DATA_TYPES;
  primaryType: "DeBoxDdzAction";
  message: WalletActionTypedDataMessage;
}

export function canonicalActionStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalActionStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalActionStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function toJsonWireValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mockActionSignatureMaterial(envelope: UnsignedActionEnvelope): string {
  return canonicalActionStringify(envelope);
}

export function walletActionPayloadHashMaterial(envelope: UnsignedActionEnvelope): string {
  return canonicalActionStringify({
    sessionId: envelope.sessionId ?? null,
    roundId: envelope.roundId ?? null,
    actor: {
      id: envelope.actor.id,
      name: envelope.actor.name,
      address: normalizeAddress(envelope.actor.address) ?? "",
      avatarUrl: envelope.actor.avatarUrl ?? null,
    },
    payload: envelope.payload,
  });
}

export function buildWalletActionTypedDataMessage(input: {
  deboxUid: string;
  walletAddress: string;
  chainHexId: string;
  roomId: string;
  actionType: PlayerActionType;
  actionId: string;
  nonce: string;
  expiresAt: string;
  payloadHash: `0x${string}`;
}): WalletActionTypedDataMessage {
  return {
    deboxUid: input.deboxUid,
    walletAddress: requireEvmAddress(input.walletAddress, "Wallet action actor address"),
    chainId: input.chainHexId,
    roomId: input.roomId,
    actionType: input.actionType,
    actionId: input.actionId,
    nonce: input.nonce,
    expiresAt: input.expiresAt,
    payloadHash: input.payloadHash,
  };
}

export function buildWalletActionTypedDataFromMessage<TChainId extends number | bigint>(
  message: WalletActionTypedDataMessage,
  chainId: TChainId,
): WalletActionTypedData<TChainId>;
export function buildWalletActionTypedDataFromMessage<TChainId extends number | bigint>(
  message: WalletActionTypedDataMessage,
  chainId: TChainId,
): WalletActionTypedData<TChainId> {
  return {
    domain: {
      name: "DeBox DDZ",
      version: "1",
      chainId,
    },
    types: WALLET_ACTION_TYPED_DATA_TYPES,
    primaryType: "DeBoxDdzAction",
    message,
  };
}

export function buildWalletActionTypedData<TChainId extends number | bigint>(
  envelope: UnsignedActionEnvelope,
  input: { chainId: TChainId; chainHexId: string; payloadHash: `0x${string}` },
): WalletActionTypedData<TChainId>;
export function buildWalletActionTypedData<TChainId extends number | bigint>(
  envelope: UnsignedActionEnvelope,
  input: { chainId: TChainId; chainHexId: string; payloadHash: `0x${string}` },
): WalletActionTypedData<TChainId> {
  return buildWalletActionTypedDataFromMessage(
    buildWalletActionTypedDataMessage({
      deboxUid: envelope.actor.id,
      walletAddress: envelope.actor.address,
      chainHexId: input.chainHexId,
      roomId: envelope.roomId,
      actionType: envelope.type,
      actionId: envelope.actionId,
      nonce: envelope.nonce,
      expiresAt: envelope.expiresAt,
      payloadHash: input.payloadHash,
    }),
    input.chainId,
  );
}
