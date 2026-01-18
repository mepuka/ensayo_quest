/**
 * Production build script for web workers.
 *
 * Builds ASR worker and AudioWorklet processor to public/workers/
 * so Vite copies them to dist/ during production build.
 *
 * @see docs/plans/2026-01-18-voice-stack-remediation.md - Phase 4
 * @see ensayo_quest-yjj: Phase 4 - Production build script
 */
import { join } from "node:path";
import { resolveAsrShimPath } from "../asr/worker/workerBuild";

const WORKERS_DIR = join(import.meta.dirname, "../public/workers");

const builtinShims = {
  fs: resolveAsrShimPath("fs"),
  path: resolveAsrShimPath("path"),
  url: resolveAsrShimPath("url")
} as const;

console.log("Building workers to public/workers/...");

// Build ASR worker with shims
const workerBuild = await Bun.build({
  entrypoints: [join(import.meta.dirname, "../asr/worker/asrWorker.ts")],
  outdir: WORKERS_DIR,
  target: "browser",
  plugins: [
    {
      name: "asr-worker-shims",
      setup(build) {
        build.onResolve({ filter: /^(node:)?(fs|path|url)$/ }, (args) => {
          const name = args.path.replace("node:", "") as keyof typeof builtinShims;
          return { path: builtinShims[name] };
        });
      }
    }
  ]
});

if (!workerBuild.success) {
  console.error("Failed to build ASR worker.");
  for (const log of workerBuild.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

// Build AudioWorklet processor
const workletBuild = await Bun.build({
  entrypoints: [join(import.meta.dirname, "../asr/worklet/audioProcessor.ts")],
  outdir: WORKERS_DIR,
  target: "browser"
});

if (!workletBuild.success) {
  console.error("Failed to build AudioWorklet.");
  for (const log of workletBuild.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

console.log("Workers built successfully:");
console.log("  - public/workers/asrWorker.js");
console.log("  - public/workers/audioProcessor.js");
