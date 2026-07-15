import React, { useMemo, useState } from 'react';
import { IconAlertTriangle, IconPlayerPlay, IconX } from '@tabler/icons';

const SIDE_EFFECT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const RunAffectedModal = ({ affectedRequests = [], environments = [], activeEnvironmentUid, onClose, onRun }) => {
  const [environmentUid, setEnvironmentUid] = useState(activeEnvironmentUid || '');
  const [selectedPaths, setSelectedPaths] = useState(() => new Set(affectedRequests.map((request) => request.path)));
  const selectedRequests = useMemo(() => affectedRequests.filter((request) => selectedPaths.has(request.path)), [affectedRequests, selectedPaths]);
  const sideEffectCount = selectedRequests.filter((request) => SIDE_EFFECT_METHODS.has(request.method)).length;

  const toggle = (path) => setSelectedPaths((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const selectSafeOnly = () => setSelectedPaths(new Set(affectedRequests.filter((request) => !SIDE_EFFECT_METHODS.has(request.method)).map((request) => request.path)));

  return (
    <div className="run-affected-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="run-affected-modal" role="dialog" aria-modal="true" aria-label="Run affected requests" onMouseDown={(event) => event.stopPropagation()}>
        <div className="run-modal-header">
          <div>
            <strong>Run affected requests</strong>
            <span>Select an environment and the requests to execute.</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><IconX size={16} /></button>
        </div>

        <label className="run-env-field">
          <span>Environment</span>
          <select value={environmentUid} onChange={(event) => setEnvironmentUid(event.target.value)}>
            <option value="">No environment</option>
            {environments.map((environment) => <option key={environment.uid} value={environment.uid}>{environment.name}</option>)}
          </select>
        </label>

        <div className="run-modal-tools">
          <button type="button" onClick={() => setSelectedPaths(new Set(affectedRequests.map((request) => request.path)))}>Select all</button>
          <button type="button" onClick={selectSafeOnly}>GET/safe only</button>
          <span>{selectedRequests.length} selected</span>
        </div>

        <div className="run-request-list">
          {affectedRequests.map((request) => (
            <label key={request.path} className="run-request-row">
              <input type="checkbox" checked={selectedPaths.has(request.path)} onChange={() => toggle(request.path)} />
              <code className={`method ${SIDE_EFFECT_METHODS.has(request.method) ? 'side-effect' : ''}`}>{request.method || 'REQ'}</code>
              <span><strong>{request.name || request.path}</strong><small>{request.path}</small></span>
            </label>
          ))}
        </div>

        {sideEffectCount > 0 && (
          <div className="run-side-effect-warning"><IconAlertTriangle size={15} /> {sideEffectCount} selected request{sideEffectCount === 1 ? '' : 's'} may modify server data.</div>
        )}

        <div className="run-modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!selectedRequests.length} onClick={() => onRun({ environmentUid: environmentUid || null, paths: selectedRequests.map((request) => request.path), sideEffectCount })}>
            <IconPlayerPlay size={14} /> Run {selectedRequests.length}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RunAffectedModal;
