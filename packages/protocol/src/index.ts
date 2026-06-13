export type AssetSymbol = "BOX";
export type BidScore = 1 | 2 | 3;

export interface ChainConfig {
  id: 56;
  hexId: "0x38";
  name: "BNB Smart Chain";
  shortName: "BSC";
}

export interface TokenConfig {
  symbol: AssetSymbol;
  chainId: ChainConfig["id"];
  address: `0x${string}`;
  decimals: 18;
}

export const BSC_CHAIN: ChainConfig = {
  id: 56,
  hexId: "0x38",
  name: "BNB Smart Chain",
  shortName: "BSC",
};

export const BSC_ASSETS: Record<AssetSymbol, TokenConfig> = {
  BOX: {
    symbol: "BOX",
    chainId: BSC_CHAIN.id,
    address: "0x6386adc4bc9c21984e34fd916bb349dd861742af",
    decimals: 18,
  },
};

export const V1_ASSET: AssetSymbol = "BOX";
export const ROUND_MULTIPLIER_CAP = 16;
export const BPS_DENOMINATOR = 10_000;
export const INITIAL_PLATFORM_FEE_BPS = 10;
export const INITIAL_PLATFORM_FEE_LABEL = "0.1%";
export const DDZ_TURN_TIMEOUT_SECONDS = {
  bidding: 30,
  playing: 30,
} as const;
export const DDZ_TURN_COUNTDOWN_WARNING_SECONDS = 10;
export const DDZ_WAITING_ROOM_AUTO_EXIT_SECONDS = 5 * 60;

export function counterClockwiseSeatIndexForOffset(firstSeatIndex: number, offset: number, seatCount = 3): number {
  if (!Number.isSafeInteger(seatCount) || seatCount < 1) {
    throw new Error("seatCount must be a positive integer.");
  }
  if (!Number.isSafeInteger(firstSeatIndex) || firstSeatIndex < 0 || firstSeatIndex >= seatCount) {
    throw new Error("firstSeatIndex must be a valid seat index.");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer.");
  }

  return (firstSeatIndex + seatCount - (offset % seatCount)) % seatCount;
}

export function counterClockwiseBidSeatIndex(firstBidderSeat: number, bidCount: number, seatCount = 3): number {
  return counterClockwiseSeatIndexForOffset(firstBidderSeat, bidCount, seatCount);
}

export function counterClockwiseBidPlayerId(
  playerIds: readonly string[],
  firstBidderSeat: number,
  bidCount: number,
): string {
  if (playerIds.length < 1) {
    throw new Error("playerIds must include at least one player.");
  }
  const seatIndex = counterClockwiseBidSeatIndex(firstBidderSeat, bidCount, playerIds.length);
  const playerId = playerIds[seatIndex];
  if (!playerId) throw new Error("Cannot resolve counter-clockwise bidder.");
  return playerId;
}

declare const minorBoxAmountBrand: unique symbol;
export type MinorBoxAmount = number & { readonly [minorBoxAmountBrand]: "minor-box-amount" };

