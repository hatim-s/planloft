import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import type { CollaborationProvider } from './contracts.js';
import { resolve } from 'node:path';
import { schema } from './database.js';
export class CollaborationDeploymentError extends Error {
  readonly code = 'PLANLOFT_COLLABORATION_BUILD_FAILED' as const;
  constructor() { super('Could not build the collaboration service.'); }
}

/** Build local artifacts. Secrets are supplied to the hosting provider separately. */
export async function buildCollaborationDeployment(options: { provider: CollaborationProvider; outDir: string; projectRoot: string }): Promise<void> {
  const { provider, projectRoot } = options;
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  try {
    if (provider === 'local') {
      for (const entry of ['database', 'service']) await writeFile(resolve(outDir, `${entry}.mjs`), await readFile(resolve(projectRoot, `dist/collaboration/${entry}.js`)));
      await writeFile(resolve(outDir, 'local.mjs'), await readFile(resolve(projectRoot, 'templates/collaboration/local.mjs')));
    } else {
      const output = provider === 'cloudflare' ? 'worker.mjs' : 'api/index.mjs';
      await mkdir(resolve(outDir, 'api'), { recursive: true });
      await build({ logLevel: 'silent', entryPoints: [resolve(projectRoot, `templates/collaboration/${provider}.ts`)], outfile: resolve(outDir, output), bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', conditions: ['workerd', 'browser', 'import'], define: provider === 'vercel' ? { 'process.env.NODE_ENV': '"production"' } : {} });
      if (provider === 'cloudflare') await writeFile(resolve(outDir, 'wrangler.toml'), 'name = "planloft-collaboration"\nmain = "worker.mjs"\ncompatibility_date = "2025-01-01"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "planloft-collaboration"\ndatabase_id = "REPLACE_WITH_D1_DATABASE_ID"\n');
      else await writeFile(resolve(outDir, 'vercel.json'), JSON.stringify({ functions: { 'api/index.mjs': { runtime: 'edge' } }, rewrites: [{ source: '/(.*)', destination: '/api/index' }] }, null, 2));
    }
    await writeFile(resolve(outDir, 'migration.sql'), schema.map(sql => `${sql};`).join('\n'));
  } catch { throw new CollaborationDeploymentError(); }
}
