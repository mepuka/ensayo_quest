import index from "./index.html";
import { resolveAsrShimPath } from "./asr/worker/workerBuild";
import { join, resolve } from "node:path";
import { readdir } from "node:fs/promises";

const PUBLIC_VAD = resolve(import.meta.dirname, "public/vad");
const PUBLIC_VAD_ONNX = join(PUBLIC_VAD, "onnx");

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

// Build VAD routes dynamically from public/vad directory
const buildVadRoutes = async () => {
  const routes: Record<string, Response | ReturnType<typeof Bun.file>> = {};

  // VAD root files
  const vadFiles = await readdir(PUBLIC_VAD);
  for (const file of vadFiles) {
    if (file === "onnx") continue; // Skip onnx subdirectory
    routes[`/vad/${file}`] = Bun.file(join(PUBLIC_VAD, file));
  }

  // ONNX WASM files
  const onnxFiles = await readdir(PUBLIC_VAD_ONNX);
  for (const file of onnxFiles) {
    routes[`/vad/onnx/${file}`] = Bun.file(join(PUBLIC_VAD_ONNX, file));
  }

  return routes;
};

const vadRoutes = await buildVadRoutes();
console.log(`Serving ${Object.keys(vadRoutes).length} VAD assets`);

Bun.serve({
  routes: {
    "/": index,
    "/workers/asrWorker.js": Bun.file(workerOutput.path),
    "/workers/audioProcessor.js": Bun.file(workletOutput.path),
    ...vadRoutes
  },
  development: {
    hmr: true,
    console: true
  }
});
