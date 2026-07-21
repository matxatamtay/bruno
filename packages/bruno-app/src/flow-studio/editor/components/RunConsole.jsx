import React, { useEffect, useMemo, useState } from 'react';
import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconRotateClockwise, IconTrash } from '@tabler/icons';
import DataTree from './DataTree';

const safeStringify = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value ?? '');
  }
};

const InputField = ({ name, definition = {}, value, onChange }) => {
  const type = definition.type || 'string';
  const label = definition.title || name;
  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return (
      <label className="flow-run-input">
        <span>{label}</span>
        <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
          {definition.enum.map((option) => <option key={String(option)} value={option}>{String(option)}</option>)}
        </select>
      </label>
    );
  }
  if (type === 'boolean') {
    return (
      <label className="flow-run-input flow-run-checkbox">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  return (
    <label className="flow-run-input">
      <span>{label}</span>
      <input
        type={definition.writeOnly ? 'password' : (type === 'number' || type === 'integer' ? 'number' : 'text')}
        value={value ?? ''}
        onChange={(event) => {
          const next = type === 'number' || type === 'integer'
            ? (event.target.value === '' ? '' : Number(event.target.value))
            : event.target.value;
          onChange(next);
        }}
        placeholder={definition.description || name}
      />
    </label>
  );
};

const eventLabel = (event) => event.type.replace('flow.', '').replaceAll('.', ' · ');

const RunConsole = ({
  flow,
  runtime,
  inputs,
  onInputChange,
  onRun,
  onCancel,
  onResume,
  onDeleteCheckpoint,
  checkpoints = [],
  onPreview,
  selectedRequestNode,
  preview,
  previewError,
  previewing,
  runHistory = [],
  activeCaseName = 'Live inputs'
}) => {
  const properties = flow?.inputSchema?.properties || {};
  const running = runtime.status === 'queued' || runtime.status === 'running';
  const selectedPreview = selectedRequestNode ? runtime.nodes?.[selectedRequestNode.id]?.preview : null;
  const displayedPreview = selectedPreview || preview;
  const [selectedRunId, setSelectedRunId] = useState('');
  useEffect(() => {
    if (runtime.runId) setSelectedRunId(runtime.runId);
  }, [runtime.runId]);
  const selectedHistoryRun = useMemo(() => runHistory.find((entry) => entry.runId === selectedRunId) || null, [runHistory, selectedRunId]);
  const inspectedRun = selectedHistoryRun || runtime.result;
  const selectedNodeRuntime = selectedRequestNode ? runtime.nodes?.[selectedRequestNode.id] : null;
  const selectedNodeResult = selectedRequestNode
    ? (selectedHistoryRun?.results?.[selectedRequestNode.id] || selectedNodeRuntime?.result || inspectedRun?.results?.[selectedRequestNode.id])
    : null;

  return (
    <section className="flow-run-console" data-testid="flow-run-console">
      <div className="flow-run-panel flow-run-inputs">
        <div className="flow-run-heading">
          <strong>Run inputs</strong>
          <span>{activeCaseName} · {Object.keys(properties).length} fields</span>
        </div>
        <div className="flow-run-scroll">
          {Object.keys(properties).length === 0 && <div className="flow-empty-copy">No form inputs in this flow.</div>}
          {Object.entries(properties).map(([name, definition]) => (
            <InputField
              key={name}
              name={name}
              definition={definition}
              value={inputs[name]}
              onChange={(value) => onInputChange(name, value)}
            />
          ))}
        </div>
        {checkpoints.length > 0 && (
          <div className="flow-run-checkpoints">
            <strong>Checkpoints</strong>
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint.checkpointId} className="flow-run-checkpoint-row">
                <span title={checkpoint.checkpointId}>{checkpoint.nodeId || checkpoint.checkpointId}</span>
                <small>{checkpoint.journalEntries || 0} journal</small>
                <button type="button" onClick={() => onResume?.(checkpoint.checkpointId)} disabled={running || checkpoint.status !== 'valid'} title="Resume checkpoint">
                  <IconRotateClockwise size={12} />
                </button>
                <button type="button" onClick={() => onDeleteCheckpoint?.(checkpoint.checkpointId)} disabled={running} title="Delete checkpoint">
                  <IconTrash size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flow-run-actions">
          <button type="button" className="flow-primary-button" onClick={onRun} disabled={!flow || running} data-testid="flow-run-button">
            <IconPlayerPlay size={14} /> Run flow
          </button>
          {runtime.status === 'paused' && runtime.result?.checkpointId ? (
            <button type="button" onClick={() => onResume?.(runtime.result.checkpointId)} disabled={running} data-testid="flow-resume-button">
              <IconRotateClockwise size={14} /> Resume
            </button>
          ) : (
            <button type="button" onClick={onCancel} disabled={!running} data-testid="flow-cancel-button">
              <IconPlayerStop size={14} /> Cancel
            </button>
          )}
        </div>
      </div>

      <div className="flow-run-panel flow-run-events">
        <div className="flow-run-heading">
          <strong>Run console</strong>
          <div className="flow-run-history-control">
            {runHistory.length > 0 && (
              <select aria-label="Run history" value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
                {runHistory.map((entry) => (
                  <option key={entry.runId} value={entry.runId}>{entry.dataCaseName || 'Live inputs'} · {entry.status} · {entry.runId.slice(-7)}</option>
                ))}
              </select>
            )}
            <span className={`flow-run-status flow-run-status-${runtime.status}`}>{runtime.status}</span>
          </div>
        </div>
        <div className="flow-run-scroll" data-testid="flow-run-events">
          {runtime.events.length === 0 && <div className="flow-empty-copy">Run the flow to stream node and edge events.</div>}
          {runtime.events.map((event) => (
            <div key={event.eventId} className={`flow-run-event flow-run-event-${event.type.split('.').at(-1)}`}>
              <span>{event.sequence}</span>
              <strong>{eventLabel(event)}</strong>
              <small>{event.nodeId || event.edgeId || ''}</small>
            </div>
          ))}
          {runtime.error?.message && <div className="flow-run-error">{runtime.error.message}</div>}
        </div>
      </div>

      <div className="flow-run-panel flow-run-preview">
        <div className="flow-run-heading">
          <strong>Request, response & data</strong>
          <button type="button" onClick={onPreview} disabled={!selectedRequestNode || previewing} title="Refresh preview">
            <IconRefresh size={13} /> {previewing ? 'Resolving…' : 'Preview'}
          </button>
        </div>
        <div className="flow-run-scroll">
          {!selectedRequestNode && <div className="flow-empty-copy">Select a request node to inspect the canonical request and runtime variables Flow will pass to Bruno.</div>}
          {previewError && <div className="flow-run-error">{previewError}</div>}
          {displayedPreview && (
            <>
              <div className="flow-preview-summary">
                <strong>{displayedPreview.method || 'REQUEST'}</strong>
                <span>{displayedPreview.url || selectedRequestNode?.requestRef?.itemPathname}</span>
              </div>
              <details open><summary>Runtime variables</summary><pre>{safeStringify(displayedPreview.runtimeVariables || {})}</pre></details>
              <details><summary>Query template</summary><pre>{safeStringify(displayedPreview.query)}</pre></details>
              <details><summary>Headers template</summary><pre>{safeStringify(displayedPreview.headers)}</pre></details>
              <details><summary>Body template</summary><pre>{safeStringify(displayedPreview.body)}</pre></details>
              <details><summary>Provenance</summary><pre>{safeStringify(displayedPreview.provenance)}</pre></details>
            </>
          )}
          {selectedNodeResult && (
            <>
              <details open><summary>Last request</summary><pre>{safeStringify(selectedNodeResult.request || displayedPreview || {})}</pre></details>
              <details open><summary>Response body · {selectedNodeResult.response?.status || selectedNodeResult.status || 'completed'}</summary><pre>{safeStringify(selectedNodeResult.response?.body ?? null)}</pre></details>
              <details><summary>Response headers</summary><pre>{safeStringify(selectedNodeResult.response?.headers || {})}</pre></details>
              <details><summary>Tests, assertions & timeline</summary><pre>{safeStringify({ tests: selectedNodeResult.tests, assertions: selectedNodeResult.assertions, timeline: selectedNodeResult.timeline, durationMs: selectedNodeResult.durationMs })}</pre></details>
              <DataTree value={selectedNodeResult.response?.body} sourceNodeId={selectedRequestNode?.id} />
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default RunConsole;
