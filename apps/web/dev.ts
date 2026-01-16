import index from "./index.html";
import { resolveAsrShimPath } from "./asr/worker/workerBuild";

const builtinShims = {
  fs: resolveAsrShimPath("fs"),
  path: resolveAsrShimPath("path"),
  url: resolveAsrShimPath("url")
} as const;

const workerBuild = await Bun.build({
  entrypoints: ["./apps/web/asr/worker/asrWorker.ts"],
  outdir: "./apps/web/.dev",
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

const workletBuild = await Bun.build({
  entrypoints: ["./apps/web/asr/worklet/audioProcessor.ts"],
  outdir: "./apps/web/.dev",
  target: "browser"
});

if (!workletBuild.success) {
  console.error("Failed to build AudioWorklet.");
  for (const log of workletBuild.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

if (!workerBuild.success) {
  console.error("Failed to build ASR worker.");
  for (const log of workerBuild.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

const workerOutput = workerBuild.outputs.find((output) =>
  output.path.endsWith("/asrWorker.js")
);

if (!workerOutput) {
  console.error("ASR worker output not found.");
  process.exit(1);
}

const workletOutput = workletBuild.outputs.find((output) =>
  output.path.endsWith("/audioProcessor.js")
);

if (!workletOutput) {
  console.error("AudioWorklet output not found.");
  process.exit(1);
}

Bun.serve({
  routes: {
    "/": index,
    "/asrWorker.js": Bun.file(workerOutput.path),
    "/audioProcessor.js": Bun.file(workletOutput.path)
  },
  development: {
    hmr: true,
    console: true
  }
});
