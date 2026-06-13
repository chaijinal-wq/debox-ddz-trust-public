import {
  continuationMinimumLockForBaseStake,
  minimumLockForBaseStake,
  stakePresetForConfig,
  type AvailableBalanceReleaseSnapshot,
  type Player,
  type RoomSeat,
  type RoomSnapshot,
  type SessionLockTopUpSnapshot,
} from "./index.js";
import { normalizeAddressForComparison, sameAddress } from "./addressPolicy.js";

const ACTIVE_SESSION_LOCK_TOP_UP_STATUSES: ReadonlySet<SessionLockTopUpSnapshot["status"]> = new Set([
  "queued",
  "retrying",
  "submitted",
]);

export function normalizePolicyAddress(value: string | undefined): string | undefined {
  return normalizeAddressForComparison(value);
}

export function playerIdentityMatches(
  left: Pick<Player, "id" | "address"> | null | undefined,
  right: Pick<Player, "id" | "address"> | null | undefined,
): boolean {
  if (!left || !right) return false;
  if (left.id && right.id && left.id === right.id) return true;
  return sameAddress(left.address, right.address, { trim: true });
}

export function seatMatchesPlayer(seat: RoomSeat, player: Pick<Player, "id" | "address"> | null | undefined): boolean {
  return Boolean(seat.player && playerIdentityMatches(seat.player, player));
}

export function roomSeatForPlayer(
  room: RoomSnapshot | null | undefined,
  player: Pick<Player, "id" | "address"> | null | undefined,
): RoomSeat | null {
  if (!room || !player) return null;
  return room.seats.find((seat) => seatMatchesPlayer(seat, player)) ?? null;
}

export function roomHasPlayer(
  room: RoomSnapshot | null | undefined,
  player: Pick<Player, "id" | "address"> | null | undefined,
): boolean {
  return Boolean(roomSeatForPlayer(room, player));
}

export function roomPlayerIdForIdentity(
  room: RoomSnapshot | null | undefined,
  player: Pick<Player, "id" | "address"> | null | undefined,
): string | undefined {
  return roomSeatForPlayer(room, player)?.player?.id;
}

export function orderedRoomSeatsForPerspective(
  room: RoomSnapshot,
  currentSeat: RoomSeat | null | undefined,
): { self: RoomSeat; left: RoomSeat; right: RoomSeat } {
  if (room.seats.length < 1) {
    throw new Error("Room must include at least one seat.");
  }
  const selfIndex = currentSeat?.seatIndex ?? room.seats.findIndex((seat) => seat.player?.id === room.owner.id);
  const normalizedSelfIndex = selfIndex >= 0 ? selfIndex : 0;
  const seatAt = (offset: number): RoomSeat => room.seats[(normalizedSelfIndex + offset) % room.seats.length] ?? room.seats[0];
  return {
    self: seatAt(0),
    left: seatAt(1),
    right: seatAt(2),
  };
}

export function fundingMatchesEscrow(
  funding: RoomSeat["funding"],
  escrowAddress: string | undefined,
): boolean {
  const current = normalizePolicyAddress(escrowAddress);
  if (!current) return true;
  return normalizePolicyAddress(funding?.escrowAddress) === current;
}

export function releaseMatchesEscrow(
  release: AvailableBalanceReleaseSnapshot,
  escrowAddress: string | undefined,
): boolean {
  const current = normalizePolicyAddress(escrowAddress);
  if (!current) return true;
  return normalizePolicyAddress(release.escrowAddress) === current;
}

export function fundingConfirmedForSeat(
  seat: RoomSeat,
  intendedLock: number,
  escrowAddress?: string,
): boolean {
  const funding = seat.funding;
  return Boolean(
    seat.player &&
      funding?.status === "confirmed" &&
      funding.amount >= intendedLock &&
      fundingMatchesEscrow(funding, escrowAddress) &&
      sameAddress(funding.playerAddress, seat.player.address),
  );
}

