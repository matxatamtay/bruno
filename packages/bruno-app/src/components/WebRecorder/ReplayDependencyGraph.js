import React, { useMemo } from 'react';

const ReplayDependencyGraph = ({ scenario }) => {
  const graph = useMemo(() => {
    const steps = (scenario?.steps || []).filter((step) => step.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
    const producers = new Map();
    steps.forEach((step) => (step.extracts || []).forEach((extract) => producers.set(extract.variable, step)));
    const edges = [];
    steps.forEach((step) => (step.overrides?.bindings || []).forEach((binding) => {
      const producer = producers.get(binding.variable);
      if (producer) edges.push({ from: producer.id, to: step.id, variable: binding.variable, targetPath: binding.targetPath });
    }));
    return { steps, edges };
  }, [scenario]);

  if (!graph.steps.length) return <div className="empty-state"><strong>No enabled steps</strong></div>;

  return (
    <div className="replay-dependency-graph">
      <div className="replay-graph-nodes">
        {graph.steps.map((step, index) => {
          const incoming = graph.edges.filter((edge) => edge.to === step.id);
          const outgoing = graph.edges.filter((edge) => edge.from === step.id);
          return (
            <React.Fragment key={step.id}>
              {index > 0 && <div className="replay-graph-sequence-arrow">→</div>}
              <div className={`replay-graph-node ${step.role || 'api'}`}>
                <span className="replay-graph-index">{index + 1}</span>
                <strong>{step.name}</strong>
                <small>{step.requestHint?.method} · {step.role}</small>
                {incoming.map((edge) => <code key={`in-${edge.from}-${edge.variable}`}>← {edge.variable}</code>)}
                {outgoing.map((edge) => <code key={`out-${edge.to}-${edge.variable}`}>{edge.variable} →</code>)}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="replay-graph-edges">
        <strong>Data dependencies</strong>
        {graph.edges.length ? graph.edges.map((edge) => {
          const producer = graph.steps.find((step) => step.id === edge.from);
          const consumer = graph.steps.find((step) => step.id === edge.to);
          return <div key={`${edge.from}-${edge.to}-${edge.variable}`} className="replay-graph-edge"><span>{producer?.name}</span><code>{edge.variable}</code><span>→ {consumer?.name}</span><small>{edge.targetPath}</small></div>;
        }) : <span className="replay-graph-empty">No inferred cross-step variables. Steps still run in sequence.</span>}
      </div>
    </div>
  );
};

export default ReplayDependencyGraph;
