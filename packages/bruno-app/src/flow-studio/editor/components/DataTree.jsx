import React, { useEffect, useMemo, useState } from 'react';
import { IconGripVertical } from '@tabler/icons';
import { FLOW_OUTPUT_MIME, FLOW_OUTPUT_TEXT_PREFIX } from '../model';

const pathPart = (part) => /^\d+$/.test(String(part)) ? `[${part}]` : String(part);
const appendPath = (base, part) => /^\d+$/.test(String(part)) ? `${base}[${part}]` : `${base}.${pathPart(part)}`;
const previewValue = (value) => {
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === 'object') return Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`;
  return String(value);
};

const flattenRows = ({ value, rootName, rootPath, limit }) => {
  const rows = [];
  const stack = [{ name: rootName, value, sourcePath: rootPath, depth: 0 }];
  const seen = new WeakSet();
  while (stack.length > 0 && rows.length < limit) {
    const current = stack.pop();
    rows.push(current);
    if (!current.value || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) {
      current.circular = true;
      continue;
    }
    seen.add(current.value);
    const entries = Object.entries(current.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [childName, childValue] = entries[index];
      stack.push({
        name: childName,
        value: childValue,
        sourcePath: appendPath(current.sourcePath, childName),
        depth: current.depth + 1
      });
    }
  }
  return { rows, hasMore: stack.length > 0 };
};

const DataTree = ({ value, sourceNodeId, rootPath = 'response.body', rootName = 'body', pageSize = 400 }) => {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [pageSize, rootPath, sourceNodeId, value]);
  const projection = useMemo(() => flattenRows({ value, rootName, rootPath, limit }), [limit, rootName, rootPath, value]);
  if (!sourceNodeId || value === undefined) return null;
  return (
    <div className="flow-data-tree">
      <div className="flow-data-tree-help">Drag any response field into the Input mapping tab of a later request. Large responses render in bounded pages.</div>
      {projection.rows.map((row) => {
        const payload = { sourceNodeId, sourcePath: row.sourcePath };
        const drag = (event) => {
          const serialized = JSON.stringify(payload);
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData(FLOW_OUTPUT_MIME, serialized);
          event.dataTransfer.setData('text/plain', `${FLOW_OUTPUT_TEXT_PREFIX}${serialized}`);
        };
        return (
          <div
            key={row.sourcePath}
            className="flow-data-tree-row"
            style={{ paddingLeft: 5 + row.depth * 12 }}
            draggable
            onDragStart={drag}
            title={`Drag ${row.sourcePath} into another request`}
          >
            <IconGripVertical size={12} />
            <strong>{row.name}</strong>
            <span>{row.circular ? '[Circular]' : previewValue(row.value)}</span>
            <code>{row.sourcePath}</code>
          </div>
        );
      })}
      {projection.hasMore && (
        <button type="button" className="flow-data-tree-more" onClick={() => setLimit((current) => current + pageSize)}>
          Render {pageSize} more fields
        </button>
      )}
    </div>
  );
};

export default DataTree;
