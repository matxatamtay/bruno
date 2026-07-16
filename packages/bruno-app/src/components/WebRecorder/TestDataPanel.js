import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IconDownload, IconPlus, IconRefresh, IconTrash, IconUpload } from '@tabler/icons';
import toast from 'react-hot-toast';
import { collectionIdentity, pretty, requestDescriptors } from './intelligence-utils';
import useIntelligenceEvents from './useIntelligenceEvents';

const defaultProfile = () => ({
  name: 'Replay data',
  seed: 'stable-seed',
  datasetMode: 'single',
  generators: {
    email: { type: 'randomEmail', options: { prefix: 'replay', domain: 'example.com' } },
    runId: { type: 'uuid', options: {} }
  },
  datasets: [{ id: 'default', name: 'Default dataset', rows: [{}] }],
  activeDatasetId: 'default',
  setupSteps: [],
  cleanupSteps: [],
  files: []
});

const TestDataPanel = ({ collection }) => {
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [generatorsText, setGeneratorsText] = useState('{}');
  const [datasetsText, setDatasetsText] = useState('[]');
  const [preview, setPreview] = useState(null);
  const [requestToAdd, setRequestToAdd] = useState('');
  const [fixtures, setFixtures] = useState([]);
  const [fixtureName, setFixtureName] = useState('payload.json');
  const [fixtureType, setFixtureType] = useState('json');
  const [fixtureContent, setFixtureContent] = useState('{\n  "ok": true\n}');
  const identity = useMemo(() => collectionIdentity(collection), [collection]);
  const requests = useMemo(() => requestDescriptors(collection), [collection.items]);

  const refresh = useCallback(async () => {
    const [next, nextFixtures] = await Promise.all([
      window.ipcRenderer.invoke('renderer:api-intelligence:list-test-data', identity),
      window.ipcRenderer.invoke('renderer:api-intelligence:list-fixtures', identity)
    ]);
    setProfiles(next || []);
    setFixtures(nextFixtures || []);
    if (!selectedId && next?.[0]) setSelectedId(next[0].profileId);
  }, [identity, selectedId]);

  useEffect(() => { refresh().catch((error) => toast.error(error.message)); }, [refresh]);
  useIntelligenceEvents(identity, ['test-data', 'bundle'], () => refresh().catch(() => {}));
  useEffect(() => {
    if (!selectedId) {
      setProfile(null); return;
    }
    window.ipcRenderer.invoke('renderer:api-intelligence:get-test-data', { collection: identity, profileId: selectedId }).then((next) => {
      setProfile(next);
      setGeneratorsText(pretty(next?.generators || {}));
      setDatasetsText(pretty(next?.datasets || []));
      setPreview(null);
    });
  }, [identity, selectedId]);

  const create = async () => {
    const saved = await window.ipcRenderer.invoke('renderer:api-intelligence:save-test-data', { collection: identity, profile: defaultProfile() });
    await refresh();
    setSelectedId(saved.profileId);
  };

  const save = async () => {
    try {
      const next = { ...profile, generators: JSON.parse(generatorsText || '{}'), datasets: JSON.parse(datasetsText || '[]') };
      const saved = await window.ipcRenderer.invoke('renderer:api-intelligence:save-test-data', { collection: identity, profile: next });
      setProfile(saved);
      await refresh();
      toast.success('Test data profile saved locally');
    } catch (error) {
      toast.error(error instanceof SyntaxError ? 'Generators or datasets contain invalid JSON' : error.message);
    }
  };

  const materialize = async () => {
    try {
      const candidate = { ...profile, generators: JSON.parse(generatorsText || '{}'), datasets: JSON.parse(datasetsText || '[]') };
      setPreview(await window.ipcRenderer.invoke('renderer:api-intelligence:materialize-test-data', { profile: candidate, seed: candidate.seed }));
    } catch (error) { toast.error(error.message); }
  };

  const remove = async () => {
    if (!profile || !window.confirm(`Delete local test data profile “${profile.name}”?`)) return;
    await window.ipcRenderer.invoke('renderer:api-intelligence:delete-test-data', { collection: identity, profileId: profile.profileId });
    setSelectedId(null); setProfile(null); await refresh();
  };

  const importProfile = async () => {
    const result = await window.ipcRenderer.invoke('renderer:api-intelligence:import-test-data', identity);
    if (!result?.canceled) {
      await refresh(); setSelectedId(result.profile.profileId);
    }
  };
  const exportProfile = async () => {
    const result = await window.ipcRenderer.invoke('renderer:api-intelligence:export-test-data', { collection: identity, profileId: profile.profileId });
    if (!result?.canceled) toast.success('Test data profile exported');
  };

  const importDataset = async () => {
    try {
      const result = await window.ipcRenderer.invoke('renderer:api-intelligence:import-dataset');
      if (result?.canceled) return;
      const datasets = JSON.parse(datasetsText || '[]');
      const next = [...datasets, result.dataset];
      setDatasetsText(pretty(next));
      setProfile({ ...profile, activeDatasetId: result.dataset.id });
      toast.success(`Imported ${result.dataset.rows.length} dataset rows`);
    } catch (error) { toast.error(error.message || 'Unable to import dataset'); }
  };

  const exportDataset = async (format) => {
    try {
      const datasets = JSON.parse(datasetsText || '[]');
      const dataset = datasets.find((candidate) => candidate.id === profile.activeDatasetId) || datasets[0];
      if (!dataset) return toast.error('No dataset is available to export');
      const result = await window.ipcRenderer.invoke('renderer:api-intelligence:export-dataset', { dataset, format });
      if (!result?.canceled) toast.success('Dataset exported');
    } catch (error) { toast.error(error.message || 'Unable to export dataset'); }
  };

  const saveFixture = async () => {
    try {
      const fixture = await window.ipcRenderer.invoke('renderer:api-intelligence:save-fixture', {
        collection: identity,
        fixture: { name: fixtureName, type: fixtureType, content: fixtureContent }
      });
      setProfile({ ...profile, files: [...new Set([...(profile.files || []), fixture.id])] });
      await refresh();
      toast.success('Local fixture saved');
    } catch (error) { toast.error(error.message || 'Unable to save fixture'); }
  };

  const deleteFixture = async (fixtureId) => {
    await window.ipcRenderer.invoke('renderer:api-intelligence:delete-fixture', { collection: identity, fixtureId });
    setProfile({ ...profile, files: (profile.files || []).filter((id) => id !== fixtureId) });
    await refresh();
  };

  const addLifecycle = (phase) => {
    const request = requests.find((candidate) => candidate.uid === requestToAdd);
    if (!request) return;
    const key = phase === 'setup' ? 'setupSteps' : 'cleanupSteps';
    setProfile({ ...profile, [key]: [...(profile[key] || []), { id: `${phase}-${Date.now()}`, requestUid: request.uid, name: request.name, continueOnFailure: phase === 'cleanup' }] });
    setRequestToAdd('');
  };

  const removeLifecycle = (phase, id) => {
    const key = phase === 'setup' ? 'setupSteps' : 'cleanupSteps';
    setProfile({ ...profile, [key]: (profile[key] || []).filter((step) => step.id !== id) });
  };

  return (
    <div className="test-data-layout">
      <aside className="intelligence-sidebar">
        <div className="replay-toolbar"><button className="button primary" onClick={create}><IconPlus size={14} /> New profile</button><button className="button" onClick={importProfile}><IconUpload size={14} /> Import</button></div>
        {profiles.map((item) => <button key={item.profileId} className={`replay-scenario-row ${selectedId === item.profileId ? 'selected' : ''}`} onClick={() => setSelectedId(item.profileId)}><strong>{item.name}</strong><span>{Object.keys(item.generators || {}).length} generators · {item.datasets?.length || 0} datasets</span></button>)}
        {!profiles.length && <div className="empty-state"><strong>No test data profiles</strong></div>}
      </aside>
      <main className="test-data-editor">
        {!profile ? <div className="empty-state"><strong>Select or create a profile</strong></div> : (
          <>
            <div className="intelligence-toolbar">
              <div><strong>Test Data Studio</strong><span>Deterministic generators, datasets and always-run cleanup outside the collection.</span></div>
              <div className="intelligence-actions"><button className="button" onClick={materialize}><IconRefresh size={14} /> Preview</button><button className="button" onClick={exportProfile}><IconDownload size={14} /> Export</button><button className="button danger" onClick={remove}><IconTrash size={14} /></button><button className="button primary" onClick={save}>Save</button></div>
            </div>
            <div className="test-data-form">
              <label>Name<input value={profile.name || ''} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
              <label>Seed<input value={profile.seed || ''} onChange={(event) => setProfile({ ...profile, seed: event.target.value })} /></label>
              <label>Dataset mode<select value={profile.datasetMode || 'single'} onChange={(event) => setProfile({ ...profile, datasetMode: event.target.value })}><option value="single">Single</option><option value="iterate">Iterate</option><option value="random">Random</option></select></label>
              <label className="wide">Generators JSON<textarea value={generatorsText} onChange={(event) => setGeneratorsText(event.target.value)} /></label>
              <label className="wide">
                Datasets JSON
                <div className="test-data-inline-actions"><button className="button" onClick={importDataset}><IconUpload size={13} /> Import CSV/JSON</button><button className="button" onClick={() => exportDataset('csv')}><IconDownload size={13} /> CSV</button><button className="button" onClick={() => exportDataset('json')}><IconDownload size={13} /> JSON</button></div>
                <textarea value={datasetsText} onChange={(event) => setDatasetsText(event.target.value)} />
              </label>
              <div className="wide fixture-editor">
                <strong>Local file fixtures</strong>
                <div><input value={fixtureName} onChange={(event) => setFixtureName(event.target.value)} placeholder="payload.json" /><select value={fixtureType} onChange={(event) => setFixtureType(event.target.value)}><option value="text">Text</option><option value="json">JSON</option><option value="csv">CSV</option><option value="binary-placeholder">Binary placeholder</option></select><button className="button" onClick={saveFixture}><IconPlus size={13} /> Save fixture</button></div>
                <textarea value={fixtureContent} onChange={(event) => setFixtureContent(event.target.value)} />
                <section>{fixtures.map((fixture) => <span key={fixture.id}><code>{fixture.name}</code><small>{fixture.type} · {fixture.size} bytes</small><button className="button danger" onClick={() => deleteFixture(fixture.id)}><IconTrash size={12} /></button></span>)}</section>
              </div>
              <div className="wide lifecycle-editor">
                <strong>Setup / cleanup linked requests</strong>
                <div><select value={requestToAdd} onChange={(event) => setRequestToAdd(event.target.value)}><option value="">Select request…</option>{requests.map((request) => <option key={request.uid} value={request.uid}>{request.request.method || 'GET'} · {request.name}</option>)}</select><button className="button" disabled={!requestToAdd} onClick={() => addLifecycle('setup')}>Add setup</button><button className="button" disabled={!requestToAdd} onClick={() => addLifecycle('cleanup')}>Add cleanup</button></div>
                <section><span>Setup</span>{(profile.setupSteps || []).map((step) => <button key={step.id} onClick={() => removeLifecycle('setup', step.id)}>{step.name} ×</button>)}</section>
                <section><span>Cleanup</span>{(profile.cleanupSteps || []).map((step) => <button key={step.id} onClick={() => removeLifecycle('cleanup', step.id)}>{step.name} ×</button>)}</section>
              </div>
              {preview && <div className="wide"><strong>Deterministic run preview</strong><pre>{pretty(preview)}</pre></div>}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default TestDataPanel;
