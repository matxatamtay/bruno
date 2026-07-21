import { normalizeFlowDefinition } from './parser';
import type { FlowDefinition } from './types';

export interface CreateFlowDefinitionOptions {
  uid: string;
  name: string;
  workspaceUid: string;
  description?: string;
  now?: Date;
}

export const createFlowDefinition = (options: CreateFlowDefinitionOptions): FlowDefinition => {
  const now = (options.now || new Date()).toISOString();
  return normalizeFlowDefinition({
    schemaVersion: 1,
    uid: options.uid,
    name: options.name,
    ...(options.description ? { description: options.description } : {}),
    revision: 'rev:new',
    workspace: { uid: options.workspaceUid },
    defaults: {},
    nodes: [],
    controlEdges: [],
    dataEdges: [],
    frames: [],
    metadata: {
      createdAt: now,
      updatedAt: now
    }
  });
};
