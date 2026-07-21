import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FlowRevisionConflictError, InvalidFlowPathError, serializeFlow } from '../src';
import { FlowStore, atomicWriteFile, type FlowWatchEvent, resolveFlowPath } from '../src/persistence';
import { createFixtureFlow } from './fixture';

const createWorkspace = async (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'bruno-flow-core-'));

const waitForEvent = (
  subscribe: (listener: (event: FlowWatchEvent) => void) => () => void,
  predicate: (event: FlowWatchEvent) => boolean,
  timeoutMs = 5000
): Promise<FlowWatchEvent> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    unsubscribe();
    reject(new Error('Timed out waiting for flow watcher event'));
  }, timeoutMs);
  const unsubscribe = subscribe((event) => {
    if (!predicate(event)) return;
    clearTimeout(timeout);
    unsubscribe();
    resolve(event);
  });
});

describe('FlowStore persistence gates', () => {
  let workspacePath: string;
  let tick: number;
  let store: FlowStore;

  beforeEach(async () => {
    workspacePath = await createWorkspace();
    tick = Date.parse('2026-07-20T10:00:00.000Z');
    store = new FlowStore({
      workspacePath,
      clock: () => new Date(tick += 1000)
    });
    await store.ensureDirectories();
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it('supports CRUD without a canvas', async () => {
    const created = await store.createFlow({
      relativePath: 'checkout.flow.yml',
      flow: {
        ...createFixtureFlow(),
        inputSchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
        outputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }
      }
    });
    expect(created.flow.name).toBe('Checkout flow');

    const catalog = await store.listFlows();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      uid: 'flow_checkout',
      relativePath: 'checkout.flow.yml',
      status: 'valid',
      inputSchema: { properties: { email: { type: 'string' } }, required: ['email'] },
      outputSchema: { properties: { userId: { type: 'string' } }, required: ['userId'] }
    });

    const updated = await store.saveFlow({
      relativePath: 'checkout.flow.yml',
      expectedRevision: created.flow.revision,
      flow: { ...created.flow, name: 'Checkout v2' }
    });
    expect(updated.flow.name).toBe('Checkout v2');
    expect(updated.flow.revision).not.toBe(created.flow.revision);

    const moved = await store.moveFlow({
      fromRelativePath: 'checkout.flow.yml',
      toRelativePath: 'shared/checkout.flow.yml',
      expectedRevision: updated.flow.revision
    });
    expect(moved.relativePath).toBe('shared/checkout.flow.yml');

    await store.deleteFlow('shared/checkout.flow.yml', moved.flow.revision);
    expect(await store.listFlows()).toEqual([]);
  });

  it('rejects flow paths that escape through a symlinked directory', async () => {
    const outsideDirectory = path.join(workspacePath, 'outside-flows');
    const linkedDirectory = path.join(workspacePath, 'flows', 'escape');
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.symlink(
      outsideDirectory,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(store.createFlow({
      relativePath: 'escape/escaped.flow.yml',
      flow: createFixtureFlow()
    })).rejects.toBeInstanceOf(InvalidFlowPathError);
    await expect(fs.access(path.join(outsideDirectory, 'escaped.flow.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the target unchanged when the atomic pre-commit check detects a conflict', async () => {
    const pathname = path.join(workspacePath, 'atomic.txt');
    await fs.writeFile(pathname, 'external content', 'utf8');

    await expect(atomicWriteFile(pathname, 'local content', {
      beforeCommit: () => {
        throw new FlowRevisionConflictError(pathname, 'old', 'external');
      }
    })).rejects.toBeInstanceOf(FlowRevisionConflictError);

    expect(await fs.readFile(pathname, 'utf8')).toBe('external content');
    expect((await fs.readdir(workspacePath)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('detects external edits and refuses to overwrite the file on conflict', async () => {
    const created = await store.createFlow({
      relativePath: 'checkout.flow.yml',
      flow: createFixtureFlow()
    });
    const pathname = resolveFlowPath(workspacePath, 'checkout.flow.yml');
    const externalContent = created.content.replace('name: Checkout flow', 'name: External editor');
    await fs.writeFile(pathname, externalContent, 'utf8');

    await expect(store.saveFlow({
      relativePath: 'checkout.flow.yml',
      expectedRevision: created.flow.revision,
      flow: { ...created.flow, name: 'Local overwrite attempt' }
    })).rejects.toBeInstanceOf(FlowRevisionConflictError);

    const contentAfterConflict = await fs.readFile(pathname, 'utf8');
    expect(contentAfterConflict).toBe(externalContent);
    expect(contentAfterConflict).toContain('name: External editor');
    expect(contentAfterConflict).not.toContain('Local overwrite attempt');
  });

  it('emits catalog events for external create and change operations', async () => {
    const watcher = store.createWatcher({
      ignoreInitial: true,
      stabilityThresholdMs: 20,
      pollIntervalMs: 10
    });
    await watcher.start();

    const subscribe = (listener: (event: FlowWatchEvent) => void): (() => void) => {
      watcher.on('event', listener);
      return () => watcher.off('event', listener);
    };

    try {
      const pathname = resolveFlowPath(workspacePath, 'external.flow.yml');
      const createdEventPromise = waitForEvent(subscribe, (event) => event.type === 'created');
      await fs.writeFile(pathname, serializeFlow(createFixtureFlow('External flow')), 'utf8');
      const createdEvent = await createdEventPromise;
      expect(createdEvent.entry).toMatchObject({ name: 'External flow', status: 'valid' });

      const changedEventPromise = waitForEvent(subscribe, (event) => event.type === 'changed');
      await fs.writeFile(pathname, serializeFlow(createFixtureFlow('External flow v2')), 'utf8');
      const changedEvent = await changedEventPromise;
      expect(changedEvent.entry?.name).toBe('External flow v2');
      expect(changedEvent.entry?.revision).not.toBe(createdEvent.entry?.revision);

      const validV2Content = serializeFlow(createFixtureFlow('External flow v2'));
      const invalidEventPromise = waitForEvent(subscribe, (event) => event.type === 'invalid');
      await fs.writeFile(pathname, 'schemaVersion: [broken', 'utf8');
      const invalidEvent = await invalidEventPromise;
      expect(invalidEvent.entry?.status).toBe('invalid');

      const restoredEventPromise = waitForEvent(
        subscribe,
        (event) => event.type === 'changed' && event.entry?.status === 'valid'
      );
      await fs.writeFile(pathname, validV2Content, 'utf8');
      const restoredEvent = await restoredEventPromise;
      expect(restoredEvent.entry?.revision).toBe(changedEvent.entry?.revision);
    } finally {
      await watcher.close();
    }
  });

  it('recovers drafts and marks a changed base file as conflicted', async () => {
    const created = await store.createFlow({
      relativePath: 'checkout.flow.yml',
      flow: createFixtureFlow()
    });
    await store.saveDraft({
      flowUid: created.flow.uid,
      relativePath: created.relativePath,
      baseRevision: created.flow.revision,
      flow: { ...created.flow, name: 'Unsaved draft' }
    });

    const pathname = resolveFlowPath(workspacePath, created.relativePath);
    await fs.writeFile(pathname, created.content.replace('name: Checkout flow', 'name: External edit'), 'utf8');

    const recovery = await store.recoverDraft(created.flow.uid);
    expect(recovery.hasConflict).toBe(true);
    expect((recovery.draft.flow as { name: string }).name).toBe('Unsaved draft');
    expect(await store.listDrafts()).toHaveLength(1);

    await store.discardDraft(created.flow.uid);
    expect(await store.listDrafts()).toEqual([]);
  });
});
