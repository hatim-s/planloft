// Builds the static gallery into a directory: `node --import tsx examples/gallery/build.ts <out-dir>`.
import path from "node:path";
import { buildGallery } from "../../src/gallery/index.js";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: node --import tsx examples/gallery/build.ts <out-dir>");
  process.exit(2);
}
const { indexPath } = await buildGallery({ outDir: path.resolve(outDir) });
console.log(indexPath);
