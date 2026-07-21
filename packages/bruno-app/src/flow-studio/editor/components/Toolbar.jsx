import React from 'react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconDeviceFloppy,
  IconFrame,
  IconLayersIntersect,
  IconPlayerPlay,
  IconPlayerStop,
  IconSearch,
  IconTrash
} from '@tabler/icons';

const ToolButton = ({ title, onClick, disabled, children, testId }) => (
  <button type="button" title={title} aria-label={title} data-testid={testId} disabled={disabled} onClick={onClick} className="flow-tool-button">
    {children}
  </button>
);

const Toolbar = ({
  flow,
  dirty,
  saving,
  canUndo,
  canRedo,
  validation,
  projectionMs,
  searchQuery,
  onSearchQueryChange,
  searchInputRef,
  onSave,
  onUndo,
  onRedo,
  onAddFrame,
  onGroup,
  onDelete,
  canGroup,
  canDelete,
  runStatus,
  onRun,
  onCancel
}) => (
  <header className="flow-toolbar">
    <div className="flow-toolbar-title">
      <strong>{flow?.name || 'Flow Studio'}</strong>
      <span className={dirty ? 'flow-save-state flow-unsaved' : 'flow-save-state'}>
        {saving ? 'Saving…' : (dirty ? 'Unsaved' : 'Saved')}
      </span>
    </div>
    <div className="flow-toolbar-actions">
      <ToolButton title="Save flow (Ctrl/Cmd+S)" onClick={onSave} disabled={!flow || saving || !dirty} testId="flow-save-button">
        <IconDeviceFloppy size={16} />
      </ToolButton>
      <ToolButton title="Undo (Ctrl/Cmd+Z)" onClick={onUndo} disabled={!canUndo}><IconArrowBackUp size={16} /></ToolButton>
      <ToolButton title="Redo (Ctrl/Cmd+Shift+Z)" onClick={onRedo} disabled={!canRedo}><IconArrowForwardUp size={16} /></ToolButton>
      <span className="flow-toolbar-divider" />
      {runStatus === 'queued' || runStatus === 'running'
        ? <ToolButton title="Cancel flow" onClick={onCancel} testId="flow-toolbar-cancel"><IconPlayerStop size={16} /></ToolButton>
        : <ToolButton title="Run flow" onClick={onRun} disabled={!flow} testId="flow-toolbar-run"><IconPlayerPlay size={16} /></ToolButton>}
      <span className="flow-toolbar-divider" />
      <ToolButton title="Add frame" onClick={onAddFrame}><IconFrame size={16} /></ToolButton>
      <ToolButton title="Group selected nodes" onClick={onGroup} disabled={!canGroup}><IconLayersIntersect size={16} /></ToolButton>
      <ToolButton title="Delete selected" onClick={onDelete} disabled={!canDelete}><IconTrash size={16} /></ToolButton>
    </div>
    <label className="flow-toolbar-search">
      <IconSearch size={14} />
      <input
        ref={searchInputRef}
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder="Find node"
      />
    </label>
    <div className="flow-toolbar-metrics">
      <span>{flow?.nodes?.length || 0} nodes</span>
      <span className={validation?.issues?.length ? 'flow-metric-warning' : ''}>{validation?.issues?.length || 0} issues</span>
      <span>{validation?.mode || 'full'} · {validation?.validatedEntityCount || 0}</span>
      <span>{Number(projectionMs || 0).toFixed(1)} ms projection</span>
    </div>
  </header>
);

export default Toolbar;
