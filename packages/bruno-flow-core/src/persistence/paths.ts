import fs from 'node:fs/promises';
import path from 'node:path';
import { InvalidFlowPathError } from '../errors';

export const FLOW_FILE_PATTERN = /\.flow\.ya?ml$/i;

export const getFlowsDirectory = (workspacePath: string): string => path.resolve(workspacePath, 'flows');
export const getFlowDraftsDirectory = (workspacePath: string): string => path.resolve(workspacePath, '.bruno', 'flow-drafts');

export const normalizeFlowRelativePath = (relativePath: string): string => {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
};

const assertInsideDirectory = (baseDirectory: string, pathname: string, relativePath: string): void => {
  const relative = path.relative(baseDirectory, pathname);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new InvalidFlowPathError(relativePath);
};

export const resolveFlowPath = (workspacePath: string, relativePath: string): string => {
  const normalized = normalizeFlowRelativePath(relativePath);
  if (!normalized || path.isAbsolute(normalized) || !FLOW_FILE_PATTERN.test(normalized)) {
    throw new InvalidFlowPathError(relativePath);
  }

  const flowsDirectory = getFlowsDirectory(workspacePath);
  const pathname = path.resolve(flowsDirectory, normalized);
  assertInsideDirectory(flowsDirectory, pathname, relativePath);
  return pathname;
};

export const toFlowRelativePath = (workspacePath: string, pathname: string): string => {
  const flowsDirectory = getFlowsDirectory(workspacePath);
  const resolved = path.resolve(pathname);
  assertInsideDirectory(flowsDirectory, resolved, pathname);
  return normalizeFlowRelativePath(path.relative(flowsDirectory, resolved));
};

const isInsideDirectory = (baseDirectory: string, pathname: string): boolean => {
  const relative = path.relative(baseDirectory, pathname);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const findNearestExistingPath = async (pathname: string): Promise<string> => {
  let candidate = pathname;
  while (true) {
    try {
      await fs.lstat(candidate);
      return candidate;
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
};

export const assertFlowPathWithinWorkspace = async (
  workspacePath: string,
  pathname: string
): Promise<void> => {
  const flowsDirectory = getFlowsDirectory(workspacePath);
  await fs.mkdir(flowsDirectory, { recursive: true });
  const [realFlowsDirectory, nearestExistingPath] = await Promise.all([
    fs.realpath(flowsDirectory),
    findNearestExistingPath(pathname)
  ]);
  const realExistingPath = await fs.realpath(nearestExistingPath);
  if (!isInsideDirectory(realFlowsDirectory, realExistingPath)) {
    throw new InvalidFlowPathError(toFlowRelativePath(workspacePath, pathname));
  }
};

export const isFlowFile = (pathname: string): boolean => FLOW_FILE_PATTERN.test(pathname);
