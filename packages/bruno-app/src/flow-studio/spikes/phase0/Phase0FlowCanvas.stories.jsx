import React, { useMemo, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { Phase0FlowCanvas } from './Phase0FlowCanvas';
import { createNodeRuntimeStore } from './runtime-store';

export default {
  title: 'Flow Studio/Phase 0/500 Node Canvas',
  component: Phase0FlowCanvas
};

const FiveHundredNodeSpike = () => {
  const nodeIds = useMemo(() => Array.from({ length: 500 }, (_, index) => `node-${index}`), []);
  const runtimeStore = useMemo(() => createNodeRuntimeStore(nodeIds), [nodeIds]);
  const [status, setStatus] = useState('idle');

  const toggleNode = () => {
    const next = status === 'running' ? 'success' : 'running';
    runtimeStore.updateNode('node-250', { status: next });
    setStatus(next);
  };

  return (
    <div style={{ height: '90vh' }}>
      <button type="button" onClick={toggleNode}>
        Update only node 250 ({status})
      </button>
      <Phase0FlowCanvas nodeCount={500} runtimeStore={runtimeStore} height="calc(90vh - 40px)" />
    </div>
  );
};

export const FiveHundredNodes = {
  render: () => <FiveHundredNodeSpike />
};
