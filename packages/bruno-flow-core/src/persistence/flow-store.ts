import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FlowAlreadyExistsError,
  FlowDraftNotFoundError,
  FlowNotFoundError,
  FlowRevisionConflictError,
  FlowRevisionRequiredError
} from '../errors';
import { sha256Hex } from '../hash';
import { parseFlowDocument } from '../parser';
import { serializeFlowDocument } from '../serializer';
import type { FlowDefinition, FlowDefinitionInput } from '../types';
import { atomicWriteFile, withPathLock, withPathLocks } from './atomic-write';
import {
  assertFlowPathWithinWorkspace,
  getFlowDraftsDirectory,
  getFlowsDirectory,
  isFlowFile,
  normalizeFlowRelativePath,
  resolveFlowPath,
  toFlowRelativePath
} from './paths';
import type {
  FlowCatalogEntry,
  FlowDraftEnvelope,
  FlowRecord,
  RecoveredFlowDraft
} from './types';
import { FlowWatcher, type FlowWatcherOptions } from './flow-watcher';

export interface FlowStoreOptions {
  workspacePath: string;
  clock?: () => Date;
}

export interface CreateFlowOptions {
  relativePath: string;
  flow: FlowDefinitionInput | FlowDefinition | Record<string, unknown>;
}

export interface SaveFlowOptions extends CreateFlowOptions {
  expectedRevision?: string;
}

export interface MoveFlowOptions {
  fromRelativePath: string;
  toRelativePath: string;
  expectedRevision?: string;
}

export interface SaveDraftOptions {
  draftUid?: string;
  flowUid: string;
  relativePath: string;
  baseRevision: string | null;
  flow: unknown;
}

const fileExists = async (pathname: string): Promise<boolean> => {
  try {
    await fs.access(pathname);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
};

const listFilesRecursively = async (directory: string): Promise<string[]> => {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return [];
    throw error;
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const pathname = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFilesRecursively(pathname);
    return entry.isFile() && isFlowFile(pathname) ? [pathname] : [];
  }));
  return nested.flat().sort((left, right) => left.localeCompare(right));
};

const sanitizeDraftUid = (draftUid: string): string => encodeURIComponent(draftUid);

export class FlowStore {
  readonly workspacePath: string;
  readonly clock: () => Date;

  constructor(options: FlowStoreOptions) {
    this.workspacePath = path.resolve(options.workspacePath);
    this.clock = options.clock || (() => new Date());
  }

  get flowsDirectory(): string {
    return getFlowsDirectory(this.workspacePath);
  }

  get draftsDirectory(): string {
    return getFlowDraftsDirectory(this.workspacePath);
  }