export function minorBoxAmount(value: unknown, fieldName = "amount"): MinorBoxAmount {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer minor BOX amount.`);
  }
  return value as MinorBoxAmount;
}

export function positiveMinorBoxAmount(value: unknown, fieldName = "amount"): MinorBoxAmount {
  const amount = minorBoxAmount(value, fieldName);
  if (amount <= 0) {
    throw new Error(`${fieldName} must be greater than zero minor BOX.`);
  }
  return amount;
}

export interface StakePresetTier {
  bidScore: BidScore;
  farmerUnit: number;
  landlordRisk: number;
}

export interface StakePreset {
  id: string;
  label: string;
  baseStake: number;
  tiers: [StakePresetTier, StakePresetTier, StakePresetTier];
}

function formatStakePresetAmount(amount: number): string {
  return (amount / 100).toFixed(2).replace(/\.?0+$/, "");
}

export function makeStakePreset(id: string, baseStake: number): StakePreset {
  const label = [baseStake, baseStake * 2, baseStake * 3].map(formatStakePresetAmount).join("/");
  return {
    id,
    label: `${label} BOX`,
    baseStake,
    tiers: [1, 2, 3].map((bidScore) => {
      const farmerUnit = baseStake * bidScore;
      return {
        bidScore: bidScore as BidScore,
        farmerUnit,
        landlordRisk: farmerUnit * 2,
      };
    }) as [StakePresetTier, StakePresetTier, StakePresetTier],
  };
}

export const STAKE_PRESETS: [StakePreset, StakePreset, StakePreset] = [
  makeStakePreset("box-1-2-3", 1_00),
  makeStakePreset("box-10-20-30", 10_00),
  makeStakePreset("box-100-200-300", 100_00),
];

export const MINIMUM_LOCK_MULTIPLIER = 20;
export const CONTINUATION_LOCK_MULTIPLIER = 10;
export const CUSTOM_STAKE_PRESET_ID = "custom";
export const DEFAULT_REAL_BOX_PILOT_BASE_STAKE = 10;

export function minimumLockForStakePreset(stakePresetId: string): number {
  const preset = STAKE_PRESETS.find((item) => item.id === stakePresetId);
  if (!preset) {
    throw new Error("Unknown stake preset.");
  }
  return minimumLockForBaseStake(preset.baseStake);
}

export function minimumLockForBaseStake(baseStake: number): number {
  return baseStake * MINIMUM_LOCK_MULTIPLIER;
}

export function continuationMinimumLockForBaseStake(baseStake: number): number {
  return baseStake * CONTINUATION_LOCK_MULTIPLIER;
}

export function stakePresetForBaseStake(baseStake: number, id = CUSTOM_STAKE_PRESET_ID): StakePreset {
  return makeStakePreset(id, baseStake);
}

export function stakePresetForConfig(config: { stakePresetId: string; baseStake?: number }): StakePreset {
  const preset = STAKE_PRESETS.find((item) => item.id === config.stakePresetId);
  if (preset && (config.baseStake === undefined || config.baseStake === preset.baseStake)) {
    return preset;
  }
  if (config.baseStake === undefined) {
    if (preset) return preset;
    throw new Error("Unknown stake preset.");
  }
  return stakePresetForBaseStake(config.baseStake, config.stakePresetId);
}

export interface RealBoxPilotConfig {
  enabled: boolean;
  label: string;
  stakePresetIds: string[];
  defaultStakePresetId: string;
  defaultBaseStake?: number;
  minimumLock: number;
  maximumLock: number;
  requireEscrowAddress: boolean;
  escrowAddress?: `0x${string}`;
  note: string;
}

export const REAL_BOX_PILOT_DISABLED: RealBoxPilotConfig = {
  enabled: false,
  label: "预生产模拟",
  stakePresetIds: STAKE_PRESETS.map((preset) => preset.id),
  defaultStakePresetId: STAKE_PRESETS[0].id,
  defaultBaseStake: STAKE_PRESETS[0].baseStake,
  minimumLock: 10_00,
  maximumLock: 50_000_00,
  requireEscrowAddress: true,
  note: "真实 BOX 入金开关关闭；大厅可继续做 DeBox runtime、分享和无资金签名验收。",
};

export const REAL_BOX_ONE_BOX_PILOT: RealBoxPilotConfig = {
  enabled: true,
  label: "真实资金试运行",
  stakePresetIds: [CUSTOM_STAKE_PRESET_ID, "box-1-2-3", "box-10-20-30"],
  defaultStakePresetId: CUSTOM_STAKE_PRESET_ID,
  defaultBaseStake: DEFAULT_REAL_BOX_PILOT_BASE_STAKE,
  minimumLock: minimumLockForBaseStake(DEFAULT_REAL_BOX_PILOT_BASE_STAKE),
  maximumLock: 5000_00,
  requireEscrowAddress: true,
  note: "开放 0.1、1、10 BOX 底分试运行；第一把至少锁定 20 倍底分，续局低于 10 倍时补到至少 20 倍；最高锁定 5000 BOX。",
};

export interface Player {
  id: string;
  name: string;
  address: string;
  avatarUrl?: string;
}

export type CommunityFeedbackCategory = "experience" | "rules" | "ui_confusing" | "money_flow" | "feature";
export type CommunityFeedbackVisibility = "public_name" | "public_anonymous" | "team_only";
export type CommunityFeedbackStatus = "received" | "reviewing" | "adopted" | "shipped" | "declined";

export interface CommunityFeedbackAuthor {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface CommunityFeedbackSubmission {
  author: CommunityFeedbackAuthor;
  category: CommunityFeedbackCategory;
  content: string;
  page: string;
  visibility: CommunityFeedbackVisibility;
  roomId?: string;
}

export interface CommunityFeedbackItem extends CommunityFeedbackSubmission {
  id: string;
  status: CommunityFeedbackStatus;
  contributionAward: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerStake extends Player {
  cap: number;
}

export type WinnerSide = "landlord" | "farmers";

export interface RoomInviteSummary {
  roomId: string;
  ownerName: string;
  asset: AssetSymbol;
  stakePreset: string;
  minimumLock: string;
  waitingPlayers: number;
  joinUrl: string;
}

export type RoomVisibility = "public" | "invite";
export type RoomStatus = "waiting" | "locking" | "active" | "settling" | "manual_review" | "system_exception" | "closed";
export type SeatRole = "landlord" | "farmer";
export type SessionStatus = "waiting" | "locking" | "active" | "settling" | "settled" | "manual_review" | "system_exception";
export type RoundStatus = "ready" | "bidding" | "playing" | "complete" | "void" | "system_exception";
export type PlayerActionType =
  | "create_room"
  | "configure_room"
  | "join"
  | "confirm_player_funding"
  | "ready"
  | "chat"
  | "bid"
  | "play"
  | "pass"
  | "exit"
  | "kick"
  | "settlement_choice";
export type SettlementRoute = "table_balance" | "withdrawal";
export type SettlementJobStatus = "queued" | "retrying" | "submitted" | "confirmed" | "manual_review";
export type AvailableBalanceReleaseStatus = "queued" | "retrying" | "submitted" | "pending" | "confirmed" | "manual_review";

export interface FeeConfig {
  feeRateBps: number;
  feeRateLabel: string;
  effectiveAt: string;
  announcedAt: string;
}

export const INITIAL_FEE_CONFIG: FeeConfig = {
  feeRateBps: INITIAL_PLATFORM_FEE_BPS,
  feeRateLabel: INITIAL_PLATFORM_FEE_LABEL,
  effectiveAt: "launch",
  announcedAt: "launch",
};

export interface SupportContact {
  channel: "debox-group";
  label: string;
  value: string;
}

export const DEFAULT_SUPPORT_CONTACT: SupportContact = {
  channel: "debox-group",
  label: "DeBox 群",
  value: "待配置",
};

export type DeBoxOfficialConfirmationStatus = "pending" | "provided" | "verified" | "blocked";

export interface DeBoxOfficialConfirmationItem {
  id:
    | "production-credentials"
    | "identity-verification"
    | "wallet-signature-method"
    | "native-share"
    | "openapi-limits"
    | "support-contact"
    | "webview-runtime"
    | "platform-review"
    | "risk-wording";
  label: string;
  status: DeBoxOfficialConfirmationStatus;
  note: string;
  blocksRealMoney: boolean;
}

export const DEBOX_OFFICIAL_CONFIRMATIONS: DeBoxOfficialConfirmationItem[] = [
  {
    id: "production-credentials",
    label: "生产 DApp / API 凭证",
    status: "pending",
    note: "DeBox DApp 会自动关联/创建 Bot；App key/API Key、App Secret、Bot identity 和目标群 gid 已进入本地配置；仍等待 HTTPS 域名和 DeBox App 内 runtime evidence。",
    blocksRealMoney: true,
  },
  {
    id: "identity-verification",
    label: "后端可信身份验真",
    status: "provided",
    note: "2026-05-29 会议口头确认主路线为 window.deboxWallet + debox_getUserInfo；真实资金动作仍需 typed-data 签名和 DeBox App 内证据。",
    blocksRealMoney: true,
  },
  {
    id: "wallet-signature-method",
    label: "钱包签名方法",
    status: "provided",
    note: "2026-05-29 会议口头确认 eth_signTypedData_v4 支持，payload 可包含 uid、walletAddress、chainId、domain/origin、actionId 和 nonce。",
    blocksRealMoney: true,
  },
  {
    id: "native-share",
    label: "原生分享 / 群卡片",
    status: "provided",
    note: "2026-05-29 会议口头确认右上角原生分享房间 URL 到群/好友；无 JS bridge，内容不可自定义，Bot 消息作为 fallback。",
    blocksRealMoney: false,
  },
  {
    id: "openapi-limits",
    label: "OpenAPI / Bot 限制",
    status: "provided",
    note: "2026-05-29 会议口头确认 Bot 群消息、button/inline keyboard、Node SDK 和常规限频可用；具体生产限频和错误码仍需实测归档。",
    blocksRealMoney: true,
  },
  {
    id: "support-contact",
    label: "客服群和通知",
    status: "verified",
    note: "2026-05-30 已配置 support group，并通过 bot/getMe、group/info 和一次 Bot 群消息联调；群编号仅保留在服务端配置和运营证据中，换群或 Bot 被移出时需要重新采证。",
    blocksRealMoney: false,
  },
  {
    id: "webview-runtime",
    label: "DeBox App WebView 运行时",
    status: "provided",
    note: "2026-05-29 会议口头确认标准 H5/WebKit、storage、WebSocket 和外链可用；仍需 DeBox App 内 diagnostics evidence。",
    blocksRealMoney: true,
  },
  {
    id: "platform-review",
    label: "平台审核",
    status: "provided",
    note: "2026-05-29 会议口头表示先按标准 Web3 技术路线跑通，暂不把合规作为当前技术验证阻塞项；上线前仍需归档平台审核 evidence。",
    blocksRealMoney: true,
  },
  {
    id: "risk-wording",
    label: "风险提示文案",
    status: "provided",
    note: "2026-05-29 会议口头表示暂不需要特殊合规处理；上线前仍需在产品内保留手续费、结算、人工处理和支持入口说明。",
    blocksRealMoney: true,
  },
];

export interface RoomConfig {
  asset: AssetSymbol;
  stakePresetId: StakePreset["id"];
  baseStake?: number;
  minimumLock: number;
  visibility: RoomVisibility;
  multiplierCap: typeof ROUND_MULTIPLIER_CAP;
  feeConfig: FeeConfig;
}

export interface RoomSeat {
  seatIndex: number;
  player: Player | null;
  ready: boolean;
  online: boolean;
  trustee: boolean;
  trusteeReason?: "disconnect" | "timeout" | "exit_after_round";
  lastSeenAt?: string;
  disconnectedAt?: string;
  role?: SeatRole;
  tableBalance: number;
  intendedLock: number;
  funding?: PlayerFundingSnapshot;
}

export interface TranscriptEvent {
  index: number;
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
  createdAt: string;
  actionId?: string;
  authSource?: SignedActionEnvelope["authSource"];
  playerSignature?: string;
}

export interface SignedActionEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  actionId: string;
  type: PlayerActionType;
  roomId: string;
  sessionId?: string;
  roundId?: string;
  actor: Player;
  payload: TPayload;
  nonce: string;
  expiresAt: string;
  signature?: string;
  authSource: "debox" | "wallet" | "mock";
}

export interface JoinRoomPayload extends Record<string, unknown> {
  player: Player;
  intendedLock: number;
}

export interface ReadyRoomPayload extends Record<string, unknown> {
  playerId: string;
  ready: boolean;
  intendedLock: number;
  playerReadyNonce: string;
}

export type PlayerFundingStatus = "unconfirmed" | "confirmed" | "failed";

export interface PlayerFundingSnapshot {
  status: PlayerFundingStatus;
  amount: number;
  playerAddress: string;
  escrowAddress?: string;
  txHash?: string;
  confirmedAt?: string;
  updatedAt: string;
}

export interface ConfirmPlayerFundingPayload extends Record<string, unknown> {
  playerId: string;
  txHash?: string;
  intendedLock: number;
}

export interface BidRoundPayload extends Record<string, unknown> {
  playerId: string;
  bidScore: BidScore | null;
}

export interface PlayCardsPayload extends Record<string, unknown> {
  playerId: string;
  turnId: string;
  cardIds: string[];
}

export interface PassTurnPayload extends Record<string, unknown> {
  playerId: string;
  turnId: string;
}

export interface ExitRoomPayload extends Record<string, unknown> {
  playerId: string;
  requestedAt: string;
}

export interface KickPlayerPayload extends Record<string, unknown> {
  ownerId: string;
  targetPlayerId: string;
  reason?: string;
}

export interface SettlementChoicePayload extends Record<string, unknown> {
  playerId: string;
  route: SettlementRoute;
}

export interface ChatMessagePayload extends Record<string, unknown> {
  playerId: string;
  message: string;
}

export interface ConfigureRoomPayload extends Record<string, unknown> {
  ownerId: string;
  stakePresetId: StakePreset["id"];
  baseStake: number;
  minimumLock: number;
}

export interface SettlementChoiceSnapshot {
  sessionId: string;
  playerId: string;
  route: SettlementRoute;
  locked: boolean;
  reason: "player_choice" | "exit_default" | "kick_default" | "disconnect_default" | "system_default";
  selectedBy: string;
  updatedAt: string;
}

export interface PlayerRoomNotice {
  id: string;
  playerId: string;
  playerAddress?: string;
  type:
    | "active_room_blocked"
    | "funding_confirmed"
    | "exit_requested"
    | "exited"
    | "kicked"
    | "round_balance_changed"
    | "session_lock_pending"
    | "session_lock_confirmed"
    | "settlement_queued"
    | "settlement_confirmed"
    | "room_config_updated"
    | "manual_review";
  title: string;
  message: string;
  supportContact?: SupportContact;
  expectedArrivalMinutes?: number;
  settlementId?: string;
  releaseId?: string;
  escrowAddress?: string;
  createdAt: string;
}

export interface PlayerInboxNotice {
  id: string;
  roomId: string;
  roomTitle: string;
  playerId: string;
  type: PlayerRoomNotice["type"];
  title: string;
  message: string;
  supportContact?: SupportContact;
  expectedArrivalMinutes?: number;
  releaseId?: string;
  escrowAddress?: string;
  createdAt: string;
}

export interface RoomChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  playerAvatarUrl?: string;
  message: string;
  createdAt: string;
}

export interface SessionLockSnapshot {
  status: "queued" | "submitted" | "confirmed" | "manual_review";
  txHash?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

export interface SessionLockTopUpSnapshot {
  id: string;
  playerId: string;
  playerAddress: string;
  amount: number;
  targetLockedBalance: number;
  status: "queued" | "retrying" | "submitted" | "confirmed" | "manual_review";
  fundingTxHash?: string;
  txHash?: string;
  attempts?: number;
  maxAttempts?: number;
  nextRetryAt?: string;
  lastError?: string;
  lastErrorCategory?: SettlementJobSnapshot["lastErrorCategory"];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  confirmedAt?: string;
  receiptBlockNumber?: number;
}

export interface SessionSnapshot {
  id: string;
  status: SessionStatus;
  asset: AssetSymbol;
  stakePresetId: StakePreset["id"];
  baseStake?: number;
  feeConfig: FeeConfig;
  playerIds: [string, string, string];
  playerAddresses?: Record<string, string>;
  lockedBalances: Record<string, number>;
  startingBalances: Record<string, number>;
  roundIds: string[];
  lock?: SessionLockSnapshot;
  lockTopUps?: SessionLockTopUpSnapshot[];
  settlementId?: string;
  transcriptHead: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoundBid {
  playerId: string;
  bidScore: BidScore | null;
  createdAt: string;
}

export interface RoundCardSnapshot {
  id: string;
  rank: string;
  suit?: string;
  label: string;
  value: number;
}

export interface RoundActiveMoveSnapshot {
  playerId: string;
  turnId: string;
  cardIds: string[];
  cards: RoundCardSnapshot[];
  handKind: string;
  mainValue: number;
  length: number;
}

export interface RoundMoveSnapshot {
  turnId: string;
  kind: "play" | "pass" | "trustee";
  playerId: string;
  cardIds: string[];
  cards?: RoundCardSnapshot[];
  handKind?: string;
  multiplierAfter: number;
  passStreakAfter: number;
  createdAt: string;
}

export interface RoundResultSnapshot {
  winnerSide: WinnerSide;
  winnerPlayerId: string;
  landlordId: string;
  bidScore: BidScore;
  multiplier: number;
  balanceDeltas: Record<string, number>;
  finalBalances: Record<string, number>;
  completedAt: string;
}

export interface RoundPlayStateSnapshot {
  seatOrder: [string, string, string];
  landlordId: string;
  bidScore: BidScore;
  baseStake: number;
  asset: AssetSymbol;
  hands: Record<string, RoundCardSnapshot[]>;
  handCounts: Record<string, number>;
  tableBalances: Record<string, number>;
  bottomCards: RoundCardSnapshot[];
  currentTurnPlayerId: string;
  turnId: string;
  activeMove?: RoundActiveMoveSnapshot;
  passStreak: number;
  moves: RoundMoveSnapshot[];
  exitAfterRoundPlayerIds: string[];
  result?: RoundResultSnapshot;
}

export interface RoundSnapshot {
  id: string;
  sessionId: string;
  status: RoundStatus;
  roundNumber: number;
  serverCommitment: string;
  serverNonce?: string;
  playerReadyNonces: Record<string, string>;
  firstBidderSeat?: number;
  bids: RoundBid[];
  biddingHands?: Record<string, RoundCardSnapshot[]>;
  biddingHandCounts?: Record<string, number>;
  landlordId?: string;
  bidScore?: BidScore;
  multiplier: number;
  playState?: RoundPlayStateSnapshot;
  transcriptHead: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoundServerCommitmentSnapshot {
  commitment: string;
  committedAt: string;
  roundNumber: number;
  transcriptHead: string;
}

export interface SettlementJobSnapshot {
  id: string;
  roomId: string;
  sessionId: string;
  status: SettlementJobStatus;
  expectedAsset: AssetSymbol;
  finalBalances: Record<string, number>;
  fees: Record<string, number>;
  settlementChoices?: Record<string, SettlementRoute>;
  settlementNonce?: string;
  transcriptHash: string;
  txHash?: string;
  attempts?: number;
  maxAttempts?: number;
  nextRetryAt?: string;
  lastError?: string;
  lastErrorCategory?: "rpc" | "gas" | "nonce" | "pending" | "revert" | "reconciliation" | "missing_evidence" | "unknown";
  supportContact: SupportContact;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableBalanceReleaseSnapshot {
  id: string;
  roomId: string;
  playerId: string;
  playerAddress: string;
  amount: number;
  escrowAddress?: string;
  fundingTxHash?: string;
  status: AvailableBalanceReleaseStatus;
  txHash?: string;
  attempts?: number;
  maxAttempts?: number;
  nextRetryAt?: string;
  lastError?: string;
  lastErrorCategory?: SettlementJobSnapshot["lastErrorCategory"];
  submittedAt?: string;
  confirmedAt?: string;
  receiptBlockNumber?: number;
  supportContact: SupportContact;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuditLogEntry {
  id: string;
  actorId: string;
  actorRole?: AdminRole;
  action: string;
  targetId: string;
  reason: string;
  beforeState: string;
  afterState: string;
  createdAt: string;
}

export interface RoomSnapshot {
  id: string;
  owner: Player;
  status: RoomStatus;
  config: RoomConfig;
  seats: [RoomSeat, RoomSeat, RoomSeat];
  nextRoundServerCommitment?: RoundServerCommitmentSnapshot;
  nextRoundServerNonce?: string;
  currentSession?: SessionSnapshot;
  currentRound?: RoundSnapshot;
  sessionHistory?: SessionSnapshot[];
  roundHistory?: RoundSnapshot[];
  settlementJob?: SettlementJobSnapshot;
  settlementHistory?: SettlementJobSnapshot[];
  availableBalanceReleases?: AvailableBalanceReleaseSnapshot[];
  settlementChoices?: Record<string, SettlementChoiceSnapshot>;
  playerNotices?: PlayerRoomNotice[];
  chatMessages?: RoomChatMessage[];
  adminAuditLog?: AdminAuditLogEntry[];
  transcript: TranscriptEvent[];
  createdAt: string;
  updatedAt: string;
  shareUrl: string;
  supportContact: SupportContact;
}

export type RoomViewMode = "public" | "player" | "admin";

export interface RoomViewContext {
  mode: RoomViewMode;
  viewerId?: string;
}

export type AdminSupportRiskFlag =
  | "settlement_pending"
  | "settlement_retrying"
  | "manual_review"
  | "system_exception"
  | "relayer_error"
  | "missing_tx_hash";
export type AdminRole = "support" | "relayer_operator" | "owner";

export interface AdminSupportRoomSummary {
  id: string;
  ownerName: string;
  status: RoomStatus;
  occupiedSeats: number;
  sessionId?: string;
  roundId?: string;
  settlementId?: string;
  settlementStatus?: SettlementJobStatus;
  settlementAttempts?: number;
  settlementLastError?: string;
  settlementUpdatedAt?: string;
  supportContact: SupportContact;
  updatedAt: string;
  riskFlags: AdminSupportRiskFlag[];
}

export interface AdminSupportRoomDetail {
  room: RoomSnapshot;
  summary: AdminSupportRoomSummary;
  evidence: {
    transcriptEvents: number;
    auditEntries: number;
    currentTranscriptHash?: string;
    currentSessionStatus?: SessionStatus;
    currentRoundStatus?: RoundStatus;
    playerBalances: Record<string, number>;
  };
}

export interface AdminSupportStatus {
  tokenConfigured: boolean;
  availableRoles: AdminRole[];
  rooms: number;
  lockingRooms: number;
  activeRooms: number;
  settlingRooms: number;
  manualReviewRooms: number;
  systemExceptionRooms: number;
  retryingSettlements: number;
}

export interface OperationsSettlementStatus {
  queued: number;
  retrying: number;
  submitted: number;
  confirmed: number;
  manualReview: number;
  delayed: number;
  oldestDelayedSettlementAt?: string;
  oldestSettlementAgeSeconds?: number;
  failureCategories: Record<string, number>;
}

export interface OperationsAvailableBalanceReleaseStatus {
  queued: number;
  retrying: number;
  submitted: number;
  pending: number;
  confirmed: number;
  manualReview: number;
  delayed: number;
  oldestDelayedReleaseAt?: string;
  oldestReleaseAgeSeconds?: number;
  failureCategories: Record<string, number>;
}

export interface OperationsRelayerHealthStatus {
  configured: boolean;
  ok: boolean;
  rpcUrlLabel?: string;
  rpcProviderLabels?: string[];
  gasBalanceWei?: string;
  minGasBalanceWei?: string;
  reason?: string;
  checkedAt?: string;
}

export interface OperationsStatus {
  generatedAt: string;
  settlementWindowSeconds: number;
  rooms: {
    total: number;
    locking: number;
    active: number;
    settling: number;
    manualReview: number;
    systemException: number;
  };
  settlements: OperationsSettlementStatus;
  availableBalanceReleases: OperationsAvailableBalanceReleaseStatus;
  relayerRuntime: {
    enabled: boolean;
    running: boolean;
    inFlight: boolean;
    pollIntervalMs: number;
    batchSize: number;
    tickCount: number;
    skippedTicks: number;
    lastError?: string;
  };
  relayerHealth: OperationsRelayerHealthStatus;
  secretsRedacted: true;
}

export interface AdminManualReviewInput {
  reason: string;
}

export interface AdminSupportNoteInput {
  reason: string;
}

export interface AdminResolveSystemExceptionInput {
  resolution: "return_to_waiting" | "settle";
  reason: string;
}

export interface LobbyRoomSummary {
  id: string;
  ownerName: string;
  ownerAvatarUrl?: string;
  status: RoomStatus;
  visibility: RoomVisibility;
  asset: AssetSymbol;
  stakePresetId: StakePreset["id"];
  baseStake?: number;
  stakePresetLabel: string;
  minimumLock: number;
  occupiedSeats: number;
  totalSeats: 3;
  multiplierCap: typeof ROUND_MULTIPLIER_CAP;
  feeRateLabel: string;
  shareUrl: string;
  viewerInRoom?: boolean;
}

export interface CreateRoomInput extends Record<string, unknown> {
  owner: Player;
  stakePresetId: StakePreset["id"];
  baseStake?: number;
  minimumLock: number;
  visibility: RoomVisibility;
}

export type JoinRoomInput = JoinRoomPayload;

export type ReadyRoomInput = ReadyRoomPayload;

export interface StartRoundInput {
  requestedByPlayerId: string;
}

export type BidRoundInput = BidRoundPayload;

export type CreateRoomAction = SignedActionEnvelope<CreateRoomInput>;
export type ConfigureRoomAction = SignedActionEnvelope<ConfigureRoomPayload>;
export type JoinRoomAction = SignedActionEnvelope<JoinRoomPayload>;
export type ReadyRoomAction = SignedActionEnvelope<ReadyRoomPayload>;
export type ChatMessageAction = SignedActionEnvelope<ChatMessagePayload>;
export type BidRoundAction = SignedActionEnvelope<BidRoundPayload>;
export type PlayCardsAction = SignedActionEnvelope<PlayCardsPayload>;
export type PassTurnAction = SignedActionEnvelope<PassTurnPayload>;
export type ExitRoomAction = SignedActionEnvelope<ExitRoomPayload>;
export type KickPlayerAction = SignedActionEnvelope<KickPlayerPayload>;
export type SettlementChoiceAction = SignedActionEnvelope<SettlementChoicePayload>;

export * from "./addressPolicy.js";
export * from "./roomPolicy.js";
