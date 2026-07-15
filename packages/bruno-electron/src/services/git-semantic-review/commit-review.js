const path = require('path');
const get = require('lodash/get');
const { parseRequest, parseEnvironment, parseCollection, parseFolder } = require('@usebruno/filestore');
const {
  getCollectionGitRootPath,
  getCommitFilesForCollection,
  getCommitFileDiff,
  getFileContentForVisualDiff,
  getFilesAtCommit,
  getFileContentAtCommit
} = require('../../utils/git');
const { analyzeSemanticChanges } = require('./index');
const { buildImpactAnalysis, extractProducedVariables, enabledVariableNames } = require('./analyze-impact');
const { detectSecrets, detectRawDiffSecrets } = require('./detect-secrets');
const analyzeAssertionRisk = require('./analyze-assertions');
const { summarizeFindings } = require('./model');

const cache = new Map();
const MAX_CACHE = 30;
const isRequestFile = (file) => /\.(bru|ya?ml)$/i.test(file) && !/(^|\/)(folder|collection)\.(bru|ya?ml)$/i.test(file) && !/(^|\/)opencollection\.yml$/i.test(file) && !/(^|\/)environments\//i.test(file);
const isEnvironmentFile = (file) => /(^|\/)environments\/.*\.(bru|ya?ml)$/i.test(file);
const isCollectionFile = (file) => /(^|\/)(collection\.bru|opencollection\.yml)$/i.test(file);
const isFolderFile = (file) => /(^|\/)folder\.(bru|ya?ml)$/i.test(file);
const formatFor = (file) => /\.ya?ml$/i.test(file) ? 'yml' : 'bru';
const toRelative = (gitPath, collectionRoot) => collectionRoot && gitPath.startsWith(`${collectionRoot}/`) ? gitPath.slice(collectionRoot.length + 1) : gitPath;

const scopeFromParsed = (parsed, scopePath, type) => ({
  type,
  path: scopePath,
  variables: enabledVariableNames(get(parsed, 'request.vars.req', [])),
  produces: extractProducedVariables(get(parsed, 'request.script', {}))
});

const parseScopeAtCommit = async ({ gitRootPath, commitHash, gitPath, collectionRoot }) => {
  const content = await getFileContentAtCommit(gitRootPath, commitHash, gitPath);
  if (!content) return null;
  try {
    if (isCollectionFile(gitPath)) {
      const parsed = parseCollection(content, { format: formatFor(gitPath) });
      const root = parsed?.collectionRoot || parsed;
      return scopeFromParsed(root, '', 'collection');
    }
    const parsed = parseFolder(content, { format: formatFor(gitPath) });
    const relative = toRelative(gitPath, collectionRoot);
    return scopeFromParsed(parsed, path.posix.dirname(relative), 'folder');
  } catch (error) {
    return null;
  }
};

const getCommitSemanticReview = async (collectionPath, commitHash, context = {}) => {
  const contextFingerprint = JSON.stringify({
    global: (context.globalVariables || []).map((variable) => variable.name).sort(),
    runtime: (context.runtimeVariables || []).map((variable) => variable.name).sort()
  });
  const key = `${collectionPath}:${commitHash}:${contextFingerprint}`;
  if (cache.has(key)) return cache.get(key);
  const gitRootPath = getCollectionGitRootPath(collectionPath);
  if (!gitRootPath) throw new Error('This collection is not inside a Git repository');
  const collectionRoot = path.relative(gitRootPath, collectionPath).replace(/\\/g, '/');
  const changedFiles = await getCommitFilesForCollection(collectionPath, commitHash);
  const snapshots = (await Promise.all(changedFiles.filter((file) => file.supportsVisualDiff).map(async (file) => ({
    filePath: file.collectionRelativePath,
    status: file.status,
    ...await getFileContentForVisualDiff(gitRootPath, commitHash, file.path, file.oldPath || file.path)
  })))).filter((snapshot) => snapshot.oldParsed || snapshot.newParsed);

  const filesAtCommit = await getFilesAtCommit(gitRootPath, commitHash, collectionRoot);
  const allRequestPaths = filesAtCommit.filter(isRequestFile);
  const changedPaths = new Set(snapshots.map((snapshot) => snapshot.filePath));
  const indexedSnapshots = [...snapshots];
  for (const gitPath of allRequestPaths.slice(0, 2000)) {
    const relativePath = toRelative(gitPath, collectionRoot);
    if (changedPaths.has(relativePath)) continue;
    const content = await getFileContentAtCommit(gitRootPath, commitHash, gitPath);
    if (!content) continue;
    try {
      indexedSnapshots.push({ filePath: relativePath, status: 'unchanged', oldParsed: null, newParsed: parseRequest(content, { format: formatFor(gitPath) }) });
    } catch (error) {}
  }

  const environments = [];
  for (const gitPath of filesAtCommit.filter(isEnvironmentFile).slice(0, 100)) {
    const content = await getFileContentAtCommit(gitRootPath, commitHash, gitPath);
    if (!content) continue;
    try {
      const parsed = parseEnvironment(content, { format: formatFor(gitPath) });
      environments.push({ path: toRelative(gitPath, collectionRoot), name: path.basename(gitPath).replace(/\.(bru|ya?ml)$/i, ''), variables: parsed.variables || [] });
    } catch (error) {}
  }

  const scopes = (await Promise.all(filesAtCommit
    .filter((gitPath) => isCollectionFile(gitPath) || isFolderFile(gitPath))
    .slice(0, 1000)
    .map((gitPath) => parseScopeAtCommit({ gitRootPath, commitHash, gitPath, collectionRoot })))).filter(Boolean);

  const rawDiffs = await Promise.all(changedFiles.slice(0, 500).map(async (file) => ({
    filePath: file.collectionRelativePath,
    diff: await getCommitFileDiff(gitRootPath, commitHash, file.path).catch(() => '')
  })));

  const direct = analyzeSemanticChanges({ commitHash, snapshots });
  const impact = buildImpactAnalysis({
    snapshots: indexedSnapshots,
    environments,
    scopes,
    globalVariables: context.globalVariables || [],
    runtimeVariables: context.runtimeVariables || []
  });
  const findings = [
    ...direct.findings,
    ...impact.findings,
    ...detectSecrets({ snapshots }),
    ...detectRawDiffSecrets({ diffs: rawDiffs }),
    ...analyzeAssertionRisk({ snapshots })
  ];
  const result = {
    commitHash,
    comparedWith: 'first-parent',
    summary: summarizeFindings(findings, impact.affectedRequests),
    findings,
    affectedRequests: impact.affectedRequests,
    changedVariables: impact.changedVariables,
    requiredVariables: impact.requiredVariables,
    environmentMatrix: impact.environmentMatrix,
    environments: environments.map((environment) => ({ name: environment.name, path: environment.path })),
    scopeSummary: {
      collection: scopes.filter((scope) => scope.type === 'collection').length,
      folders: scopes.filter((scope) => scope.type === 'folder').length
    },
    partial: allRequestPaths.length > 2000 || changedFiles.length > 500,
    warnings: [
      ...(allRequestPaths.length > 2000 ? ['Dependency analysis was limited to 2000 requests.'] : []),
      ...(changedFiles.length > 500 ? ['Raw secret scanning was limited to 500 changed files.'] : [])
    ]
  };
  cache.set(key, result);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return result;
};

module.exports = { getCommitSemanticReview };
