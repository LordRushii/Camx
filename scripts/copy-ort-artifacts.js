// Copies the onnxruntime-web .wasm/.mjs runtime artifacts into public/ort so
// the browser loads them from the app itself instead of a third-party CDN.
// Wired into postinstall (see package.json). If the artifacts are missing,
// in-browser YOLO inference fails silently and detection labels never render.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const targetDir = path.join(process.cwd(), "public", "ort");

function resolveOrtDist() {
  // require.resolve honors the package's "exports" map, which may not expose
  // package.json — fall back to a direct node_modules lookup.
  try {
    return path.join(path.dirname(require.resolve("onnxruntime-web/package.json")), "dist");
  } catch {
    const direct = path.join(process.cwd(), "node_modules", "onnxruntime-web", "dist");
    if (fs.existsSync(direct)) return direct;
    throw new Error("could not locate onnxruntime-web dist");
  }
}

function main() {
  let ortDist;
  try {
    ortDist = resolveOrtDist();
  } catch {
    console.warn("copy-ort-artifacts: onnxruntime-web not installed, skipping");
    return;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Only the artifacts ORT actually fetches at runtime (jsep build + fallbacks).
  const patterns = /^ort-wasm.*\.(wasm|mjs)$/;
  let copied = 0;
  for (const name of fs.readdirSync(ortDist)) {
    if (!patterns.test(name)) continue;
    fs.copyFileSync(path.join(ortDist, name), path.join(targetDir, name));
    copied++;
  }

  console.log(`copy-ort-artifacts: copied ${copied} files into public/ort`);
}

main();
