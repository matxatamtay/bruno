import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { parseFlowDocument } from '../parser';
import { getFlowsDirectory, isFlowFile, toFlowRelativePath } from './paths';
import type { FlowCatalogEntry, FlowWatchEvent } from './types';

export interface FlowWatcherOptions {
  ignoreInitial?: boolean;
  stabilityThresholdMs?: number;
  pollIntervalMs?: number;
  usePolling?: boolean;
  onEvent?: (event: FlowWatchEvent) => void;
}

const toEntry = (
  workspacePath: string,
  pathname: string,
  content: string
): FlowCatalogEntry => {
  const parsed = parseFlowDocument(content);
  return {
    uid: parsed.flow.uid,
    name: parsed.flow.name,
    relativePath: toFlowRelativePath(workspacePath, pathname),
    pathname,
    revision: parsed.flow.revision,
    updatedAt: parsed.flow.metadata.updatedAt,
    tags: parsed.flow.metadata.tags || [],
    inputSchema: parsed.flow.inputSchema,
    outputSchema: parsed.flow.outputSchema,
    status: 'valid'
  };
};

export class FlowWatcher extends EventEmitter {
  readonly workspacePath: string;
  readonly options: FlowWatcherOptions;
  private watcher: FSWatcher | null = null;
  private readonly cache = new Map<string, FlowCatalogEntry>();

  constructor(workspacePath: string, options: FlowWatcherOptions = {}) {
    super();
    this.workspacePath = workspacePath;
    this.options = options;
    if (options.onEvent) this.on('event', options.onEvent);
  }

  private emitFlowEvent(event: FlowWatchEvent): void {
    this.emit('event', event);
    this.emit(event.type, event);
  }

  private handleFile = async (type: 'created' | 'changed', pathname: string): Promise<void> => {
    if (!isFlowFile(pathname)) return;
    const relativePath = toFlowRelativePath(this.workspacePath, pathname);
    try {
      const content = await fs.readFile(pathname, 'utf8');
      const entry = toEntry(this.workspacePath, pathname, content);
      const previous = this.cache.get(relativePath);
      this.cache.set(relativePath, entry);
      if (previous?.revision === entry.revision && type === 'changed') return;
      this.emitFlowEvent({ type, relativePath, pathname, entry, previous });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const previous = this.cache.get(relativePath);
      const entry: FlowCatalogEntry = {
        uid: null,
        name: relativePath,
        relativePath,
        pathname,
        revision: null,
        updatedAt: null,
        tags: [],
        status: 'invalid',
        error: message
      };
      this.cache.set(relativePath, entry);
      this.emitFlowEvent({
        type: 'invalid',
        relativePath,
        pathname,
        previous,
        error: message,
        entry
      });
    }
  };

  private handleUnlink = (pathname: string): void => {
    if (!isFlowFile(pathname)) return;
    const relativePath = toFlowRelativePath(this.workspacePath, pathname);
    const previous = this.cache.get(relativePath);
    this.cache.delete(relativePath);
    this.emitFlowEvent({ type: 'deleted', relativePath, pathname, previous });
  };

  async start(): Promise<this> {
    if (this.watcher) return this;
    const flowsDirectory = getFlowsDirectory(this.workspacePath);
    await fs.mkdir(flowsDirectory, { recursive: true });

    this.watcher = chokidar.watch(flowsDirectory, {
      ignoreInitial: this.options.ignoreInitial ?? true,
      persistent: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      usePolling: this.options.usePolling ?? false,
      awaitWriteFinish: {
        stabilityThreshold: this.options.stabilityThresholdMs ?? 80,
        pollInterval: this.options.pollIntervalMs ?? 25
      },
      ignored: (pathname: string) => pathIsTemporary(pathname)
    });

    this.watcher.on('add', (pathname) => void this.handleFile('created', pathname));
    this.watcher.on('change', (pathname) => void this.handleFile('changed', pathname));
    this.watcher.on('unlink', this.handleUnlink);
    this.watcher.on('error', (error) => this.emit('watcher-error', error));

    await new Promise<void>((resolve, reject) => {
      this.watcher?.once('ready', resolve);
      this.watcher?.once('error', reject);
    });
    return this;
  }

  async close(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    this.cache.clear();
    await watcher?.close();
  }
}

const pathIsTemporary = (pathname: string): boolean => {
  const basename = pathname.split(/[\\/]/).pop() || '';
  return basename.startsWith('.') && basename.endsWith('.tmp');
};
