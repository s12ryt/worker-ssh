#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DEPLOYMENT_NAMES,
  cleanupDeploymentFiles,
  prepareDeployment,
} from "./cloudflare-deploy-lib.mjs";

const outputDir = resolve(process.cwd(), ".cloudflare-deploy");

function usage() {
  process.stdout.write(`Cloudflare deployment helper

Usage:
  node scripts/cloudflare-deploy.mjs prepare
  node scripts/cloudflare-deploy.mjs cleanup
  node scripts/cloudflare-deploy.mjs --help

prepare  Reuse or create the production D1/KV resources and write temporary deploy files.
cleanup  Remove temporary deploy configuration and secret files.
`);
}

async function writeGitHubSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(
    summaryPath,
    [
      "### Cloudflare resources prepared",
      "",
      `- D1 \`${DEPLOYMENT_NAMES.d1}\`: ${result.d1Action}`,
      `- KV \`${DEPLOYMENT_NAMES.kv}\`: ${result.kvAction}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function main() {
  const command = process.argv[2] ?? "--help";
  if (command === "--help" || command === "-h" || command === "help") {
    usage();
    return;
  }
  if (command === "cleanup") {
    await cleanupDeploymentFiles(outputDir);
    process.stdout.write("Temporary Cloudflare deployment files removed.\n");
    return;
  }
  if (command !== "prepare") {
    usage();
    throw new Error(`Unknown deployment command: ${command}`);
  }

  const result = await prepareDeployment({ env: process.env, outputDir });
  process.stdout.write(
    [
      "Cloudflare deployment files prepared.",
      `D1 ${DEPLOYMENT_NAMES.d1}: ${result.d1Action}`,
      `KV ${DEPLOYMENT_NAMES.kv}: ${result.kvAction}`,
      "",
    ].join("\n"),
  );
  await writeGitHubSummary(result);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Deployment preparation failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
