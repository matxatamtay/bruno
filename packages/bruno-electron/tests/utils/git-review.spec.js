const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getCurrentBranchCommitHistory,
  getCommitFilesForCollection,
  getFileContentForVisualDiff
} = require('../../src/utils/git');

const BEFORE_REQUEST = `meta {
  name: get-user
  type: http
  seq: 1
}

get {
  url: https://example.com/users/1
  body: json
  auth: none
}

headers {
  Accept: application/json
}

body:json {
  {
    "include": "basic"
  }
}

docs {
  Fetch a user
}
`;

const AFTER_REQUEST = `meta {
  name: get-user
  type: http
  seq: 1
}

post {
  url: https://api.example.com/users/1
  body: json
  auth: bearer
}

headers {
  Accept: application/json
  X-Trace: enabled
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "include": "full",
    "expand": true
  }
}

docs {
  Fetch a user with expanded details
}
`;

const createRepository = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-git-review-test-'));
  const collectionPath = path.join(root, 'collection');
  const requestFolder = path.join(collectionPath, 'users');
  const runGit = (args) => execFileSync('git', args, {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8'
  }).trim();

  fs.mkdirSync(requestFolder, { recursive: true });
  fs.writeFileSync(path.join(requestFolder, 'get-user.bru'), BEFORE_REQUEST);
  fs.writeFileSync(path.join(collectionPath, 'bruno.json'), JSON.stringify({ version: '1', name: 'Smoke' }, null, 2));
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside collection\n');

  runGit(['init']);
  runGit(['config', 'user.name', 'Bruno Test']);
  runGit(['config', 'user.email', 'bruno-test@example.com']);
  runGit(['add', '.']);
  runGit(['commit', '-m', 'initial collection']);
  runGit(['branch', '-M', 'feature/review']);

  fs.writeFileSync(path.join(requestFolder, 'get-user.bru'), AFTER_REQUEST);
  fs.renameSync(path.join(collectionPath, 'bruno.json'), path.join(collectionPath, 'collection.json'));
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside changed\n');
  runGit(['add', '-A']);
  runGit(['commit', '-m', 'update request | rename config']);

  return { root, collectionPath };
};

describe('Git commit review helpers', () => {
  let repository;

  beforeEach(() => {
    repository = createRepository();
  });

  afterEach(() => {
    fs.rmSync(repository.root, { recursive: true, force: true });
  });

  test('returns commits reachable from the current branch', async () => {
    const history = await getCurrentBranchCommitHistory(repository.collectionPath, 20);

    expect(history.branch).toBe('feature/review');
    expect(history.commits).toHaveLength(2);
    expect(history.commits.map((commit) => commit.message)).toEqual([
      'update request | rename config',
      'initial collection'
    ]);
    expect(history.hasMore).toBe(false);
  });

  test('filters changed files to the collection and preserves rename metadata', async () => {
    const history = await getCurrentBranchCommitHistory(repository.collectionPath, 20);
    const files = await getCommitFilesForCollection(repository.collectionPath, history.commits[0].hash);

    expect(files.map((file) => file.collectionRelativePath).sort()).toEqual([
      'collection.json',
      'users/get-user.bru'
    ]);
    expect(files.some((file) => file.collectionRelativePath === 'outside.txt')).toBe(false);

    const requestFile = files.find((file) => file.collectionRelativePath === 'users/get-user.bru');
    expect(requestFile).toMatchObject({
      status: 'modified',
      supportsVisualDiff: true
    });

    const renamedFile = files.find((file) => file.collectionRelativePath === 'collection.json');
    expect(renamedFile).toMatchObject({
      status: 'renamed',
      supportsVisualDiff: false
    });
    expect(renamedFile.oldPath.endsWith('collection/bruno.json')).toBe(true);
    expect(renamedFile.path.endsWith('collection/collection.json')).toBe(true);
  });

  test('returns parsed before and after request snapshots for tabbed visual diffs', async () => {
    const history = await getCurrentBranchCommitHistory(repository.collectionPath, 20);
    const files = await getCommitFilesForCollection(repository.collectionPath, history.commits[0].hash);
    const requestFile = files.find((file) => file.collectionRelativePath === 'users/get-user.bru');

    const review = await getFileContentForVisualDiff(
      repository.root,
      history.commits[0].hash,
      requestFile.path,
      requestFile.oldPath
    );

    expect(review.oldParsed.request.method).toBe('GET');
    expect(review.newParsed.request.method).toBe('POST');
    expect(review.oldParsed.request.url).toBe('https://example.com/users/1');
    expect(review.newParsed.request.url).toBe('https://api.example.com/users/1');
    expect(review.newParsed.request.headers).toHaveLength(2);
    expect(review.newParsed.request.auth.mode).toBe('bearer');
    expect(review.newParsed.request.body.json).toContain('"expand": true');
    expect(review.newParsed.request.docs).toContain('expanded details');
  });
});
