const fs = require('node:fs/promises');
const path = require('node:path');
const { encryptString, decryptStringSafe } = require('../utils/encryption');

const CHECKPOINT_VERSION = 1;
const MAX_CHECKPOINT_BYTES = 20 * 1024 * 1024;

const assertWorkspacePath = (workspacePath) => {
  if (!workspacePath || typeof workspacePath !== 'string') {
    throw new TypeError('workspacePath is required');
  }
  return path.resolve(workspacePath);
};

const safeSegment = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    throw new TypeError(`${label} is invalid`);
  }
  return encodeURIComponent(normalized);
};

const isInsideDirectory = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const assertCheckpointPathSafe = async (workspacePath, checkpointRoot, { create = false } = {}) => {
  const workspace = assertWorkspacePath(workspacePath);
  const relative = path.relative(workspace, checkpointRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Checkpoint root escapes workspace');
  let current = workspace;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        const error = new Error(`Checkpoint path contains a symbolic link: ${current}`);
        error.code = 'FLOW_CHECKPOINT_SYMLINK';
        throw error;
      }
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
  if (create) await fs.mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  try {
    const [workspaceReal, rootReal] = await Promise.all([fs.realpath(workspace), fs.realpath(checkpointRoot)]);
    if (!isInsideDirectory(workspaceReal, rootReal)) {
      const error = new Error('Checkpoint root resolves outside workspace');
      error.code = 'FLOW_CHECKPOINT_PATH_ESCAPE';
      throw error;
    }
  } catch (error) {
    if (error?.code === 'ENOENT' && !create) return;
    throw error;
  }
};

const assertRegularCheckpointFile = async (pathname) => {
  const stat = await fs.lstat(pathname);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    const error = new Error('Checkpoint must be a regular file');
    error.code = 'FLOW_CHECKPOINT_INVALID_FILE';
    throw error;
  }
};

const atomicWritePrivate = async (pathname, content) => {
  const directory = path.dirname(pathname);
  const temporaryPath = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(temporaryPath, content, { mode: 0o600 });
    await fs.rename(temporaryPath, pathname);
    await fs.chmod(pathname, 0o600).catch(() => null);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => null);
  }
};

class FlowCheckpointStore {
  constructor({ encrypt = encryptString, decryptSafe = decryptStringSafe } = {}) {
    this.encrypt = encrypt;
    this.decryptSafe = decryptSafe;
  }

  getRoot(workspacePath) {
    return path.join(assertWorkspacePath(workspacePath), '.bruno', 'flow-checkpoints');
  }

  getFlowDirectory(workspacePath, flowUid) {
    return path.join(this.getRoot(workspacePath), safeSegment(flowUid, 'flowUid'));
  }

  getCheckpointPath(workspacePath, flowUid, checkpointId) {
    const root = this.getRoot(workspacePath);
    const pathname = path.join(
      this.getFlowDirectory(workspacePath, flowUid),
      `${safeSegment(checkpointId, 'checkpointId')}.checkpoint.enc`
    );
    if (!isInsideDirectory(root, pathname)) throw new Error('Checkpoint path escapes workspace');
    return pathname;
  }

