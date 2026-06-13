import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBlock } from "@ethereumjs/block";
import { createCustomCommon, Hardfork, Mainnet } from "@ethereumjs/common";
import { createLegacyTx } from "@ethereumjs/tx";
import { createAccount, createAddressFromPrivateKey, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { createVM, runTx } from "@ethereumjs/vm";
import solc from "solc";
import {
  decodeErrorResult,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toBytes,
  toHex,
} from "viem";

export const BOX_TOKEN = "0x6386Adc4BC9c21984E34fD916BB349dD861742af";
export const INITIAL_FEE_RATE_BPS = 10n;

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const escrowRoot = path.resolve(helperDir, "../..");
const chainId = 1337;
const gasPrice = 10n;
const blockBaseFee = 7n;
const blockGasLimit = 30_000_000n;

const actorPrivateKeys = {
  owner: `0x${"11".repeat(32)}`,
  relayer: `0x${"22".repeat(32)}`,
  treasury: `0x${"33".repeat(32)}`,
  p1: `0x${"44".repeat(32)}`,
  p2: `0x${"55".repeat(32)}`,
  p3: `0x${"66".repeat(32)}`,
  p4: `0x${"77".repeat(32)}`,
  p5: `0x${"88".repeat(32)}`,
  p6: `0x${"99".repeat(32)}`,
  outsider: `0x${"aa".repeat(32)}`,
};

export function bytes32(label) {
  return keccak256(toBytes(label));
}

function createContractCodec(abi) {
  function normalizeDecoded(value) {
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (Array.isArray(value)) return value.map((entry) => normalizeDecoded(entry));
    return value;
  }

  return {
    abi,
    encodeFunctionData(functionName, args = []) {
      return encodeFunctionData({ abi, functionName, args });
    },
    decodeFunctionResult(functionName, data) {
      const decoded = decodeFunctionResult({ abi, functionName, data });
      const normalized = normalizeDecoded(decoded);
      return Array.isArray(normalized) ? normalized : [normalized];
    },
    parseError(data) {
      const decoded = decodeErrorResult({ abi, data });
      return { name: decoded.errorName, args: decoded.args };
    },
  };
}

function compileOutput() {
  return {
    language: "Solidity",
    sources: {
      "DdzEscrowRoom.sol": {
        content: undefined,
      },
      "test/fixtures/MockBoxToken.sol": {
        content: undefined,
      },
    },
    settings: {
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
}

export async function compileContracts() {
  const input = compileOutput();
  input.sources["DdzEscrowRoom.sol"].content = await readFile(path.join(escrowRoot, "DdzEscrowRoom.sol"), "utf8");
  input.sources["test/fixtures/MockBoxToken.sol"].content = await readFile(
    path.join(escrowRoot, "test/fixtures/MockBoxToken.sol"),
    "utf8",
  );

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const diagnostics = output.errors ?? [];
  const fatal = diagnostics.filter((error) => error.severity === "error");
  if (fatal.length > 0) {
    throw new Error(fatal.map((error) => error.formattedMessage).join("\n"));
  }

  return {
    escrow: output.contracts["DdzEscrowRoom.sol"].DdzEscrowRoom,
    box: output.contracts["test/fixtures/MockBoxToken.sol"].MockBoxToken,
  };
}

class EvmRevertError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "EvmRevertError";
    this.result = result;
  }
}

function makeActors() {
  return Object.fromEntries(
    Object.entries(actorPrivateKeys).map(([name, privateKeyHex]) => {
      const privateKey = hexToBytes(privateKeyHex);
      const addressObject = createAddressFromPrivateKey(privateKey);
      return [
        name,
        {
          name,
          privateKey,
          addressObject,
          address: addressObject.toString(),
        },
      ];
    }),
  );
}

function toAddressObject(address) {
  return createAddressFromString(address.toString());
}

function txDataToBytes(data) {
  return hexToBytes(data ?? "0x");
}

function normalizeBytecode(bytecode) {
  return bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`;
}

export async function createEscrowHarness({ feeRateMaxBps = 100n } = {}) {
  const compiled = await compileContracts();
  const common = createCustomCommon(
    { chainId, networkId: chainId },
    Mainnet,
    { hardfork: Hardfork.Shanghai },
  );
  const vm = await createVM({ common });
  const actors = makeActors();
  let timestamp = 1_700_000_000n;

  for (const actor of Object.values(actors)) {
    await vm.stateManager.putAccount(actor.addressObject, createAccount({ nonce: 0n, balance: 10n ** 24n }));
  }

  const boxAddress = createAddressFromString(BOX_TOKEN);
  await vm.stateManager.putAccount(boxAddress, createAccount({ nonce: 1n, balance: 0n }));
  await vm.stateManager.putCode(boxAddress, txDataToBytes(normalizeBytecode(compiled.box.evm.deployedBytecode.object)));

  const box = {
    address: BOX_TOKEN,
    addressObject: boxAddress,
    interface: createContractCodec(compiled.box.abi),
  };
  const escrowInterface = createContractCodec(compiled.escrow.abi);

  function currentBlock() {
    return createBlock(
      {
        header: {
          timestamp,
          baseFeePerGas: blockBaseFee,
          gasLimit: blockGasLimit,
        },
      },
      { common },
    );
  }

  function decodeRevert(returnValue) {
    const data = toHex(returnValue);
    if (data === "0x") return "empty revert";
    for (const contractInterface of [escrowInterface, box.interface]) {
      try {
        const parsed = contractInterface.parseError(data);
        if (parsed) return parsed.name;
      } catch {
        // Try the next interface.
      }
    }
    return data;
  }

  async function sendTransaction(signerName, { to, data, value = 0n }) {
    const signer = actors[signerName];
    if (!signer) throw new Error(`Unknown signer: ${signerName}`);
    const account = await vm.stateManager.getAccount(signer.addressObject);
    const txInput = {
      nonce: account?.nonce ?? 0n,
      gasLimit: 20_000_000n,
      gasPrice,
      value,
      data: txDataToBytes(data),
    };
    if (to) txInput.to = toAddressObject(to);

    const tx = createLegacyTx(txInput, { common }).sign(signer.privateKey);
    const result = await runTx(vm, { tx, block: currentBlock() });
    const exception = result.execResult.exceptionError;
    if (exception) {
      throw new EvmRevertError(
        `EVM reverted: ${exception.error}; decoded=${decodeRevert(result.execResult.returnValue)}`,
        result,
      );
    }
    result.txHash = toHex(tx.hash());
    return result;
  }

  async function deployEscrow() {
    const constructorArgs = encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
      ],
      [actors.relayer.address, actors.treasury.address, feeRateMaxBps],
    );
    const data = `${normalizeBytecode(compiled.escrow.evm.bytecode.object)}${constructorArgs.slice(2)}`;
    const result = await sendTransaction("owner", { data });
    assert.ok(result.createdAddress, "escrow deployment should create a contract address");
    return {
      address: result.createdAddress.toString(),
      addressObject: result.createdAddress,
      interface: escrowInterface,
    };
  }

  const escrow = await deployEscrow();

  async function read(contract, fn, args = [], from = "owner") {
    const caller = actors[from]?.addressObject ?? createAddressFromString(from);
    const result = await vm.evm.runCall({
      caller,
      to: contract.addressObject ?? createAddressFromString(contract.address),
      data: txDataToBytes(contract.interface.encodeFunctionData(fn, args)),
      gasLimit: 10_000_000n,
      block: currentBlock(),
    });
    const exception = result.execResult.exceptionError;
    if (exception) {
      throw new EvmRevertError(
        `EVM call reverted: ${exception.error}; decoded=${decodeRevert(result.execResult.returnValue)}`,
        result,
      );
    }
    return contract.interface.decodeFunctionResult(fn, toHex(result.execResult.returnValue));
  }

  async function write(contract, signerName, fn, args = []) {
    return sendTransaction(signerName, {
      to: contract.address,
      data: contract.interface.encodeFunctionData(fn, args),
    });
  }

  async function expectRevert(action, label = "transaction") {
    try {
      await action();
    } catch (error) {
      if (error instanceof EvmRevertError || /EVM (call )?reverted/.test(error.message)) {
        return error;
      }
      throw error;
    }
    assert.fail(`Expected ${label} to revert`);
  }

  function addressOf(actorName) {
    const actor = actors[actorName];
    if (!actor) throw new Error(`Unknown actor: ${actorName}`);
    return actor.address;
  }

  function addressesOf(actorNames) {
    return actorNames.map((actorName) => addressOf(actorName));
  }

  async function scalar(contract, fn, args = [], from = "owner") {
    const result = await read(contract, fn, args, from);
    return result[0];
  }

  async function mintApproveDeposit(actorName, amount) {
    await write(box, "owner", "mint", [addressOf(actorName), amount]);
    await write(box, actorName, "approve", [escrow.address, amount]);
    await write(escrow, actorName, "deposit", [amount]);
  }

  return {
    actors,
    box,
    escrow,
    vm,
    read,
    write,
    scalar,
    expectRevert,
    addressOf,
    addressesOf,
    mintApproveDeposit,
    setTimestamp(nextTimestamp) {
      timestamp = BigInt(nextTimestamp);
    },
    increaseTime(seconds) {
      timestamp += BigInt(seconds);
    },
    get timestamp() {
      return timestamp;
    },
    async available(actorName) {
      return scalar(escrow, "availableBalance", [addressOf(actorName)]);
    },
    async pending(actorName) {
      return scalar(escrow, "pendingWithdrawal", [addressOf(actorName)]);
    },
    async activeSessionOf(actorName) {
      return scalar(escrow, "activeSessionOf", [addressOf(actorName)]);
    },
    async boxBalance(addressOrActorName) {
      const address = actors[addressOrActorName]?.address ?? addressOrActorName;
      return scalar(box, "balanceOf", [address]);
    },
  };
}
