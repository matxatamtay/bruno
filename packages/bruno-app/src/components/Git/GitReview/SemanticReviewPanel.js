import React from 'react';
import { IconAlertCircle, IconAlertTriangle, IconBolt, IconKey, IconLoader2, IconPlayerPlay } from '@tabler/icons';

const severityIcon = {
  breaking: IconAlertTriangle,
  warning: IconAlertCircle,
  secret: IconKey,
  info: IconBolt
};

const SemanticReviewPanel = ({ review, loading, onSelectFinding, onRunAffected }) => {
  if (loading) return <div className="semantic-loading"><IconLoader2 className="spin" size={15} /> Analyzing commit semantics</div>;
  if (!review) return null;
  const summary = review.summary || {};
  return (
    <section className="semantic-review">
      <div className="semantic-header">
        <div>
          <strong>Semantic review</strong>
          <span>Compared with {review.comparedWith === 'first-parent' ? 'first parent' : review.comparedWith}</span>
        </div>
        {review.affectedRequests?.length > 0 && (
          <button type="button" className="run-affected" onClick={onRunAffected}>
            <IconPlayerPlay size={14} /> Run {review.affectedRequests.length} affected
          </button>
        )}
      </div>
      <div className="semantic-summary">
        <span className="breaking"><b>{summary.breaking || 0}</b> Breaking</span>
        <span className="warning"><b>{summary.warnings || 0}</b> Warnings</span>
        <span className="secret"><b>{summary.secrets || 0}</b> Secrets</span>
        <span className="affected"><b>{summary.affectedRequests || 0}</b> Affected</span>
      </div>
      {review.partial && <div className="semantic-partial">Analysis is partial. {review.warnings?.join(' ')}</div>}
      {review.environmentMatrix?.length > 0 && review.requiredVariables?.length > 0 && (
        <div className="environment-matrix-wrap">
          <div className="environment-matrix-title">Environment coverage</div>
          <div className="environment-matrix-scroll">
            <table className="environment-matrix">
              <thead>
                <tr>
                  <th>Environment</th>
                  {review.requiredVariables.map((variable) => <th key={variable}>{variable}</th>)}
                </tr>
              </thead>
              <tbody>
                {review.environmentMatrix.map((environment) => (
                  <tr key={environment.path || environment.name}>
                    <td>{environment.name}</td>
                    {review.requiredVariables.map((variable) => (
                      <td key={variable} className={environment.variables?.[variable] ? 'present' : 'missing'}>
                        {environment.variables?.[variable] ? '✓' : '✕'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="semantic-findings">
        {review.findings?.length ? review.findings.map((finding) => {
          const Icon = severityIcon[finding.severity] || IconBolt;
          return (
            <button type="button" key={finding.id} className={`semantic-finding ${finding.severity}`} onClick={() => onSelectFinding(finding)}>
              <Icon size={16} />
              <span>
                <strong>{finding.title}</strong>
                <small>{finding.description}</small>
                <code>{finding.filePath}{finding.confidence ? ` · ${finding.confidence} confidence` : ''}</code>
              </span>
            </button>
          );
        }) : <div className="semantic-clean">No semantic risks detected for this commit.</div>}
      </div>
    </section>
  );
};

export default SemanticReviewPanel;
