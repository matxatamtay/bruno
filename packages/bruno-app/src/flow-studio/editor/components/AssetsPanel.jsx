import React, { useMemo, useState } from 'react';
import { IconBraces, IconChevronDown, IconChevronRight, IconDatabase, IconGitBranch, IconGripVertical, IconSearch, IconWorld } from '@tabler/icons';
import { controlAssets, filterAssets, groupRequestAssets, inputAssets } from '../assets';
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

const inputIcon = (kind) => {
  if (kind === 'environment-input') return <IconWorld size={14} />;
  if (kind === 'dataset-input') return <IconDatabase size={14} />;
  return <IconBraces size={14} />;
};

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
    <span className="flow-asset-copy"><strong>{asset.name}</strong><small>{asset.kind}</small></span>
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

const AssetsPanel = ({ requestAssets, searchQuery, onSearchQueryChange, searchInputRef }) => {
  const [collapsedCollections, setCollapsedCollections] = useState({});
  const filteredRequests = useMemo(() => filterAssets(requestAssets, searchQuery), [requestAssets, searchQuery]);
  const groups = useMemo(() => Object.values(groupRequestAssets(filteredRequests)), [filteredRequests]);

  return (
    <div className="flow-assets-panel">
      <div className="flow-panel-heading">Assets</div>
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

      <div className="flow-assets-section flow-control-assets">
        <div className="flow-assets-section-title">Control flow</div>
        {controlAssets.map((asset) => <ControlAsset key={asset.id} asset={asset} />)}
      </div>

      <div className="flow-assets-section">
        <div className="flow-assets-section-title">Inputs</div>
        {inputAssets.map((asset) => <InputAsset key={asset.id} asset={asset} />)}
      </div>

      <div className="flow-assets-section flow-request-assets">
        <div className="flow-assets-section-title">Requests from workspace</div>
        {groups.length === 0 && <div className="flow-empty-copy">No matching loaded requests.</div>}
        {groups.map((group) => {
          const collapsed = Boolean(collapsedCollections[group.collectionUid]);
          return (
            <div key={group.collectionUid} className="flow-asset-collection">
              <button
                type="button"
                className="flow-asset-collection-title"
                onClick={() => setCollapsedCollections((current) => ({ ...current, [group.collectionUid]: !collapsed }))}
              >
                {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                <span>{group.collectionName}</span>
                <small>{group.assets.length}</small>
              </button>
              {!collapsed && group.assets.map((asset) => <RequestAsset key={asset.id} asset={asset} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AssetsPanel;