  async save({ workspacePath, checkpoint }) {
    if (!checkpoint || checkpoint.schemaVersion !== CHECKPOINT_VERSION) {
      throw new TypeError('A version 1 checkpoint is required');
    }
    if (!checkpoint.rootFlowUid || !checkpoint.checkpointId) {
      throw new TypeError('Checkpoint requires rootFlowUid and checkpointId');
    }
    const pathname = this.getCheckpointPath(workspacePath, checkpoint.rootFlowUid, checkpoint.checkpointId);
    const checkpointRoot = this.getRoot(workspacePath);
    const flowDirectory = path.dirname(pathname);
    await assertCheckpointPathSafe(workspacePath, checkpointRoot, { create: true });
    await assertCheckpointPathSafe(workspacePath, flowDirectory, { create: true });
    await Promise.all([
      fs.chmod(checkpointRoot, 0o700).catch(() => null),
      fs.chmod(flowDirectory, 0o700).catch(() => null)
    ]);
    const serialized = JSON.stringify(checkpoint);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CHECKPOINT_BYTES) {
      const error = new Error(`Flow checkpoint exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
      error.code = 'FLOW_CHECKPOINT_TOO_LARGE';
      throw error;
    }
    const encrypted = this.encrypt(serialized);
    if (!encrypted) throw new Error('Unable to encrypt flow checkpoint');
    await atomicWritePrivate(pathname, `${encrypted}\n`);
    return {
      checkpointId: checkpoint.checkpointId,
      flowUid: checkpoint.rootFlowUid,
      pathname
    };
  }

  async read({ workspacePath, flowUid, checkpointId }) {
    const pathname = this.getCheckpointPath(workspacePath, flowUid, checkpointId);
    await assertCheckpointPathSafe(workspacePath, path.dirname(pathname));
    let encrypted;
    try {
      await assertRegularCheckpointFile(pathname);
      encrypted = (await fs.readFile(pathname, 'utf8')).trim();
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const missing = new Error(`Flow checkpoint ${checkpointId} was not found`);
        missing.code = 'FLOW_CHECKPOINT_NOT_FOUND';
        throw missing;
      }
      throw error;
    }
    const decrypted = this.decryptSafe(encrypted);
    if (!decrypted.success) {
      const error = new Error(`Unable to decrypt flow checkpoint ${checkpointId}`);
      error.code = 'FLOW_CHECKPOINT_DECRYPT_FAILED';
      throw error;
    }
    let checkpoint;
    try {
      checkpoint = JSON.parse(decrypted.value);
    } catch (_) {
      const error = new Error(`Flow checkpoint ${checkpointId} is invalid`);
      error.code = 'FLOW_CHECKPOINT_INVALID';
      throw error;
    }
    if (checkpoint?.schemaVersion !== CHECKPOINT_VERSION || checkpoint.rootFlowUid !== flowUid || checkpoint.checkpointId !== checkpointId) {
      const error = new Error(`Flow checkpoint ${checkpointId} metadata does not match its path`);
      error.code = 'FLOW_CHECKPOINT_INVALID';
      throw error;
    }
    return checkpoint;
  }

  async list({ workspacePath, flowUid }) {
    const directory = this.getFlowDirectory(workspacePath, flowUid);
    await assertCheckpointPathSafe(workspacePath, directory);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const checkpoints = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.checkpoint.enc'))
      .map(async (entry) => {
        let checkpointId;
        try {
          checkpointId = decodeURIComponent(entry.name.slice(0, -'.checkpoint.enc'.length));
        } catch (_) {
          return {
            checkpointId: entry.name,
            flowUid,
            createdAt: null,
            journalEntries: 0,
            status: 'invalid',
            error: 'Checkpoint filename is invalid'
          };
        }
        try {
          const checkpoint = await this.read({ workspacePath, flowUid, checkpointId });
          return {
            checkpointId,
            runId: checkpoint.runId,
            flowUid: checkpoint.rootFlowUid,
            revision: checkpoint.rootRevision,
            nodeId: checkpoint.nodeId,
            createdAt: checkpoint.createdAt,
            journalEntries: Object.keys(checkpoint.journal || {}).length,
            status: 'valid'
          };
        } catch (error) {
          return {
            checkpointId,
            flowUid,
            createdAt: null,
            journalEntries: 0,
            status: 'invalid',
            error: error.message
          };
        }
      }));
    return checkpoints.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  }

  async delete({ workspacePath, flowUid, checkpointId }) {
    const pathname = this.getCheckpointPath(workspacePath, flowUid, checkpointId);
    await assertCheckpointPathSafe(workspacePath, path.dirname(pathname));
    await fs.rm(pathname, { force: true });
    return { checkpointId, flowUid };
  }
}

module.exports = {
  CHECKPOINT_VERSION,
  MAX_CHECKPOINT_BYTES,
  FlowCheckpointStore,
  assertCheckpointPathSafe,
  assertRegularCheckpointFile,
  assertWorkspacePath,
  atomicWritePrivate,
  isInsideDirectory
};
