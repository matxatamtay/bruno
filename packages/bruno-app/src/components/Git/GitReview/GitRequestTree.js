import React, { useEffect, useMemo, useState } from 'react';
import { IconChevronRight, IconFileCode, IconFolder } from '@tabler/icons';
import CollectionItemIcon from 'components/Sidebar/Collections/Collection/CollectionItem/CollectionItemIcon';
import { isItemAFolder, isItemARequest } from 'utils/tabs';

const normalizePath = (value = '') => value.replace(/\\/g, '/').replace(/\/$/, '');

const statusLetter = (status) => ({
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C'
}[status] || '•');

const sortTreeItems = (items = []) => {
  const folders = items.filter((item) => isItemAFolder(item)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const apps = items.filter((item) => item.type === 'app').sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const requests = items.filter((item) => isItemARequest(item)).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  return [...folders, ...apps, ...requests];
};

const flattenPaths = (items = [], result = new Set()) => {
  items.forEach((item) => {
    if (item.pathname) result.add(normalizePath(item.pathname));
    if (item.items?.length) flattenPaths(item.items, result);
  });
  return result;
};

const GitRequestTree = ({ collection, files, selectedFile, commitHash, onSelectFile, impactedPaths = [] }) => {
  const [expandedOverrides, setExpandedOverrides] = useState({});

  useEffect(() => {
    setExpandedOverrides({});
  }, [commitHash]);

  const filePathMap = useMemo(() => {
    const map = new Map();
    files.forEach((file) => {
      if (file.absolutePath) map.set(normalizePath(file.absolutePath), file);
      if (file.oldAbsolutePath) map.set(normalizePath(file.oldAbsolutePath), file);
    });
    return map;
  }, [files]);

  const impactedSet = useMemo(() => new Set(impactedPaths.map(normalizePath)), [impactedPaths]);
  const allCurrentPaths = useMemo(() => flattenPaths(collection.items), [collection.items]);
  const unmatchedFiles = useMemo(() => files.filter((file) => {
    const current = normalizePath(file.absolutePath);
    const old = normalizePath(file.oldAbsolutePath);
    return !allCurrentPaths.has(current) && !allCurrentPaths.has(old);
  }), [files, allCurrentPaths]);

  const hasChangedDescendant = (folderPath) => {
    const normalizedFolder = `${normalizePath(folderPath)}/`;
    return files.some((file) => {
      const current = `${normalizePath(file.absolutePath)}`;
      const old = `${normalizePath(file.oldAbsolutePath)}`;
      return current.startsWith(normalizedFolder) || old.startsWith(normalizedFolder);
    });
  };

  const changedDescendantCount = (folderPath) => {
    const normalizedFolder = `${normalizePath(folderPath)}/`;
    return files.filter((file) => normalizePath(file.absolutePath).startsWith(normalizedFolder)
      || normalizePath(file.oldAbsolutePath).startsWith(normalizedFolder)).length;
  };

  const renderItem = (item, level = 0) => {
    const itemPath = normalizePath(item.pathname);
    const isFolder = isItemAFolder(item);
    const changedFile = filePathMap.get(itemPath);
    const folderChanged = isFolder && hasChangedDescendant(itemPath);
    const hasOverride = Object.prototype.hasOwnProperty.call(expandedOverrides, itemPath);
    const expanded = isFolder && (hasOverride ? expandedOverrides[itemPath] : folderChanged ? true : !item.collapsed);
    const selected = changedFile && selectedFile?.path === changedFile.path && (selectedFile?.oldPath || selectedFile?.path) === (changedFile.oldPath || changedFile.path);
    const collectionRelative = itemPath.startsWith(`${normalizePath(collection.pathname)}/`) ? itemPath.slice(normalizePath(collection.pathname).length + 1) : itemPath;
    const impacted = impactedSet.has(collectionRelative);

    if (isFolder) {
      const count = folderChanged ? changedDescendantCount(itemPath) : 0;
      return (
        <React.Fragment key={item.uid || itemPath}>
          <button
            type="button"
            className={`tree-row folder-row ${folderChanged ? 'has-changes' : ''}`}
            style={{ paddingLeft: 8 + level * 16 }}
            onClick={() => setExpandedOverrides((current) => ({ ...current, [itemPath]: !expanded }))}
          >
            <IconChevronRight className={expanded ? 'expanded' : ''} size={14} strokeWidth={2} />
            <IconFolder size={15} />
            <span className="tree-name">{item.name}</span>
            {count > 0 && <span className="folder-count">{count}</span>}
          </button>
          {expanded && sortTreeItems(item.items || []).map((child) => renderItem(child, level + 1))}
        </React.Fragment>
      );
    }

    return (
      <button
        type="button"
        key={item.uid || itemPath}
        className={`tree-row request-row ${changedFile ? `changed ${changedFile.status}` : ''} ${impacted ? 'impacted' : ''} ${selected ? 'selected' : ''}`}
        style={{ paddingLeft: 26 + level * 16 }}
        onClick={() => changedFile && onSelectFile(changedFile)}
        disabled={!changedFile}
        title={changedFile ? changedFile.collectionRelativePath : item.name}
      >
        <CollectionItemIcon item={item} />
        <span className="tree-name">{item.name}</span>
        {impacted && !changedFile && <span className="impact-badge">⚡</span>}
        {changedFile && <span className={`change-badge ${changedFile.status}`}>{statusLetter(changedFile.status)}</span>}
      </button>
    );
  };

  if (!files.length) {
    return <div className="empty-state">This commit does not change files inside the collection.</div>;
  }

  return (
    <div className="request-tree">
      <div className="tree-scroll">
        {sortTreeItems(collection.items || []).map((item) => renderItem(item))}

        {unmatchedFiles.length > 0 && (
          <div className="unmatched-section">
            <div className="unmatched-title">Deleted or non-request files</div>
            {unmatchedFiles.map((file) => (
              <button
                type="button"
                key={`${file.path}:${file.oldPath}`}
                className={`tree-row raw-file-row ${file.status} ${selectedFile?.path === file.path ? 'selected' : ''}`}
                onClick={() => onSelectFile(file)}
                title={file.collectionRelativePath}
              >
                <IconFileCode size={15} />
                <span className="tree-name">{file.collectionRelativePath || file.path}</span>
                <span className={`change-badge ${file.status}`}>{statusLetter(file.status)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GitRequestTree;
