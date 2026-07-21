const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FlowCheckpointStore } = require('../../src/services/flow-checkpoint-store');

const encode = (value) => `test:${Buffer.from(value, 'utf8').toString('base64')}`;
const decodeSafe = (value) => {
  if (!value.startsWith('test:')) return { success: false, value: '', error: 'invalid' };
  return { success: true, value: Buffer.from(value.slice(5), 'base64').toString('utf8') };
};

const checkpoint = () => ({
  schemaVersion: 1,
  checkpointId: 'checkpoint_secret',
  runId: 'run_before_pause',
  rootFlowUid: 'flow_checkout',
  rootRevision: 'rev:checkout',
  nodeId: 'checkpoint_node',
  createdAt: '2026-07-20T00:00:00.000Z',
  journal: {
    request_payment: {
      executionKey: 'flow_checkout:root:request_payment',
      flowUid: 'flow_checkout',
      flowRevision: 'rev:checkout',
      nodeId: 'request_payment',
      scope: [],
      status: 'success',
      attempts: 1,
      sideEffect: 'once',
      resumePolicy: 'reuse',
      completedAt: '2026-07-20T00:00:00.000Z',
      output: {
        response: {
          value: { paymentId: 'pay_1', token: 'raw-checkpoint-secret' },
          secret: true,
          provenance: []
        }
      }
    }
  }
});

describe('FlowCheckpointStore', () => {
  let workspacePath;
  let store;

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-flow-checkpoint-'));
    store = new FlowCheckpointStore({ encrypt: encode, decryptSafe: decodeSafe });
  });

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('writes encrypted private checkpoints and restores the raw journal only in main process', async () => {
    const saved = await store.save({ workspacePath, checkpoint: checkpoint() });
    const rawFile = fs.readFileSync(saved.pathname, 'utf8');

    expect(rawFile).not.toContain('raw-checkpoint-secret');
    expect(fs.statSync(saved.pathname).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(saved.pathname)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.dirname(path.dirname(saved.pathname))).mode & 0o777).toBe(0o700);
    await expect(store.read({
      workspacePath,
      flowUid: 'flow_checkout',
      checkpointId: 'checkpoint_secret'
    })).resolves.toMatchObject({
      journal: {
        request_payment: {
          output: {
            response: { value: { token: 'raw-checkpoint-secret' } }
          }
        }
      }
    });
  });

  it('rejects checkpoint roots that escape through a workspace symlink', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-flow-checkpoint-outside-'));
    fs.mkdirSync(path.join(workspacePath, '.bruno'), { recursive: true });
    fs.symlinkSync(
      outside,
      path.join(workspacePath, '.bruno', 'flow-checkpoints'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    try {
      await expect(store.save({ workspacePath, checkpoint: checkpoint() })).rejects.toMatchObject({
        code: 'FLOW_CHECKPOINT_SYMLINK'
      });
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('lists safe metadata, deletes checkpoints, and fails closed for missing data', async () => {
    await store.save({ workspacePath, checkpoint: checkpoint() });
    await expect(store.list({ workspacePath, flowUid: 'flow_checkout' })).resolves.toEqual([
      expect.objectContaining({
        checkpointId: 'checkpoint_secret',
        flowUid: 'flow_checkout',
        revision: 'rev:checkout',
        journalEntries: 1,
        status: 'valid'
      })
    ]);
    const serializedList = JSON.stringify(await store.list({ workspacePath, flowUid: 'flow_checkout' }));
    expect(serializedList).not.toContain('raw-checkpoint-secret');

    await store.delete({ workspacePath, flowUid: 'flow_checkout', checkpointId: 'checkpoint_secret' });
    await expect(store.read({
      workspacePath,
      flowUid: 'flow_checkout',
      checkpointId: 'checkpoint_secret'
    })).rejects.toMatchObject({ code: 'FLOW_CHECKPOINT_NOT_FOUND' });
  });
});
