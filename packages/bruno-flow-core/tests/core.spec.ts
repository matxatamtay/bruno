import fs from 'node:fs';
import path from 'node:path';
import {
  FlowValidationError,
  compileFlow,
  migrateFlowDocument,
  parseFlow,
  parseFlowDocument,
  serializeFlow
} from '../src';
import { createFixtureFlow } from './fixture';

describe('flow core schema, parser, serializer, migrations and compiler', () => {
  it('round-trips deterministically with a content-derived revision', () => {
    const first = serializeFlow(createFixtureFlow());
    const parsed = parseFlowDocument(first);
    const second = serializeFlow(parsed.flow);

    expect(second).toBe(first);
    expect(parsed.revisionMismatch).toBe(false);
    expect(parsed.flow.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first).toContain('tags:\n    - api\n    - smoke');
    expect(first.indexOf('alpha:')).toBeLessThan(first.indexOf('zeta:'));
  });

  it('recomputes a stale stored revision from external content', () => {
    const serialized = serializeFlow(createFixtureFlow());
    const externallyEdited = serialized.replace('name: Checkout flow', 'name: Externally edited');
    const parsed = parseFlowDocument(externallyEdited);

    expect(parsed.revisionMismatch).toBe(true);
    expect(parsed.flow.name).toBe('Externally edited');
    expect(parsed.storedRevision).not.toBe(parsed.flow.revision);
  });

  it('keeps the package schema byte-equivalent to the documented schema', () => {
    const packageSchema = fs.readFileSync(path.join(__dirname, '../src/schema/flow-schema-v1.schema.json'), 'utf8');
    const documentedSchema = fs.readFileSync(path.join(__dirname, '../../../docs/flow-studio/phase-0/schema/flow-schema-v1.schema.json'), 'utf8');
    expect(packageSchema).toBe(documentedSchema);
  });

  it('migrates the legacy v0 edge and workspace fields deterministically', () => {
    const legacy = {
      id: 'flow_legacy',
      name: 'Legacy',
      workspaceUid: 'workspace_local',
      nodes: [],
      edges: [],
      groups: []
    };
    const migrated = migrateFlowDocument(legacy, { now: () => new Date('2026-07-20T00:00:00.000Z') });

    expect(migrated.migratedFrom).toBe(0);
    expect(migrated.document).toMatchObject({
      schemaVersion: 1,
      uid: 'flow_legacy',
      workspace: { uid: 'workspace_local' },
      controlEdges: [],
      frames: []
    });

    const first = serializeFlow(legacy);
    const second = serializeFlow(legacy);
    const parsed = parseFlow(first);
    expect(parsed.uid).toBe('flow_legacy');
    expect(second).toBe(first);
  });

  it('rejects missing graph references before persistence', () => {
    const flow = createFixtureFlow();
    flow.controlEdges[0].targetNodeId = 'node_missing';

    expect(() => serializeFlow(flow)).toThrow(FlowValidationError);
  });

  it('builds a compiler IR without executing the flow', () => {
    const compiled = compileFlow(createFixtureFlow());

    expect(compiled.entryNodeIds).toEqual(['node_start']);
    expect(compiled.nodeOrder).toEqual(['node_start', 'node_request', 'node_end']);
    expect(compiled.nodes.node_request.incomingControlEdgeIds).toEqual(['edge_start_request']);
    expect(compiled.diagnostics).toEqual([]);
  });
});
