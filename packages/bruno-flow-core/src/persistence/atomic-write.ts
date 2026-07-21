import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const pathLocks = new Map<string, Promise<unknown>>();

export const withPathLock = async <T>(pathname: string, operation: () => Promise<T>): Promise<T> => {
  const key = path.resolve(pathname);
  const previous = pathLocks.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pathLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (pathLocks.get(key) === next) pathLocks.delete(key);
  }
};

export const withPathLocks = async <T>(pathnames: string[], operation: () => Promise<T>): Promise<T> => {
  const unique = [...new Set(pathnames.map((pathname) => path.resolve(pathname)))].sort();
  const acquire = (index: number): Promise<T> => {
    if (index >= unique.length) return operation();
    return withPathLock(unique[index], () => acquire(index + 1));
  };
  return acquire(0);
};

const syncDirectory = async (directory: string): Promise<void> => {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(code || '')) throw error;
  } finally {
    await handle?.close();
  }
};

export interface AtomicWriteOptions {
  beforeCommit?: () => Promise<void> | void;
}

export const atomicWriteFile = async (
  pathname: string,
  content: string | Buffer,
  options: AtomicWriteOptions = {}
): Promise<void> => {
  const directory = path.dirname(pathname);
  await fs.mkdir(directory, { recursive: true });

  const tempPath = path.join(
    directory,
    `.${path.basename(pathname)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );

  let mode: number | undefined;
  try {
    mode = (await fs.stat(pathname)).mode;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }

  let handle;
  try {
    handle = await fs.open(tempPath, 'wx', mode);
    await handle.writeFile(content, typeof content === 'string' ? { encoding: 'utf8' } : undefined);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await options.beforeCommit?.();
    await fs.rename(tempPath, pathname);
    await syncDirectory(directory);
  } finally {
    await handle?.close();
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
};
