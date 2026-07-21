import React from 'react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconClipboard,
  IconCopy,
  IconDeviceFloppy,
  IconDeviceDesktop,
  IconFrame,
  IconLayersIntersect,
  IconLayoutGrid,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
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
  onCopy,
  onPaste,
  onAutoLayout,
  canCopy,
  canPaste,
  canGroup,
  canDelete,
  runStatus,
  onRun,
  onCancel,
  dataCases = [],
  activeCaseId = '',
  onCaseChange,
  onCreateCase,
  onUpdateCase,
  onRenameCase,
  onDeleteCase
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
      <ToolButton title="Auto layout" onClick={onAutoLayout} disabled={!flow}><IconLayoutGrid size={16} /></ToolButton>
      <ToolButton title="Group selected nodes" onClick={onGroup} disabled={!canGroup}><IconLayersIntersect size={16} /></ToolButton>
      <ToolButton title="Copy selected (Ctrl/Cmd+C)" onClick={onCopy} disabled={!canCopy}><IconCopy size={16} /></ToolButton>
      <ToolButton title="Paste (Ctrl/Cmd+V)" onClick={onPaste} disabled={!canPaste}><IconClipboard size={16} /></ToolButton>
      <ToolButton title="Delete selected" onClick={onDelete} disabled={!canDelete}><IconTrash size={16} /></ToolButton>
    </div>
    <div className="flow-toolbar-case">
      <IconDeviceDesktop size={14} />
      <select aria-label="Data case" value={activeCaseId} onChange={(event) => onCaseChange?.(event.target.value)}>
        <option value="">Live inputs</option>
        {dataCases.map((dataCase) => <option key={dataCase.id} value={dataCase.id}>{dataCase.name}</option>)}
      </select>
      {activeCaseId && (
        <input
          key={activeCaseId}
          aria-label="Data case name"
          defaultValue={dataCases.find((dataCase) => dataCase.id === activeCaseId)?.name || ''}
          onBlur={(event) => onRenameCase?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      )}
      <ToolButton title="Create data case from current inputs" onClick={onCreateCase}><IconPlus size={14} /></ToolButton>
      <ToolButton title="Update selected data case" onClick={onUpdateCase} disabled={!activeCaseId}><IconDeviceFloppy size={14} /></ToolButton>
      <ToolButton title="Delete selected data case" onClick={onDeleteCase} disabled={!activeCaseId}><IconTrash size={14} /></ToolButton>
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