export function roomStakePreset(room: RoomSnapshot) {
  return stakePresetForConfig(room.config);
}

export function roomRequiredLock(room: RoomSnapshot): number {
  return room.config.minimumLock;
}

export function roomEffectiveMinimumLock(
  room: RoomSnapshot,
  minimumLock = room.config.minimumLock,
): number {
  return Math.max(minimumLock, minimumLockForBaseStake(roomStakePreset(room).baseStake));
}

export function roomContinuationMinimumLock(room: RoomSnapshot): number {
  return continuationMinimumLockForBaseStake(roomStakePreset(room).baseStake);
}

export function roomAcceptsContinuationReady(room: RoomSnapshot): boolean {
  if (room.settlementJob?.status === "confirmed") return true;
  return Boolean(
    room.status === "active" &&
      room.currentSession?.status === "active" &&
      !room.settlementJob &&
      (room.currentRound?.status === "complete" || room.currentRound?.status === "void"),
  );
}

export function roomReadyRequiredLock(room: RoomSnapshot): number {
  return roomAcceptsContinuationReady(room) ? roomContinuationMinimumLock(room) : roomRequiredLock(room);
}

export function roomReadyMinimumLock(
  room: RoomSnapshot,
  minimumLock = room.config.minimumLock,
): number {
  return roomAcceptsContinuationReady(room) ? roomContinuationMinimumLock(room) : roomEffectiveMinimumLock(room, minimumLock);
}

export function roomAcceptsReady(room: RoomSnapshot): boolean {
  return room.status === "waiting" || roomAcceptsContinuationReady(room);
}

export function activeSessionTopUpNeedsWork(topUp: SessionLockTopUpSnapshot): boolean {
  return ACTIVE_SESSION_LOCK_TOP_UP_STATUSES.has(topUp.status);
}

export function roomPendingSessionLockTopUpForPlayer(
  room: RoomSnapshot,
  playerId: string,
): SessionLockTopUpSnapshot | undefined {
  return room.currentSession?.lockTopUps?.find(
    (topUp) => topUp.playerId === playerId && activeSessionTopUpNeedsWork(topUp),
  );
}

function seatRequiredLock(seat: RoomSeat, minimumLock: number): number {
  return Math.max(seat.intendedLock, minimumLock);
}

export function seatLockConfirmed(
  room: RoomSnapshot,
  seat: RoomSeat,
  minimumLock = room.config.minimumLock,
  escrowAddress?: string,
): boolean {
  if (!seat.player) return false;
  const effectiveMinimumLock = roomEffectiveMinimumLock(room, minimumLock);
  if (seat.funding) return fundingConfirmedForSeat(seat, seatRequiredLock(seat, effectiveMinimumLock), escrowAddress);
  return seat.tableBalance >= seatRequiredLock(seat, effectiveMinimumLock);
}

export function seatLockConfirmedForMode(
  room: RoomSnapshot,
  seat: RoomSeat,
  minimumLock: number,
  requireFundingSnapshot: boolean,
  escrowAddress?: string,
): boolean {
  if (!seat.player) return false;
  if (requireFundingSnapshot || seat.funding) {
    return fundingConfirmedForSeat(seat, seatRequiredLock(seat, minimumLock), escrowAddress);
  }
  return seat.tableBalance >= seatRequiredLock(seat, minimumLock);
}

export function seatLockConfirmedForViewer(
  room: RoomSnapshot,
  seat: RoomSeat,
  minimumLock: number,
  requireFundingSnapshot: boolean,
  viewerId: string | undefined,
  escrowAddress?: string,
): boolean {
  return seatLockConfirmedForMode(
    room,
    seat,
    minimumLock,
    requireFundingSnapshot && seat.player?.id === viewerId,
    escrowAddress,
  );
}

