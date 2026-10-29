import { d1Database } from '../../src/collaboration/database.js';
import { createCollaborationService } from '../../src/collaboration/service.js';
export default { fetch(request: Request, env: { DB: Parameters<typeof d1Database>[0]; ADMIN_TOKEN?: string }) { return createCollaborationService(d1Database(env.DB), env.ADMIN_TOKEN)(request); } };
