import type { FlowDefinition } from '../types';

export interface FlowRecord {
  relativePath: string;
  pathname: string;
  content: string;
  flow: FlowDefinition;
  storedRevision: string | null;
  revisionMismatch: boolean;
}

export interface FlowCatalogEntry {
  uid: string | null;
  name: string;
  relativePath: string;
  pathname: string;
  revision: string | null;
  updatedAt: string | null;
  tags: string[];
  status: 'valid' | 'invalid';
  error?: string;
}

export type FlowWatchEventType = 'created' | 'changed' | 'deleted' | 'invalid';

export interface FlowWatchEvent {
  type: FlowWatchEventType;
  relativePath: string;
  pathname: string;
  entry?: FlowCatalogEntry;
  previous?: FlowCatalogEntry;
  error?: string;
}

export interface FlowDraftEnvelope {
  draftVersion: 1;
  draftUid: string;
  flowUid: string;
  relativePath: string;
  baseRevision: string | null;
  savedAt: string;
  flow: unknown;
}

export interface RecoveredFlowDraft {
  draft: FlowDraftEnvelope;
  currentRevision: string | null;
  hasConflict: boolean;
}
