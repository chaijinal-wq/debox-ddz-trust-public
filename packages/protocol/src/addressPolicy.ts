export interface AddressNormalizationOptions {
  trim?: boolean;
}

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function addressCandidate(value: unknown, options: AddressNormalizationOptions = {}): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = options.trim ? value.trim() : value;
  return candidate || undefined;
}

export function isEvmAddress(value: unknown, options: AddressNormalizationOptions = {}): value is `0x${string}` {
  const candidate = addressCandidate(value, options);
  return Boolean(candidate && EVM_ADDRESS_PATTERN.test(candidate));
}

export function normalizeAddress(
  value: unknown,
  options: AddressNormalizationOptions = {},
): `0x${string}` | undefined {
  const candidate = addressCandidate(value, options);
  if (!candidate || !EVM_ADDRESS_PATTERN.test(candidate)) return undefined;
  return candidate.toLowerCase() as `0x${string}`;
}

export function requireEvmAddress(
  value: unknown,
  label = "Address",
  options: AddressNormalizationOptions = {},
): `0x${string}` {
  const normalized = normalizeAddress(value, options);
  if (!normalized) {
    throw new Error(`${label} must be a valid EVM address.`);
  }
  return normalized;
}

export function sameAddress(left: unknown, right: unknown, options: AddressNormalizationOptions = {}): boolean {
  const normalizedLeft = normalizeAddress(left, options);
  const normalizedRight = normalizeAddress(right, options);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function normalizeAddressForComparison(
  value: unknown,
  options: AddressNormalizationOptions = { trim: true },
): string | undefined {
  const candidate = addressCandidate(value, options);
  return candidate?.toLowerCase();
}
