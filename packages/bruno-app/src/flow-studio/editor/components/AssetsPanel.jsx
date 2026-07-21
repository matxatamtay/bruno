import React, { useMemo, useState } from 'react';
import {
  IconBraces,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconGitBranch,
  IconGripVertical,
  IconSearch
} from '@tabler/icons';
import { buildRequestAssetTree, controlAssets, filterAssets, inputAssets } from '../assets';
import { FLOW_ASSET_MIME, FLOW_ASSET_TEXT_PREFIX } from '../model';

const startDrag = (event, asset) => {
  const payload = JSON.stringify(asset);
  event.dataTransfer.setData(FLOW_ASSET_MIME, payload);
  event.dataTransfer.setData('text/plain', `${FLOW_ASSET_TEXT_PREFIX}${payload}`);
  event.dataTransfer.effectAllowed = 'copy';
};

const methodLabel = (asset) => asset.method || asset.type.replace('-request', '').toUpperCase();

const RequestAsset = ({ asset }) => (
  <button
    type="button"
    className="flow-asset-row"
    draggable
    onDragStart={(event) => startDrag(event, asset)}
    title={`${asset.collectionName} / ${asset.breadcrumb ? `${asset.breadcrumb} / ` : ''}${asset.name}`}
  >
    <IconGripVertical size={13} className="flow-asset-grip" />
    <span className="flow-asset-method">{methodLabel(asset)}</span>
    <span className="flow-asset-copy">
      <strong>{asset.name}</strong>
      <small>{asset.breadcrumb || asset.url || asset.itemPathname}</small>
    </span>
  </button>
);

const RequestTreeNode = ({ node, depth, expanded, onToggle }) => {
  if (node.type === 'request') {
    return <div style={{ paddingLeft: depth * 12 }}><RequestAsset asset={node.asset} /></div>;
  }
  const open = expanded.has(node.id);
  return (
    <div className="flow-asset-tree-folder">
      <button
        type="button"
        className="flow-asset-folder-row"
        onClick={() => onToggle(node.id)}
        aria-expanded={open}
        title={node.path}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        <IconFolder size={14} />
        <span>{node.name}</span>
        <small>{node.children.length}</small>
      </button>
      {open && node.children.map((child) => (
        <RequestTreeNode key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
      ))}
    </div>
  );
};

const inputIcon = () => <IconBraces size={14} />;

const ControlAsset = ({ asset }) => (
  <button
    type="button"
    className="flow-asset-row flow-control-asset"
    draggable
    onDragStart={(event) => startDrag(event, asset)}
    title={asset.name}
  >
    <IconGripVertical size={13} className="flow-asset-grip" />
    <span className="flow-input-asset-icon"><IconGitBranch size={14} /></span>
    <span className="flow-asset-copy"><strong>{asset.name}</strong><small>{asset.relativePath || asset.kind}</small></span>
  </button>
);

const InputAsset = ({ asset }) => (
  <button
    type="button"
    className="flow-asset-row flow-input-asset"
    draggable
    onDragStart={(event) => startDrag(event, asset)}
  >
    <IconGripVertical size={13} className="flow-asset-grip" />
    <span className="flow-input-asset-icon">{inputIcon(asset.kind)}</span>
    <span className="flow-asset-copy"><strong>{asset.name}</strong><small>{asset.kind}</small></span>
  </button>
);

const AssetsPanel = ({ requestAssets, reusableFlowAssets = [], collectionName, searchQuery, onSearchQueryChange, searchInputRef }) => {
  const filteredRequests = useMemo(() => filterAssets(requestAssets, searchQuery), [requestAssets, searchQuery]);
  const requestTree = useMemo(() => buildRequestAssetTree(filteredRequests), [filteredRequests]);
  const defaultExpanded = useMemo(() => {
    const ids = [];
    const visit = (nodes) => nodes.forEach((node) => {
      if (node.type !== 'folder') return;
      ids.push(node.id);
      visit(node.children);
    });
    visit(requestTree);
    return ids;
  }, [requestTree]);
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set());
  const expanded = useMemo(() => new Set(defaultExpanded.filter((id) => !collapsedFolders.has(id))), [defaultExpanded, collapsedFolders]);
  const toggleFolder = (id) => setCollapsedFolders((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="flow-assets-panel">
      <div className="flow-panel-heading">Collection & nodes</div>
      <label className="flow-search-box">
        <IconSearch size={14} />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search requests and nodes"
          data-testid="flow-assets-search"
        />
      </label>

      <div className="flow-assets-scroll" data-testid="flow-assets-scroll">
        <div className="flow-assets-section flow-request-assets">
          <div className="flow-assets-section-title">Collection · {collectionName || 'Current collection'}</div>
          {filteredRequests.length === 0 && <div className="flow-empty-copy">No matching requests in this collection.</div>}
          {requestTree.map((node) => (
            <RequestTreeNode key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggleFolder} />
          ))}
        </div>
        {reusableFlowAssets.length > 0 && (
          <div className="flow-assets-section flow-reusable-assets">
            <div className="flow-assets-section-title">Reusable flows</div>
            {reusableFlowAssets.map((asset) => <ControlAsset key={asset.id} asset={asset} />)}
          </div>
        )}
        <div className="flow-assets-section flow-control-assets">
          <div className="flow-assets-section-title">Control flow</div>
          {controlAssets.map((asset) => <ControlAsset key={asset.id} asset={asset} />)}
        </div>

        <div className="flow-assets-section">
          <div className="flow-assets-section-title">Response mapping</div>
          {inputAssets.map((asset) => <InputAsset key={asset.id} asset={asset} />)}
          <div className="flow-empty-copy">Drag response fields into request nodes or the Inspector to create runtime, query, header, and body mappings.</div>
        </div>
      </div>
    </div>
  );
};

export default AssetsPanel;
