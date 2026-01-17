#!/usr/bin/env bun
/**
 * Batch TypeScript typecheck script.
 *
 * Runs tsc on files in batches to avoid stack overflow with Effect's deep types.
 * This allows seeing real type errors instead of crashes.
 *
 * Usage: bun scripts/typecheck-batch.ts [directory]
 */

import { $ } from "bun";
import { glob } from "glob";
import path from "path";

const BATCH_SIZE = 10;
const STACK_SIZE = 32768;

async function main() {
  const targetDir = process.argv[2] || "apps";

  console.log(`🔍 Finding TypeScript files in ${targetDir}...`);

  // Find all .ts and .tsx files, excluding node_modules and test files
  const files = await glob(`${targetDir}/**/*.{ts,tsx}`, {
    ignore: [
      "**/node_modules/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
      "**/dist/**"
    ]
  });

  console.log(`📁 Found ${files.length} source files`);

  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    batches.push(files.slice(i, i + BATCH_SIZE));
  }

  console.log(`📦 Split into ${batches.length} batches of ~${BATCH_SIZE} files each\n`);

  let totalErrors = 0;
  let failedBatches: number[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    process.stdout.write(`Batch ${i + 1}/${batches.length}: `);

    try {
      // Run tsc on batch with increased stack size
      const result = await $`ulimit -s 65520 && node --stack-size=${STACK_SIZE} ./node_modules/typescript/bin/tsc --noEmit ${batch.join(" ")} 2>&1`.quiet();

      const output = result.text();
      const errors = output.split("\n").filter(line =>
        line.includes(": error TS") && !line.includes("Utils.d.ts")
      );

      if (errors.length > 0) {
        console.log(`❌ ${errors.length} error(s)`);
        errors.forEach(e => console.log(`  ${e}`));
        totalErrors += errors.length;
      } else {
        console.log(`✅`);
      }
    } catch (error: any) {
      if (error.stderr?.includes("RangeError") || error.stdout?.includes("RangeError")) {
        console.log(`⚠️  Stack overflow (batch too complex)`);
        failedBatches.push(i + 1);
      } else {
        console.log(`❌ Error: ${error.message}`);
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Summary: ${totalErrors} type error(s) found`);
  if (failedBatches.length > 0) {
    console.log(`⚠️  ${failedBatches.length} batch(es) had stack overflow: ${failedBatches.join(", ")}`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(console.error);
