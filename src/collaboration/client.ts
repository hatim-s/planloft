import type { CollaborationConfig } from './contracts.js';
import { Collaboration } from './ui/controller.js';

/**
 * Starts comments, shared notes and shared task checkboxes on the current page. Reads
 * state once, then talks to the server only for this reader's own changes. Mounting a
 * second time on the same page does nothing.
 */
export function mountCollaboration(config: CollaborationConfig): void {
  if (document.querySelector('.plc[data-planloft-collaboration]')) return;
  const start = () => void new Collaboration(config);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