  async ensureDirectories(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.flowsDirectory, { recursive: true }),
      fs.mkdir(this.draftsDirectory, { recursive: true })
    ]);
  }

  private async readRecordByPath(pathname: string): Promise<FlowRecord> {
    let content: string;
    try {
      content = await fs.readFile(pathname, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') throw new FlowNotFoundError(pathname);
      throw error;
    }

    const parsed = parseFlowDocument(content);
    return {
      relativePath: toFlowRelativePath(this.workspacePath, pathname),
      pathname,
      content,
      flow: parsed.flow,
      storedRevision: parsed.storedRevision,
      revisionMismatch: parsed.revisionMismatch
    };
  }

  private async resolveSafeFlowPath(relativePath: string): Promise<string> {
    const pathname = resolveFlowPath(this.workspacePath, relativePath);
    await assertFlowPathWithinWorkspace(this.workspacePath, pathname);
    return pathname;
  }

  async readFlow(relativePath: string): Promise<FlowRecord> {
    return this.readRecordByPath(await this.resolveSafeFlowPath(relativePath));
  }

  private async currentRevision(pathname: string): Promise<string | null> {
    let content: string;
    try {
      content = await fs.readFile(pathname, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }

    try {
      return parseFlowDocument(content).flow.revision;
    } catch (_) {
      return `raw-sha256:${sha256Hex(content)}`;
    }
  }

  private async assertExpectedRevision(pathname: string, expectedRevision?: string): Promise<string> {
    if (!expectedRevision) throw new FlowRevisionRequiredError(pathname);
    const actualRevision = await this.currentRevision(pathname);
    if (actualRevision === null) throw new FlowNotFoundError(pathname);
    if (actualRevision !== expectedRevision) {
      throw new FlowRevisionConflictError(pathname, expectedRevision, actualRevision);
    }
    return actualRevision;
  }

  async listFlows(): Promise<FlowCatalogEntry[]> {
    const pathnames = await listFilesRecursively(this.flowsDirectory);
    return Promise.all(pathnames.map(async (pathname) => {
      const relativePath = toFlowRelativePath(this.workspacePath, pathname);
      try {
        const record = await this.readRecordByPath(pathname);
        return {
          uid: record.flow.uid,
          name: record.flow.name,
          relativePath,
          pathname,
          revision: record.flow.revision,
          updatedAt: record.flow.metadata.updatedAt,
          tags: record.flow.metadata.tags || [],
          inputSchema: record.flow.inputSchema,
          outputSchema: record.flow.outputSchema,
          status: 'valid' as const
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          uid: null,
          name: relativePath,
          relativePath,
          pathname,
          revision: null,
          updatedAt: null,
          tags: [],
          status: 'invalid' as const,
          error: message
        };
      }
    }));
  }

  async createFlow(options: CreateFlowOptions): Promise<FlowRecord> {
    const pathname = await this.resolveSafeFlowPath(options.relativePath);
    return withPathLock(pathname, async () => {
      if (await fileExists(pathname)) throw new FlowAlreadyExistsError(pathname);
      const timestamp = this.clock().toISOString();
      const source = options.flow as Record<string, unknown>;
      const metadata = source.metadata && typeof source.metadata === 'object'
        ? source.metadata as Record<string, unknown>
        : {};
      const serialized = serializeFlowDocument({
        ...source,
        metadata: {
          ...metadata,
          createdAt: metadata.createdAt || timestamp,
          updatedAt: timestamp
        }
      });
      await atomicWriteFile(pathname, serialized.content, {
        beforeCommit: async () => {
          await assertFlowPathWithinWorkspace(this.workspacePath, pathname);
          if (await fileExists(pathname)) throw new FlowAlreadyExistsError(pathname);
        }
      });
      return this.readRecordByPath(pathname);
    });
  }

  async saveFlow(options: SaveFlowOptions): Promise<FlowRecord> {
    const pathname = await this.resolveSafeFlowPath(options.relativePath);
    return withPathLock(pathname, async () => {
      await this.assertExpectedRevision(pathname, options.expectedRevision);
      const current = await this.readRecordByPath(pathname);
      const source = options.flow as Record<string, unknown>;
      const metadata = source.metadata && typeof source.metadata === 'object'
        ? source.metadata as Record<string, unknown>
        : {};
      const serialized = serializeFlowDocument({
        ...source,
        uid: source.uid || current.flow.uid,
        workspace: source.workspace || current.flow.workspace,
        metadata: {
          ...metadata,
          createdAt: current.flow.metadata.createdAt,
          updatedAt: this.clock().toISOString()
        }
      });
      await atomicWriteFile(pathname, serialized.content, {
        beforeCommit: async () => {
          await assertFlowPathWithinWorkspace(this.workspacePath, pathname);
          await this.assertExpectedRevision(pathname, options.expectedRevision);
        }
      });
      return this.readRecordByPath(pathname);
    });
  }

  async deleteFlow(relativePath: string, expectedRevision?: string): Promise<void> {
    const pathname = await this.resolveSafeFlowPath(relativePath);
    await withPathLock(pathname, async () => {
      await this.assertExpectedRevision(pathname, expectedRevision);
      await fs.unlink(pathname);
    });
  }

  async moveFlow(options: MoveFlowOptions): Promise<FlowRecord> {
    const fromPath = await this.resolveSafeFlowPath(options.fromRelativePath);
    const toPath = await this.resolveSafeFlowPath(options.toRelativePath);
    return withPathLocks([fromPath, toPath], async () => {
      await this.assertExpectedRevision(fromPath, options.expectedRevision);
      if (await fileExists(toPath)) throw new FlowAlreadyExistsError(toPath);
      await fs.mkdir(path.dirname(toPath), { recursive: true });
      await Promise.all([
        assertFlowPathWithinWorkspace(this.workspacePath, fromPath),
        assertFlowPathWithinWorkspace(this.workspacePath, toPath),
        this.assertExpectedRevision(fromPath, options.expectedRevision)
      ]);
      try {
        await fs.link(fromPath, toPath);
      } catch (error) {
        if ((error as { code?: string }).code === 'EEXIST') throw new FlowAlreadyExistsError(toPath);
        throw error;
      }
      await fs.unlink(fromPath);
      return this.readRecordByPath(toPath);
    });
  }

  private draftPath(draftUid: string): string {
    return path.join(this.draftsDirectory, `${sanitizeDraftUid(draftUid)}.draft.json`);
  }

  async saveDraft(options: SaveDraftOptions): Promise<FlowDraftEnvelope> {
    const draftUid = options.draftUid || options.flowUid;
    const envelope: FlowDraftEnvelope = {
      draftVersion: 1,
      draftUid,
      flowUid: options.flowUid,
      relativePath: normalizeFlowRelativePath(options.relativePath),
      baseRevision: options.baseRevision,
      savedAt: this.clock().toISOString(),
      flow: options.flow
    };
    const pathname = this.draftPath(draftUid);
    await withPathLock(pathname, () => atomicWriteFile(pathname, `${JSON.stringify(envelope, null, 2)}\n`));
    return envelope;
  }

  async listDrafts(): Promise<FlowDraftEnvelope[]> {
    let entries;
    try {
      entries = await fs.readdir(this.draftsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw error;
    }

    const drafts = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.draft.json'))
      .map(async (entry) => JSON.parse(await fs.readFile(path.join(this.draftsDirectory, entry.name), 'utf8')) as FlowDraftEnvelope));
    return drafts.sort((left, right) => left.savedAt.localeCompare(right.savedAt));
  }

  async recoverDraft(draftUid: string): Promise<RecoveredFlowDraft> {
    const pathname = this.draftPath(draftUid);
    let draft: FlowDraftEnvelope;
    try {
      draft = JSON.parse(await fs.readFile(pathname, 'utf8')) as FlowDraftEnvelope;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') throw new FlowDraftNotFoundError(draftUid);
      throw error;
    }

    const currentRevision = await this.currentRevision(await this.resolveSafeFlowPath(draft.relativePath));
    return {
      draft,
      currentRevision,
      hasConflict: draft.baseRevision !== currentRevision
    };
  }

  async applyDraft(draftUid: string): Promise<FlowRecord> {
    const recovery = await this.recoverDraft(draftUid);
    const exists = recovery.currentRevision !== null;
    let record: FlowRecord;
    if (exists) {
      record = await this.saveFlow({
        relativePath: recovery.draft.relativePath,
        flow: recovery.draft.flow as Record<string, unknown>,
        expectedRevision: recovery.draft.baseRevision || undefined
      });
    } else {
      record = await this.createFlow({
        relativePath: recovery.draft.relativePath,
        flow: recovery.draft.flow as Record<string, unknown>
      });
    }
    await this.discardDraft(draftUid);
    return record;
  }

  async discardDraft(draftUid: string): Promise<void> {
    await fs.rm(this.draftPath(draftUid), { force: true });
  }

  createWatcher(options: FlowWatcherOptions = {}): FlowWatcher {
    return new FlowWatcher(this.workspacePath, options);
  }
}
