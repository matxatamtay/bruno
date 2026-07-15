const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { redactRecorderEvent } = require('../../src/recorder/redaction');
const { matchCollectionRequest } = require('../../src/recorder/matcher');
const { RecorderSessionStore, isSafeArchivePath } = require('../../src/recorder/session-store');
const { normalizeSensitiveValue } = require('../../src/recorder/RecorderManager');

describe('Bruno Web Recorder core', () => {
  describe('redaction', () => {
    it('redacts sensitive headers and nested body fields', () => {
      const event = redactRecorderEvent({
        type: 'network-request',
        data: {
          headers: {
            Authorization: 'Bearer secret-token',
            Cookie: 'session=abc',
            Accept: 'application/json'
          },
          body: {
            username: 'vinh',
            password: 'super-secret',
            nested: { access_token: 'token-value', safe: true }
          }
        }
      });

      expect(event.data.headers.Authorization).toBe('<redacted>');
      expect(event.data.headers.Cookie).toBe('<redacted>');
      expect(event.data.headers.Accept).toBe('application/json');
      expect(event.data.body.password).toBe('<redacted>');
      expect(event.data.body.nested.access_token).toBe('<redacted>');
      expect(event.data.body.username).toBe('vinh');
    });

    it('redacts query strings and serialized request bodies', () => {
      const event = redactRecorderEvent({
        type: 'network-request',
        data: {
          url: 'https://api.example.com/login?access_token=abc&safe=yes',
          body: '{"email":"vinh@example.com","password":"secret","nested":{"api_key":"key"}}'
        }
      });

      expect(event.data.url).toContain('access_token=<redacted>');
      expect(event.data.url).toContain('safe=yes');
      expect(event.data.body).toContain('"password":"<redacted>"');
      expect(event.data.body).toContain('"api_key":"<redacted>"');
      expect(event.data.body).not.toContain('"password":"secret"');
    });
  });

  describe('sensitive fingerprints', () => {
    it('normalizes authorization schemes before fingerprinting', () => {
      expect(normalizeSensitiveValue('headers.Authorization', 'Bearer token-123')).toBe('token-123');
      expect(normalizeSensitiveValue('body.accessToken', 'token-123')).toBe('token-123');
    });
  });

  describe('collection matcher', () => {
    const candidates = [
      {
        itemUid: 'request-1',
        pathname: '/collection/users/get-user.yml',
        name: 'Get user',
        type: 'http-request',
        method: 'GET',
        url: 'https://api.example.com/v1/users/{{userId}}?include={{include}}'
      },
      {
        itemUid: 'request-2',
        pathname: '/collection/users/list.yml',
        name: 'List users',
        type: 'http-request',
        method: 'GET',
        url: 'https://api.example.com/v1/users'
      }
    ];

    it('matches dynamic path segments and query keys', () => {
      const match = matchCollectionRequest({
        method: 'GET',
        url: 'https://api.example.com/v1/users/04dd32bb-b44c-4f6d-9062-743c8de3ab65?include=profile'
      }, candidates);

      expect(match).toMatchObject({ itemUid: 'request-1', confidence: 'exact' });
    });

    it('matches a collection URL that starts with a Bruno base variable', () => {
      const match = matchCollectionRequest({
        method: 'POST',
        url: 'https://dev.example.com/v1/login'
      }, [{
        itemUid: 'login-request',
        method: 'POST',
        url: '{{MOOD_ADMIN_BASE_URL}}/v1/login'
      }]);

      expect(match).toMatchObject({ itemUid: 'login-request', confidence: 'probable' });
    });

    it('does not match a different method', () => {
      expect(matchCollectionRequest({
        method: 'POST',
        url: 'https://api.example.com/v1/users/123'
      }, candidates)).toBeNull();
    });
  });

  describe('session archive', () => {
    let tempDirectory;
    let store;

    beforeEach(() => {
      tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-recorder-test-'));
      store = new RecorderSessionStore(path.join(tempDirectory, 'recordings'));
    });

    afterEach(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));

    it('persists events and round-trips a checksummed .brurec archive', () => {
      const manifest = store.createSession({
        name: 'Checkout failure',
        collection: { uid: 'collection-1', name: 'Shop API' }
      });
      store.appendEvent(manifest.id, {
        id: 'event-1',
        type: 'network-response',
        timestamp: 1,
        data: { requestId: 'browser-request-1', status: 500 }
      });
      store.writeScreenshot(manifest.id, 'shot-1', Buffer.from('fake image').toString('base64'));
      store.updateSession(manifest.id, { status: 'stopped', eventCount: 1, endedAt: new Date().toISOString() });

      const archivePath = path.join(tempDirectory, 'checkout.brurec');
      store.exportSession(manifest.id, archivePath);
      expect(fs.existsSync(archivePath)).toBe(true);
      const zipEntries = new AdmZip(archivePath).getEntries().map((entry) => entry.entryName);
      expect(zipEntries).toEqual(expect.arrayContaining(['manifest.json', 'events.jsonl', 'checksums.json', 'screenshots/shot-1.jpg']));

      const imported = store.importSession(archivePath);
      expect(imported.manifest.id).not.toBe(manifest.id);
      expect(imported.manifest.status).toBe('imported');
      expect(imported.manifest.collection.name).toBe('Shop API');
      expect(imported.events).toHaveLength(1);
      expect(imported.events[0].data.status).toBe(500);
    });

    it('marks unfinished sessions as interrupted when the store is reopened', () => {
      const manifest = store.createSession({ name: 'Interrupted session' });
      const reopenedStore = new RecorderSessionStore(path.join(tempDirectory, 'recordings'));
      const recovered = reopenedStore.readManifest(manifest.id);

      expect(recovered.status).toBe('interrupted');
      expect(recovered.endedAt).toBeTruthy();
    });

    it('rejects traversal and absolute archive paths', () => {
      expect(isSafeArchivePath('../escape.txt')).toBe(false);
      expect(isSafeArchivePath('safe/../../escape.txt')).toBe(false);
      expect(isSafeArchivePath('/tmp/escape.txt')).toBe(false);
      expect(isSafeArchivePath('C:/escape.txt')).toBe(false);
      expect(isSafeArchivePath('screenshots/step-1.jpg')).toBe(true);
    });
  });
});
