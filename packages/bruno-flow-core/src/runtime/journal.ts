import type { FlowNodeOutput } from './value';
import { safeProjectUnknown } from './value';
import type { ResolvedRequestPreview } from './request';

export type FlowSideEffectClass = 'none' | 'read-only' | 'idempotent' | 'once';
export type FlowResumePolicy = 'reuse' | 'rerun' | 'forbid';
export type FlowJournalStatus = 'success' | 'failed' | 'cancelled';

export interface FlowJournalEntry {
  executionKey: string;
  flowUid: string;
  flowRevision: string;
  nodeId: string;
  scope: string[];
  status: FlowJournalStatus;
  attempts: number;
  sideEffect: FlowSideEffectClass;
  resumePolicy: FlowResumePolicy;
  completedAt: string;
  output?: FlowNodeOutput;
  result?: Record<string, unknown>;
  preview?: ResolvedRequestPreview;
  error?: { message: string; code?: string };
}

export interface FlowCheckpointState {
  schemaVersion: 1;
  checkpointId: string;
  runId: string;
  rootFlowUid: string;
  rootRevision: string;
  nodeId: string;
  createdAt: string;
  journal: Record<string, FlowJournalEntry>;
}

export const cloneJournalEntry = (entry: FlowJournalEntry): FlowJournalEntry => {
  if (typeof structuredClone === 'function') return structuredClone(entry);
  return JSON.parse(JSON.stringify(entry)) as FlowJournalEntry;
};

const sortedJournalEntries = (journal: Map<string, FlowJournalEntry>) => [...journal.entries()]
  .sort(([left], [right]) => left.localeCompare(right));

export const journalMapToRecord = (journal: Map<string, FlowJournalEntry>): Record<string, FlowJournalEntry> => Object.fromEntries(
  sortedJournalEntries(journal).map(([key, entry]) => [key, cloneJournalEntry(entry)])
);

export const checkpointJournalMap = (checkpoint?: FlowCheckpointState | null): Map<string, FlowJournalEntry> => new Map(
  Object.entries(checkpoint?.journal || {}).map(([key, entry]) => [key, cloneJournalEntry(entry)])
);

export const safeProjectJournal = (journal: Map<string, FlowJournalEntry>): Record<string, unknown> => Object.fromEntries(
  sortedJournalEntries(journal).map(([key, entry]) => [key, {
    executionKey: entry.executionKey,
    flowUid: entry.flowUid,
    nodeId: entry.nodeId,
    scope: entry.scope,
    status: entry.status,
    attempts: entry.attempts,
    sideEffect: entry.sideEffect,
    resumePolicy: entry.resumePolicy,
    completedAt: entry.completedAt,
    error: entry.error ? safeProjectUnknown(entry.error) : undefined
  }])
);
