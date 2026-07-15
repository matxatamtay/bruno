import React, { useCallback, useEffect, useMemo, useState } from 'react';
import get from 'lodash/get';
import isEqual from 'lodash/isEqual';
import { IconFileDiff, IconLoader2 } from '@tabler/icons';
import VisualDiffContent from 'components/Git/VisualDiffViewer/VisualDiffContent';
import VisualDiffUrlBar from 'components/Git/VisualDiffViewer/VisualDiffUrlBar';
import VisualDiffParams from 'components/Git/VisualDiffViewer/VisualDiffParams';
import VisualDiffHeaders from 'components/Git/VisualDiffViewer/VisualDiffHeaders';
import VisualDiffBody from 'components/Git/VisualDiffViewer/VisualDiffBody';
import VisualDiffAuth from 'components/Git/VisualDiffViewer/VisualDiffAuth';
import { computeLineDiffForNew, computeLineDiffForOld } from 'components/Git/VisualDiffViewer/utils/diffUtils';

const toDisplayText = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const hasValue = (value) => {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

const LineValueDiff = ({ oldData, newData, showSide, selectValue }) => {
  const oldText = toDisplayText(selectValue(oldData));
  const newText = toDisplayText(selectValue(newData));
  const segments = showSide === 'old'
    ? computeLineDiffForOld(oldText, newText)
    : computeLineDiffForNew(oldText, newText);

  return (
    <div className="code-diff-content">
      {segments.map((segment, index) => (
        <div key={index} className={`diff-line ${segment.status}`}>{segment.text || '\u00A0'}</div>
      ))}
    </div>
  );
};

const RequestDiff = (props) => (
  <>
    <VisualDiffUrlBar {...props} />
    <LineValueDiff
      {...props}
      selectValue={(data) => ({
        name: get(data, 'name', ''),
        type: get(data, 'type', ''),
        method: get(data, 'request.method', ''),
        url: get(data, 'request.url', '')
      })}
    />
  </>
);

const VarsDiff = (props) => <LineValueDiff {...props} selectValue={(data) => get(data, 'request.vars', {})} />;
const ScriptsDiff = (props) => <LineValueDiff {...props} selectValue={(data) => get(data, 'request.script', {})} />;
const AssertionsDiff = (props) => <LineValueDiff {...props} selectValue={(data) => get(data, 'request.assertions', [])} />;
const TestsDiff = (props) => <LineValueDiff {...props} selectValue={(data) => get(data, 'request.tests', '')} />;
const DocsDiff = (props) => <LineValueDiff {...props} selectValue={(data) => get(data, 'request.docs', '')} />;
const SettingsDiff = (props) => (
  <LineValueDiff
    {...props}
    selectValue={(data) => ({
      tags: get(data, 'tags', []),
      settings: get(data, 'settings', {}),
      app: get(data, 'app', {})
    })}
  />
);
const RawDiff = (props) => <LineValueDiff {...props} selectValue={(data) => data?.raw || ''} />;

const CONFIG = [
  { key: 'request', label: 'Request', Component: RequestDiff, select: (data) => ({ name: get(data, 'name'), type: get(data, 'type'), method: get(data, 'request.method'), url: get(data, 'request.url') }), always: true },
  { key: 'params', label: 'Params', Component: VisualDiffParams, select: (data) => get(data, 'request.params', []) },
  { key: 'headers', label: 'Headers', Component: VisualDiffHeaders, select: (data) => get(data, 'request.headers', []) },
  { key: 'body', label: 'Body', Component: VisualDiffBody, select: (data) => get(data, 'request.body', {}) },
  { key: 'auth', label: 'Auth', Component: VisualDiffAuth, select: (data) => get(data, 'request.auth', {}) },
  { key: 'vars', label: 'Vars', Component: VarsDiff, select: (data) => get(data, 'request.vars', {}) },
  { key: 'scripts', label: 'Scripts', Component: ScriptsDiff, select: (data) => get(data, 'request.script', {}) },
  { key: 'assertions', label: 'Assert', Component: AssertionsDiff, select: (data) => get(data, 'request.assertions', []) },
  { key: 'tests', label: 'Tests', Component: TestsDiff, select: (data) => get(data, 'request.tests', '') },
  { key: 'docs', label: 'Docs', Component: DocsDiff, select: (data) => get(data, 'request.docs', '') },
  { key: 'settings', label: 'Settings', Component: SettingsDiff, select: (data) => ({ tags: get(data, 'tags', []), settings: get(data, 'settings', {}), app: get(data, 'app', {}) }) }
];

const GitRequestDiff = ({ commit, file, review, loading, requestedTab }) => {
  const oldParsed = review?.oldParsed || null;
  const newParsed = review?.newParsed || null;
  const isStructured = Boolean(oldParsed || newParsed);

  const tabs = useMemo(() => {
    if (!isStructured) {
      return [{
        key: 'raw',
        label: 'Raw',
        Component: RawDiff,
        changed: review?.oldContent !== review?.newContent,
        oldData: { raw: review?.oldContent || '' },
        newData: { raw: review?.newContent || '' }
      }];
    }

    return CONFIG
      .filter((tab) => tab.always || hasValue(tab.select(oldParsed)) || hasValue(tab.select(newParsed)))
      .map((tab) => ({
        ...tab,
        changed: !isEqual(tab.select(oldParsed), tab.select(newParsed)),
        oldData: oldParsed,
        newData: newParsed
      }));
  }, [isStructured, oldParsed, newParsed, review?.oldContent, review?.newContent]);

  const [activeTab, setActiveTab] = useState('request');

  useEffect(() => {
    const requested = requestedTab && tabs.find((tab) => tab.key === requestedTab);
    const firstChanged = tabs.find((tab) => tab.changed) || tabs[0];
    setActiveTab(requested?.key || firstChanged?.key || 'raw');
  }, [file?.path, commit?.hash, requestedTab, tabs]);

  const currentTab = tabs.find((tab) => tab.key === activeTab) || tabs[0];
  const sections = useMemo(() => currentTab ? [{
    key: currentTab.key,
    title: currentTab.label,
    Component: currentTab.Component,
    hasContent: () => true
  }] : [], [currentTab?.key, currentTab?.label, currentTab?.Component]);
  const sectionHasChanges = useCallback(() => true, []);

  if (!commit) {
    return <div className="diff-empty"><IconFileDiff size={28} /><strong>Select a commit</strong><span>Commit changes will appear here.</span></div>;
  }
  if (!file) {
    return <div className="diff-empty"><IconFileDiff size={28} /><strong>No collection files changed</strong><span>Choose another commit.</span></div>;
  }
  if (loading) {
    return <div className="loading-state diff-loading"><IconLoader2 className="spin" size={20} /> Loading request diff</div>;
  }
  if (!review || !currentTab) {
    return <div className="diff-empty"><IconFileDiff size={28} /><strong>Diff unavailable</strong><span>The file could not be compared.</span></div>;
  }

  return (
    <div className="request-diff">
      <div className="diff-file-header">
        <div>
          <strong title={file.collectionRelativePath}>{file.collectionRelativePath || file.path}</strong>
          <span>{commit.hash.slice(0, 8)} · {commit.message}</span>
        </div>
        <span className={`file-status ${file.status}`}>{file.status}</span>
      </div>

      <div className="diff-tabs">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.key}
            className={`${activeTab === tab.key ? 'active' : ''} ${tab.changed ? 'changed' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.changed && <span className="changed-dot" />}
          </button>
        ))}
      </div>

      <div className="diff-content-wrap">
        <VisualDiffContent
          oldData={currentTab.oldData}
          newData={currentTab.newData}
          sections={sections}
          sectionHasChanges={sectionHasChanges}
          oldLabel="Before"
          newLabel={`Commit ${commit.hash.slice(0, 8)}`}
        />
      </div>
    </div>
  );
};

export default GitRequestDiff;
