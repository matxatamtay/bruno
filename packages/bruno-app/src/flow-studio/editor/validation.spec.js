import { addControlEdge, addNode, createAuthoringFlow, createControlNode, createInputNode, updateNode } from './model';
import { IncrementalFlowValidator } from './validation';

const createFlow = () => createAuthoringFlow({
  uid: 'flow_validation',
  name: 'Validation flow',
  workspaceUid: 'workspace_local',
  now: new Date('2026-07-20T00:00:00.000Z')
});

describe('Incremental Flow Studio validation', () => {
  it('validates only the dirty entity for a local inspector edit', () => {
    const validator = new IncrementalFlowValidator();
    let flow = createFlow();
    const input = createInputNode(flow, 'static-input', { x: 240, y: 180 }, { name: 'Input' });
    flow = addNode(flow, input);
    validator.validateFull(flow);

    const invalid = {
      ...flow,
      nodes: flow.nodes.map((node) => node.id === input.id ? { ...node, semanticKey: 'bad-key' } : node)
    };
    const result = validator.validate(invalid, { nodeIds: [input.id] });

    expect(result.mode).toBe('incremental');
    expect(result.validatedEntityCount).toBe(1);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: input.id, keyword: 'pattern' })
    ]));
  });

  it('contains temporary invalid authoring states instead of throwing from the compiler', () => {
    const validator = new IncrementalFlowValidator();
    const flow = createFlow();
    const invalid = {
      ...flow,
      nodes: flow.nodes.map((node, index) => index === 0 ? { ...node, semanticKey: 'bad-key' } : node)
    };

    expect(() => validator.validateFull(invalid)).not.toThrow();
    expect(validator.lastResult.issues.some((issue) => issue.keyword === 'pattern')).toBe(true);
  });

  it('recomputes topology diagnostics after a structural change', () => {
    const validator = new IncrementalFlowValidator();
    let flow = createFlow();
    validator.validateFull(flow);
    const detached = createInputNode(flow, 'static-input', { x: 400, y: 400 }, { name: 'Detached' });
    flow = addNode(flow, detached);

    const result = validator.validate(flow, { topology: true, nodeIds: [detached.id] });

    expect(result.mode).toBe('incremental');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'FLOW_UNREACHABLE_NODE', nodeId: detached.id, severity: 'warning' })
    ]));
  });

  it('rejects a quorum larger than the branches of its linked fork', () => {
    const validator = new IncrementalFlowValidator();
    let flow = createFlow();
    const join = createControlNode(flow, 'join', { x: 600, y: 240 }, { mode: 'quorum', quorum: 3 });
    flow = addNode(flow, join);
    const fork = createControlNode(flow, 'fork', { x: 300, y: 240 }, { joinNodeId: join.id, branchCount: 2 });
    flow = addNode(flow, fork);
    const branchA = createControlNode(flow, 'delay', { x: 450, y: 160 });
    flow = addNode(flow, branchA);
    const branchB = createControlNode(flow, 'delay', { x: 450, y: 320 });
    flow = addNode(flow, branchB);
    flow = addControlEdge(flow, { source: fork.id, target: branchA.id, sourceHandle: 'branch-0' });
    flow = addControlEdge(flow, { source: fork.id, target: branchB.id, sourceHandle: 'branch-1' });

    validator.validateFull(flow);
    const result = validator.validate(flow, { nodeIds: [join.id] });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: join.id, keyword: 'maximum' })
    ]));
  });
});