export function seatEffectivelyReady(
  room: RoomSnapshot,
  seat: RoomSeat,
  minimumLock = room.config.minimumLock,
  escrowAddress?: string,
): boolean {
  return Boolean(
    seat.player &&
      seat.ready &&
      !roomPendingSessionLockTopUpForPlayer(room, seat.player.id) &&
      seatLockConfirmed(room, seat, minimumLock, escrowAddress),
  );
}

export function seatEffectivelyReadyForMode(
  room: RoomSnapshot,
  seat: RoomSeat,
  minimumLock: number,
  requireFundingSnapshot: boolean,
  escrowAddress?: string,
): boolean {
  return Boolean(
    seat.player &&
      seat.ready &&
      !roomPendingSessionLockTopUpForPlayer(room, seat.player.id) &&
      seatLockConfirmedForMode(room, seat, minimumLock, requireFundingSnapshot, escrowAddress),
  );
}

export function seatEffectivelyReadyForViewer(
  room: RoomSnapshot,
  seat: RoomSeat,
  minimumLock: number,
  requireFundingSnapshot: boolean,
  viewerId: string | undefined,
  escrowAddress?: string,
): boolean {
  return Boolean(
    seat.player &&
      seat.ready &&
      !roomPendingSessionLockTopUpForPlayer(room, seat.player.id) &&
      seatLockConfirmedForViewer(room, seat, minimumLock, requireFundingSnapshot, viewerId, escrowAddress),
  );
}

export function seatReadyForCurrentRoom(
  room: RoomSnapshot,
  seat: RoomSeat,
  requireFunding: boolean,
  escrowAddress?: string,
): boolean {
  if (!seat.player || !seat.ready || seat.intendedLock < roomReadyRequiredLock(room)) return false;
  if (roomPendingSessionLockTopUpForPlayer(room, seat.player.id)) return false;
  return !requireFunding || fundingConfirmedForSeat(seat, seat.intendedLock, escrowAddress);
}

export function roomWaitingStats(
  room: RoomSnapshot,
  minimumLock = room.config.minimumLock,
  escrowAddress?: string,
): { seatedCount: number; missingPlayers: number; waitingReadyPlayers: number } {
  const seatedCount = room.seats.filter((seat) => seat.player).length;
  const missingPlayers = Math.max(room.seats.length - seatedCount, 0);
  const waitingReadyPlayers = room.seats.filter(
    (seat) => seat.player && !seatEffectivelyReady(room, seat, minimumLock, escrowAddress),
  ).length;
  return { seatedCount, missingPlayers, waitingReadyPlayers };
}

export function roomWaitingStatsForMode(
  room: RoomSnapshot,
  minimumLock: number,
  requireFundingSnapshot: boolean,
  escrowAddress?: string,
): { seatedCount: number; missingPlayers: number; waitingReadyPlayers: number } {
  const seatedCount = room.seats.filter((seat) => seat.player).length;
  const missingPlayers = Math.max(room.seats.length - seatedCount, 0);
  const waitingReadyPlayers = room.seats.filter(
    (seat) => seat.player && !seatEffectivelyReadyForMode(room, seat, minimumLock, requireFundingSnapshot, escrowAddress),
  ).length;
  return { seatedCount, missingPlayers, waitingReadyPlayers };
}

export function roomWaitingStatsForViewer(
  room: RoomSnapshot,
  minimumLock: number,
  requireFundingSnapshot: boolean,
  viewerId: string | undefined,
  escrowAddress?: string,
): { seatedCount: number; missingPlayers: number; waitingReadyPlayers: number } {
  const seatedCount = room.seats.filter((seat) => seat.player).length;
  const missingPlayers = Math.max(room.seats.length - seatedCount, 0);
  const waitingReadyPlayers = room.seats.filter(
    (seat) =>
      seat.player && !seatEffectivelyReadyForViewer(room, seat, minimumLock, requireFundingSnapshot, viewerId, escrowAddress),
  ).length;
  return { seatedCount, missingPlayers, waitingReadyPlayers };
}
