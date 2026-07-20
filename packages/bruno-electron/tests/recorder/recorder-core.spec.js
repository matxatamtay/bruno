const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { redactRecorderEvent } = require('../../src/recorder/redaction');
const { matchCollectionRequest } = require('../../src/recorder/matcher');
const { RecorderSessionStore, isSafeArchivePath } = require('../../src/recorder/session-store');
const { normalizeSensitiveValue } = require('../../src/recorder/RecorderManager');
const { encryptSecretBundle, decryptSecretBundle } = require('../../src/recorder/secret-vault');

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

    it('redacts cookie checkpoints and sensitive browser storage changes', () => {
      const cookieEvent = redactRecorderEvent({
        type: 'cookie-checkpoint',
        data: {
          cookies: [
            { name: 'session', value: 'cookie-secret', domain: 'api.test' },
            { name: 'theme', value: 'dark', domain: 'api.test' }
          ]
        }
      });
      const storageEvent = redactRecorderEvent({
        type: 'storage-change',
        data: {
          storageType: 'localStorage',
          operation: 'updated',
          key: 'accessToken',
          oldValue: 'old-token',
          newValue: 'new-token'
        }
      });

      expect(cookieEvent.data.cookies.map((cookie) => cookie.value)).toEqual(['<redacted>', '<redacted>']);
      expect(storageEvent.data.oldValue).toBe('<redacted>');
      expect(storageEvent.data.newValue).toBe('<redacted>');
    });
  });

  describe('sensitive fingerprints', () => {
    it('normalizes authorization schemes before fingerprinting', () => {
      expect(normalizeSensitiveValue('headers.Authorization', 'Bearer token-123')).toBe('token-123');
      expect(normalizeSensitiveValue('body.accessToken', 'token-123')).toBe('token-123');
    });
  });

  describe('encrypted run secrets', () => {
    it('round-trips a compressed AES-GCM bundle and rejects a wrong passphrase', () => {
      const records = [{ eventId: 'request-1', entries: [{ path: 'headers.Authorization', value: 'Bearer secret-token' }] }];
      const encrypted = encryptSecretBundle(records, 'correct horse battery staple');

      expect(encrypted.toString('utf8')).not.toContain('secret-token');
      expect(decryptSecretBundle(encrypted, 'correct horse battery staple')).toEqual(records);
      expect(() => decryptSecretBundle(encrypted, 'wrong-passphrase')).toThrow(/passphrase/i);
    });

    it('rejects attacker-controlled KDF parameters before doing expensive work', () => {
      const encrypted = encryptSecretBundle([], 'correct horse battery staple');
      const envelope = JSON.parse(encrypted.toString('utf8'));
      envelope.kdf.iterations = 999999999;

      expect(() => decryptSecretBundle(
        Buffer.from(JSON.stringify(envelope)),
        'correct horse battery staple'
      )).toThrow(/parameters/i);
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

    it('persists events and round-trips a checksummed .brunorun archive', () => {
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

      const archivePath = path.join(tempDirectory, 'checkout.brunorun');
      const exported = store.exportSession(manifest.id, archivePath);
      expect(fs.existsSync(archivePath)).toBe(true);
      expect(exported.bytes).toBeGreaterThan(0);
      const zipEntries = new AdmZip(archivePath).getEntries().map((entry) => entry.entryName);
      expect(zipEntries).toEqual(expect.arrayContaining(['manifest.json', 'events.jsonl', 'checksums.json', 'storage.json']));
      expect(zipEntries.some((entry) => entry.startsWith('screenshots/'))).toBe(true);

      const imported = store.importSession(archivePath);
      expect(imported.manifest.id).not.toBe(manifest.id);
      expect(imported.manifest.status).toBe('imported');
      expect(imported.manifest.collection.name).toBe('Shop API');
      expect(imported.events).toHaveLength(1);
      expect(imported.events[0].data.status).toBe(500);
    });

    it('optionally embeds an encrypted secret bundle in the archive manifest', () => {
      const manifest = store.createSession({ name: 'Secret run' });
      const bundle = encryptSecretBundle(
        [{ eventId: 'event-1', entries: [{ path: 'query.token', value: 'abc' }] }],
        'strong-passphrase'
      );
      const archivePath = path.join(tempDirectory, 'secret-run.brunorun');
      store.exportSession(manifest.id, archivePath, { secretBundle: bundle, secretRecordCount: 1 });

      const zip = new AdmZip(archivePath);
      expect(zip.getEntry('secrets.enc')).toBeTruthy();
      expect(JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8')).secrets).toMatchObject({ encrypted: true, recordCount: 1 });
      const imported = store.importSession(archivePath);
      expect(imported.manifest.secrets.encrypted).toBe(true);
      expect(fs.existsSync(path.join(store.getSessionDirectory(imported.manifest.id), 'secrets.enc'))).toBe(true);
    });

    it('rejects an archive containing an unchecksummed extra file', () => {
      const manifest = store.createSession({ name: 'Tampered run' });
      const archivePath = path.join(tempDirectory, 'tampered-run.brunorun');
      store.exportSession(manifest.id, archivePath);
      const zip = new AdmZip(archivePath);
      zip.addFile('surprise.txt', Buffer.from('not checksummed'));
      zip.writeZip(archivePath);

      expect(() => store.importSession(archivePath)).toThrow(/missing a checksum/i);
    });

    it('deduplicates large bodies while hydrating them when the run is opened', () => {
      const manifest = store.createSession({ name: 'Large API run' });
      const body = JSON.stringify({ payload: 'x'.repeat(80 * 1024) });
      store.appendEvent(manifest.id, { id: 'request-1', type: 'network-response', data: { body } });
      store.appendEvent(manifest.id, { id: 'request-2', type: 'network-response', data: { body } });

      const loaded = store.loadSession(manifest.id);
      expect(loaded.events[0].data.body).toBe(body);
      expect(loaded.events[1].data.body).toBe(body);
      expect(loaded.manifest.storage.payloadFiles).toBe(1);
      expect(loaded.manifest.storage.payloadDeduplicatedBytes).toBeGreaterThan(0);

      const archivePath = path.join(tempDirectory, 'large-run.brunorun');
      store.exportSession(manifest.id, archivePath);
      const payloadEntries = new AdmZip(archivePath).getEntries().filter((entry) => entry.entryName.startsWith('payloads/') && !entry.isDirectory);
      expect(payloadEntries).toHaveLength(1);
    });

    it('deduplicates large WebSocket frame payloads', () => {
      const manifest = store.createSession({ name: 'Socket run' });
      const payload = JSON.stringify({ event: 'order.updated', data: 's'.repeat(80 * 1024) });
      store.appendEvent(manifest.id, { id: 'frame-1', type: 'websocket-frame', data: { requestId: 'ws-1', payload } });
      store.appendEvent(manifest.id, { id: 'frame-2', type: 'websocket-frame', data: { requestId: 'ws-1', payload } });

      const loaded = store.loadSession(manifest.id);
      expect(loaded.events[0].data.payload).toBe(payload);
      expect(loaded.events[1].data.payload).toBe(payload);
      expect(loaded.manifest.storage.payloadFiles).toBe(1);
    });

    it('truncates a single oversized body and records omitted bytes', () => {
      const manifest = store.createSession({ name: 'Oversized response' });
      const body = 'z'.repeat(900 * 1024);
      store.appendEvent(manifest.id, { id: 'response-1', type: 'network-response', data: { body } });

      const loaded = store.loadSession(manifest.id);
      expect(loaded.events[0].data.body).toContain('<... truncated');
      expect(loaded.events[0].data.body.length).toBeLessThan(body.length);
      expect(loaded.manifest.storage.payloadOmittedBytes).toBeGreaterThan(0);
    });

    it('deduplicates identical screenshots', () => {
      const manifest = store.createSession({ name: 'Screenshot run' });
      const screenshot = Buffer.from('same screenshot').toString('base64');
      const first = store.writeScreenshot(manifest.id, 'shot-1', screenshot);
      const second = store.writeScreenshot(manifest.id, 'shot-2', screenshot);

      expect(second).toBe(first);
      expect(store.readManifest(manifest.id).storage.screenshotFiles).toBe(1);
      expect(store.readManifest(manifest.id).storage.screenshotDeduplicatedBytes).toBeGreaterThan(0);
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
