export interface CollaborationConfig {
  documentId: string;
  revision: string;
  apiUrl: string;
  contentSelector?: string;
}

export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  revision?: string;
  documentId?: string;
}

export interface Comment { id: string; body: string; createdAt: string }
export interface Thread { id: string; body: string; anchor: TextAnchor | null; resolved: boolean; createdAt: string; comments: Comment[] }
export interface Note { id: string; body: string; version: number; createdAt: string; updatedAt: string }
export interface Task { key: string; checked: boolean; version: number }
export interface CollaborationState { threads: Thread[]; notes: Note[]; tasks: Task[] }
export interface NoteConflict { error: 'conflict'; current: Note }
