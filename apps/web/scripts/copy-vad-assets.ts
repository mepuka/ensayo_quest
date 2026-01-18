/**
 * Copy VAD and ONNX assets to public directory for serving in dev and prod.
 *
 * Run with: bun run apps/web/scripts/copy-vad-assets.ts
 */
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const DEST_VAD = resolve(import.meta.dirname, "../public/vad");
const DEST_ONNX = join(DEST_VAD, "onnx");

const VAD_SRC = join(ROOT, "node_modules/@ricky0123/vad-web/dist");
const ONNX_SRC = join(ROOT, "node_modules/onnxruntime-web/dist");

const VAD_FILES = [
  "vad.worklet.bundle.min.js",
  "silero_vad_legacy.onnx",
  "silero_vad_v5.onnx"
];

async function copyVadAssets() {
  // Ensure destination directories exist
  await mkdir(DEST_VAD, { recursive: true });
  await mkdir(DEST_ONNX, { recursive: true });

  // Copy VAD files
  console.log("Copying VAD assets...");
  for (const file of VAD_FILES) {
    const src = join(VAD_SRC, file);
    const dest = join(DEST_VAD, file);
    await copyFile(src, dest);
    console.log(`  ${file}`);
  }

  // Copy ONNX WASM and MJS files
  // Both .wasm binaries and .mjs module loaders are required for ONNX runtime
  console.log("Copying ONNX WASM and MJS files...");
  const onnxFiles = await readdir(ONNX_SRC);
  const wasmFiles = onnxFiles.filter((f) => f.endsWith(".wasm"));
  const mjsFiles = onnxFiles.filter(
    (f) => f.startsWith("ort-wasm-simd-threaded") && f.endsWith(".mjs")
  );
  for (const file of [...wasmFiles, ...mjsFiles]) {
    const src = join(ONNX_SRC, file);
    const dest = join(DEST_ONNX, file);
    await copyFile(src, dest);
    console.log(`  ${file}`);
  }

  console.log(`\nDone! Assets copied to ${DEST_VAD}`);
}

copyVadAssets().catch((err) => {
  console.error("Failed to copy VAD assets:", err);
  process.exit(1);
});
