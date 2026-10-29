import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// An optional output directory keeps source probes away from the shared package build.
const outDir = resolve(process.argv[2] ?? 'dist/collaboration');
await mkdir(outDir, { recursive: true });
await build({
  stdin: { contents: 'import { mountCollaboration } from "./src/collaboration/client.ts"; mountCollaboration(JSON.parse(document.currentScript.previousElementSibling.textContent));', resolveDir: process.cwd(), loader: 'ts' },
  outfile: resolve(outDir, 'client.js'), bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
});
await build({ entryPoints: ['src/collaboration/service.ts', 'src/collaboration/database.ts'], outdir: outDir, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', logLevel: 'silent' });
await copyFile('src/collaboration/client.css', resolve(outDir, 'client.css'));
