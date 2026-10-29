import { createClient } from '@libsql/client/web';
import { tursoDatabase } from '../../dist/collaboration/database.js';
import { createCollaborationService } from '../../dist/collaboration/service.js';
export const config = { runtime: 'edge' };
const url = process.env.TURSO_DATABASE_URL;
const configurationMessage = 'Configure TURSO_DATABASE_URL with a supported database URL.';
if (!url) throw new Error(configurationMessage);
try {
  if (!['https:', 'http:', 'libsql:'].includes(new URL(url).protocol)) throw new Error(configurationMessage);
} catch { throw new Error(configurationMessage); }
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const service = createCollaborationService(tursoDatabase(client), process.env.ADMIN_TOKEN);
export default function handler(request: Request) { return service(request); }
