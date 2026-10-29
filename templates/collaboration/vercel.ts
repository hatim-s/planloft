import { createClient } from '@libsql/client/web';
import { tursoDatabase } from '../../src/collaboration/database.js';
import { createCollaborationService } from '../../src/collaboration/service.js';
export const config = { runtime: 'edge' };
export default function handler(request: Request) {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  return createCollaborationService(tursoDatabase(client), process.env.ADMIN_TOKEN)(request);
}
