import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { migrate, sqliteDatabase } from './database.mjs';
import { createCollaborationService, MAX_BODY_BYTES } from './service.mjs';
const sqlite = new DatabaseSync(process.env.PLANLOFT_DB ?? 'collaboration.sqlite');
sqlite.exec('PRAGMA foreign_keys = ON');
const db = sqliteDatabase(sqlite);
await migrate(db);
const handler = createCollaborationService(db, process.env.ADMIN_TOKEN);
const port = Number(process.env.PORT ?? 8787);
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'body_too_large' }));
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
    const response = await handler(request); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500); res.end('Internal error'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Collaboration service listening on http://127.0.0.1:${server.address().port}`));
