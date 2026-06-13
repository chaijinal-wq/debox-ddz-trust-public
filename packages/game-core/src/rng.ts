import { counterClockwiseBidSeatIndex } from "@debox-ddz/protocol";
import { createDeck, dealDdz, type Card } from "./cards.js";

export type SeatIndex = 0 | 1 | 2;

export interface RoundSeedInput {
  roomId: string;
  sessionId: string;
  roundId: string;
  serverNonce: string;
  playerReadyNonces: [string, string, string];
}

export interface DdzRoundDealDerivation {
  roundSeed: string;
  shuffleSeed: string;
  firstBidderSeat: SeatIndex;
  deal: {
    players: [Card[], Card[], Card[]];
    bottom: Card[];
  };
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256HexSync(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = BigInt(bytes.length) * 8n;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  for (let i = 0; i < 8; i += 1) {
    padded[paddedLength - 1 - i] = Number((bitLength >> BigInt(i * 8)) & 0xffn);
  }

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    words.fill(0);
    for (let i = 0; i < 16; i += 1) {
      const offset = chunk + i * 4;
      words[i] =
        ((padded[offset] << 24) | (padded[offset + 1] << 16) | (padded[offset + 2] << 8) | padded[offset + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + words[i]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const next = (t + d) | 0;
    c = (c + next) | 0;
    return (next >>> 0) / 4294967296;
  };
}

export function createDeterministicRandom(seed: string): () => number {
  const seedHash = xmur3(seed);
  return sfc32(seedHash(), seedHash(), seedHash(), seedHash());
}

export function shuffleDeck<T extends Card>(deck: T[], seed: string): T[] {
  const random = createDeterministicRandom(seed);
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function drawUint32ByHash(seed: string, counter: number): number {
  const hash = sha256HexSync(`debox-ddz-random-v1|${seed}|${counter}`);
  return Number.parseInt(hash.slice(0, 8), 16);
}

function drawUniformIndexByHash(seed: string, counterRef: { value: number }, maxExclusive: number): number {
  const space = 0x1_0000_0000;
  const limit = Math.floor(space / maxExclusive) * maxExclusive;

  for (;;) {
    const value = drawUint32ByHash(seed, counterRef.value);
    counterRef.value += 1;
    if (value < limit) {
      return value % maxExclusive;
    }
  }
}

export function shuffleDeckByHashSync<T extends Card>(deck: T[], shuffleSeed: string): T[] {
  const shuffled = [...deck];
  const counterRef = { value: 0 };

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = drawUniformIndexByHash(shuffleSeed, counterRef, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

export async function shuffleDeckByHash<T extends Card>(deck: T[], shuffleSeed: string): Promise<T[]> {
  return shuffleDeckByHashSync(deck, shuffleSeed);
}

export async function sha256Hex(input: string): Promise<string> {
  return sha256HexSync(input);
}

export function combineRevealSeeds(roomId: string, seeds: string[]): string {
  return [roomId, ...seeds].join("|");
}

export async function createNonceCommitment(nonce: string): Promise<string> {
  return sha256Hex(`debox-ddz-nonce-commitment-v1|${nonce}`);
}

export async function deriveRoundSeed(input: RoundSeedInput): Promise<string> {
  return deriveRoundSeedSync(input);
}

export function deriveRoundSeedSync(input: RoundSeedInput): string {
  return sha256HexSync(
    JSON.stringify({
      domain: "debox-ddz-round-seed-v1",
      roomId: input.roomId,
      sessionId: input.sessionId,
      roundId: input.roundId,
      serverNonce: input.serverNonce,
      playerReadyNonces: input.playerReadyNonces,
    }),
  );
}

export async function deriveShuffleSeed(roundSeed: string): Promise<string> {
  return deriveShuffleSeedSync(roundSeed);
}

export function deriveShuffleSeedSync(roundSeed: string): string {
  return sha256HexSync(`debox-ddz-shuffle-v1|${roundSeed}`);
}

export async function deriveFirstBidderSeat(roundSeed: string): Promise<SeatIndex> {
  return deriveFirstBidderSeatSync(roundSeed);
}

export function deriveFirstBidderSeatSync(roundSeed: string): SeatIndex {
  const hash = sha256HexSync(`debox-ddz-first-bidder-v1|${roundSeed}`);
  return Number(BigInt(`0x${hash.slice(0, 16)}`) % 3n) as SeatIndex;
}

export function deriveDdzRoundDeal(input: RoundSeedInput): DdzRoundDealDerivation {
  const roundSeed = deriveRoundSeedSync(input);
  const shuffleSeed = deriveShuffleSeedSync(roundSeed);
  return {
    roundSeed,
    shuffleSeed,
    firstBidderSeat: deriveFirstBidderSeatSync(roundSeed),
    deal: dealDdz(shuffleDeckByHashSync(createDeck(), shuffleSeed)),
  };
}

export function bidSeatOrder(firstBidderSeat: SeatIndex): [SeatIndex, SeatIndex, SeatIndex] {
  return [0, 1, 2].map((offset) => counterClockwiseBidSeatIndex(firstBidderSeat, offset, 3)) as [
    SeatIndex,
    SeatIndex,
    SeatIndex,
  ];
}
