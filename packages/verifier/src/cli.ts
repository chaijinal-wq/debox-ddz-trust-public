#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyTrustBundle } from "./index.js";

function usage(): string {
  return [
    "Usage: debox-ddz-verify <public-trust-bundle.json>",
    "",
    "Verifies transcript hash chain, shuffle commitment, canonical deal evidence, and settlement conservation.",
  ].join("\n");
}

function formatStatus(status: string): string {
  if (status === "ok") return "OK";
  if (status === "failed") return "FAIL";
  return "SKIP";
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath || filePath === "--help" || filePath === "-h") {
    console.log(usage());
    process.exitCode = filePath ? 0 : 2;
    return;
  }

  const raw = await readFile(filePath, "utf8");
  const input = JSON.parse(raw) as unknown;
  const report = await verifyTrustBundle(input);

  for (const check of report.checks) {
    console.log(`[${formatStatus(check.status)}] ${check.id}: ${check.message}`);
  }
  if (report.finalTranscriptHash) {
    console.log(`finalTranscriptHash=${report.finalTranscriptHash}`);
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Verifier failed: ${message}`);
  process.exitCode = 1;
});
