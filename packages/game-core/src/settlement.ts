import { ROUND_MULTIPLIER_CAP, type AssetSymbol, type BidScore, type PlayerStake, type WinnerSide } from "@debox-ddz/protocol";

export interface SettlementInput {
  asset: AssetSymbol;
  players: [PlayerStake, PlayerStake, PlayerStake];
  landlordId: string;
  winnerSide: WinnerSide;
  baseStake: number;
  bidScore: BidScore;
  multiplier: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementResult {
  asset: AssetSymbol;
  unit: number;
  totalLocked: number;
  transfers: Transfer[];
  payouts: Record<string, number>;
}

interface Claim extends Transfer {
  claimOrder: number;
}

function assertWholeAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer amount.`);
  }
}

function allocateClaimsForDebtor(claims: Claim[], available: number): Transfer[] {
  const totalClaimed = claims.reduce((sum, claim) => sum + claim.amount, 0);
  if (totalClaimed <= available) {
    return claims.map(({ from, to, amount }) => ({ from, to, amount }));
  }

  const rough = claims.map((claim) => {
    const exactNumerator = available * claim.amount;
    return {
      claim,
      amount: Math.floor(exactNumerator / totalClaimed),
      remainder: exactNumerator % totalClaimed,
    };
  });

  let remaining = available - rough.reduce((sum, item) => sum + item.amount, 0);
  rough
    .sort((a, b) => b.remainder - a.remainder || a.claim.claimOrder - b.claim.claimOrder)
    .forEach((item) => {
      if (remaining > 0) {
        item.amount += 1;
        remaining -= 1;
      }
    });

  return rough
    .sort((a, b) => a.claim.claimOrder - b.claim.claimOrder)
    .map(({ claim, amount }) => ({ from: claim.from, to: claim.to, amount }))
    .filter((transfer) => transfer.amount > 0);
}

function allocateClaimsForCreditor(claims: Claim[], available: number): Transfer[] {
  return allocateClaimsForDebtor(
    claims.map((claim) => ({
      from: claim.to,
      to: claim.from,
      amount: claim.amount,
      claimOrder: claim.claimOrder,
    })),
    available,
  ).map((transfer) => ({ from: transfer.to, to: transfer.from, amount: transfer.amount }));
}

export function settleRoom(input: SettlementInput): SettlementResult {
  const { asset, players, landlordId, winnerSide, baseStake, bidScore, multiplier } = input;
  assertWholeAmount(baseStake, "baseStake");
  assertWholeAmount(multiplier, "multiplier");

  if (bidScore !== 1 && bidScore !== 2 && bidScore !== 3) {
    throw new Error("bidScore must be 1, 2, or 3.");
  }

  if (multiplier <= 0) {
    throw new Error("multiplier must be greater than zero.");
  }

  if (multiplier > ROUND_MULTIPLIER_CAP) {
    throw new Error(`multiplier must not exceed ${ROUND_MULTIPLIER_CAP}.`);
  }

  const landlord = players.find((player) => player.id === landlordId);
  if (!landlord) {
    throw new Error("landlordId must match one of the players.");
  }

  for (const player of players) {
    assertWholeAmount(player.cap, `${player.name} cap`);
  }

  const unit = baseStake * bidScore * multiplier;
  const farmers = players.filter((player) => player.id !== landlordId);
  const rawClaims: Claim[] =
    winnerSide === "landlord"
      ? farmers.map((farmer, index) => ({
          from: farmer.id,
          to: landlord.id,
          amount: unit,
          claimOrder: index,
        }))
      : farmers.map((farmer, index) => ({
          from: landlord.id,
          to: farmer.id,
          amount: unit,
          claimOrder: index,
        }));

  const caps = Object.fromEntries(players.map((player) => [player.id, player.cap]));
  const claims =
    winnerSide === "landlord"
      ? rawClaims.map((claim) => ({
          ...claim,
          amount: Math.min(claim.amount, caps[claim.from] ?? 0),
        }))
      : rawClaims.map((claim) => ({
          ...claim,
          amount: Math.min(claim.amount, caps[claim.to] ?? 0),
        }));
  const transfers =
    winnerSide === "landlord"
      ? allocateClaimsForCreditor(claims, caps[landlord.id] ?? 0)
      : allocateClaimsForDebtor(claims, caps[landlord.id] ?? 0);

  const payouts = Object.fromEntries(players.map((player) => [player.id, player.cap]));
  for (const transfer of transfers) {
    payouts[transfer.from] -= transfer.amount;
    payouts[transfer.to] += transfer.amount;
  }

  return {
    asset,
    unit,
    totalLocked: players.reduce((sum, player) => sum + player.cap, 0),
    transfers,
    payouts,
  };
}

export function parseTokenAmountToMinorUnits(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) {
    throw new Error("Amount must have at most two decimal places in the prototype.");
  }

  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatMinorUnits(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const whole = Math.floor(absolute / 100);
  const cents = `${absolute % 100}`.padStart(2, "0");
  return `${sign}${whole}.${cents}`;
}
