const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const path = require('path');
const { uuid } = require('../utils/common');
const { redactRecorderEvent } = require('./redaction');
const { matchCollectionRequest } = require('./matcher');
const { RecorderSessionStore } = require('./session-store');
const { LocalSecretVault, encryptSecretBundle, decryptSecretBundle } = require('./secret-vault');

const DEFAULT_PORT = 6174;
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const ALLOWED_EVENT_TYPES = new Set([
  'recorder', 'action', 'navigation', 'network-request', 'network-response',
  'network-request-extra', 'network-failed', 'websocket-created', 'websocket-handshake',
  'websocket-frame', 'websocket-closed', 'websocket-error', 'storage-checkpoint',
  'storage-change', 'cookie-checkpoint', 'console', 'screenshot', 'marker'
]);
const SENSITIVE_FIELD = /authorization|cookie|token|secret|password|passwd|api[_-]?key|session|otp|pin|cvv|cvc/i;

const parseMaybeJson = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
};

const normalizeSensitiveValue = (pathName, value) => {
  const text = String(value || '').trim();
  if (/headers\.authorization$/i.test(pathName)) return text.replace(/^(?:Bearer|Basic|Token)\s+/i, '').trim();
  return text;
};

const collectSensitiveValues = (value, prefix = '', output = []) => {
  if (Array.isArray(value)) value.forEach((item, index) => collectSensitiveValues(item, `${prefix}[${index}]`, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (SENSITIVE_FIELD.test(key) && ['string', 'number'].includes(typeof child)) output.push({ path: next, value: String(child) });
    else collectSensitiveValues(child, next, output);
  });
  return output;
};

const jsonResponse = (response, statusCode, value) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-bruno-recorder-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let length = 0;
  request.on('data', (chunk) => {
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) {
      reject(new Error('Recorder payload exceeds 12 MB limit'));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    try {
      resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
    } catch {
      reject(new Error('Recorder payload is not valid JSON'));
    }
  });
  request.on('error', reject);
});

class RecorderManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.server = null;
    this.port = null;
    this.token = crypto.randomBytes(24).toString('hex');
    this.fingerprintKey = crypto.randomBytes(32);
    this.activeSession = null;
    this.requestMatches = new Map();
    this.store = new RecorderSessionStore(path.join(app.getPath('userData'), 'recordings'));
    this.secretVault = new LocalSecretVault(path.join(app.getPath('userData'), 'recording-secrets'), safeStorage);
  }

  isAuthorized(request) {
    const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '')
      || request.headers['x-bruno-recorder-token']
      || '';
    const expectedBuffer = Buffer.from(this.token);
    const providedBuffer = Buffer.from(String(provided));
    return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  }

  async ensureServer() {
    if (this.server) return this.getState();
    this.server = http.createServer((request, response) => this.handleHttpRequest(request, response));
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error.code === 'EADDRINUSE') {
          this.server.removeListener('error', onError);
          this.server.listen(0, '127.0.0.1', resolve);
        } else {
          reject(error);
        }
      };
      this.server.once('error', onError);
      this.server.listen(DEFAULT_PORT, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    this.broadcastState();
    return this.getState();
  }

  async handleHttpRequest(request, response) {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${this.port || DEFAULT_PORT}`);
      if (request.method === 'OPTIONS') return jsonResponse(response, 204, {});
      if (!this.isAuthorized(request)) return jsonResponse(response, 401, { error: 'Invalid Bruno Recorder pairing token' });
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        return jsonResponse(response, 200, this.getPublicBridgeState());
      }
      if (request.method === 'POST' && url.pathname === '/v1/events') {
        const body = await readJsonBody(request);
        const result = this.ingestEvents(body.sessionId, body.events);
        return jsonResponse(response, 202, result);
      }
      if (request.method === 'POST' && url.pathname === '/v1/heartbeat') {
        return jsonResponse(response, 200, this.getPublicBridgeState());
      }
      return jsonResponse(response, 404, { error: 'Recorder endpoint not found' });
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message || 'Recorder request failed' });
    }
  }

  startSession(metadata = {}) {
    if (this.activeSession?.status === 'recording') this.stopSession(this.activeSession.id);
    const manifest = this.store.createSession(metadata);
    this.activeSession = {
      ...manifest,
      collectionRequests: Array.isArray(metadata.requests) ? metadata.requests.slice(0, 10000) : []
    };
    this.requestMatches.clear();
    this.secretVault.clear(manifest.id);
    this.broadcastState();
    return this.getState();
  }

  stopSession(sessionId = this.activeSession?.id) {
    if (!sessionId) return this.getState();
    const patch = {
      status: 'stopped',
      endedAt: new Date().toISOString()
    };
    if (this.activeSession?.id === sessionId) patch.eventCount = this.activeSession.eventCount;
    const manifest = this.store.updateSession(sessionId, patch);
    if (this.activeSession?.id === sessionId) this.activeSession = { ...this.activeSession, ...manifest };
    this.broadcastState();
    return this.getState();
  }

  sensitiveValues(rawEvent) {
    const data = rawEvent?.data || {};
    const values = [];
    Object.entries(data.headers || {}).forEach(([key, value]) => {
      if (SENSITIVE_FIELD.test(key) && value != null) values.push({ path: `headers.${key}`, value: String(value) });
    });
    const parsedBody = parseMaybeJson(data.body);
    if (parsedBody) collectSensitiveValues(parsedBody, 'body', values);
    const parsedPayload = parseMaybeJson(data.payload);
    if (parsedPayload) collectSensitiveValues(parsedPayload, 'payload', values);
    for (const cookie of data.cookies || []) {
      if (cookie?.name && cookie?.value != null) values.push({ path: `cookies.${cookie.name}`, value: String(cookie.value) });
    }
    for (const associated of data.associatedCookies || []) {
      const cookie = associated?.cookie || associated;
      if (cookie?.name && cookie?.value != null) values.push({ path: `cookies.${cookie.name}`, value: String(cookie.value) });
    }
    if (data.storageType && data.key && data.newValue != null && SENSITIVE_FIELD.test(data.key)) {
      values.push({ path: `storage.${data.storageType}.${data.key}`, value: String(data.newValue) });
    }
    if (data.localStorage) {
      collectSensitiveValues(data.localStorage.values || data.localStorage, 'storage.localStorage', values);
    }
    if (data.sessionStorage) {
      collectSensitiveValues(data.sessionStorage.values || data.sessionStorage, 'storage.sessionStorage', values);
    }
    try {
      const url = new URL(data.url || '');
      url.searchParams.forEach((value, key) => {
        if (SENSITIVE_FIELD.test(key)) values.push({ path: `query.${key}`, value });
      });
    } catch {}
    return values.filter((entry) => entry.value && entry.value !== '<redacted>');
  }

  sensitiveFingerprints(rawEvent) {
    return this.sensitiveValues(rawEvent)
      .map((entry) => ({ ...entry, value: normalizeSensitiveValue(entry.path, entry.value) }))
      .map((entry) => ({
        path: entry.path,
        fingerprint: crypto.createHmac('sha256', this.fingerprintKey).update(entry.value).digest('hex')
      }));
  }

  normalizeEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') return null;
    const type = ALLOWED_EVENT_TYPES.has(rawEvent.type) ? rawEvent.type : 'marker';
    const screenshotBase64 = type === 'screenshot' && typeof rawEvent.data?.base64 === 'string'
      ? rawEvent.data.base64
      : null;
    const sanitized = redactRecorderEvent({
      id: typeof rawEvent.id === 'string' ? rawEvent.id : uuid(),
      type,
      timestamp: Number.isFinite(rawEvent.timestamp) ? rawEvent.timestamp : Date.now(),
      actionId: rawEvent.actionId || null,
      tabId: rawEvent.tabId ?? null,
      frameId: rawEvent.frameId ?? null,
      data: rawEvent.data && typeof rawEvent.data === 'object' ? rawEvent.data : {}
    });
    const sensitiveFingerprints = this.sensitiveFingerprints(rawEvent);
    if (sensitiveFingerprints.length) sanitized.data.sensitiveFingerprints = sensitiveFingerprints;
    if (screenshotBase64) sanitized.data.base64 = screenshotBase64;
    return sanitized;
  }

  ingestEvents(sessionId, rawEvents) {
    if (!this.activeSession || this.activeSession.status !== 'recording') throw new Error('No active Bruno recording session');
    if (sessionId !== this.activeSession.id) throw new Error('Recorder session does not match the active Bruno session');
    if (!Array.isArray(rawEvents)) throw new Error('Recorder events must be an array');

    let accepted = 0;
    for (const rawEvent of rawEvents.slice(0, 500)) {
      const eventId = typeof rawEvent?.id === 'string' ? rawEvent.id : uuid();
      const preparedRawEvent = { ...rawEvent, id: eventId };
      const rawSecrets = this.sensitiveValues(preparedRawEvent);
      const event = this.normalizeEvent(preparedRawEvent);
      if (!event) continue;
      if (rawSecrets.length) this.secretVault.append(sessionId, event.id, rawSecrets, event.data?.requestId || null);

      if (event.type === 'screenshot' && event.data?.base64) {
        const screenshotPath = this.store.writeScreenshot(sessionId, event.id, event.data.base64, event.data.mimeType);
        event.data = {
          ...event.data,
          base64: undefined,
          screenshotPath,
          screenshotOmitted: screenshotPath ? null : 'Session screenshot budget reached'
        };
        delete event.data.base64;
      }

      const browserRequestId = event.data?.requestId;
      if (event.type === 'network-request') {
        const match = matchCollectionRequest(event.data, this.activeSession.collectionRequests);
        if (match) {
          event.data.match = match;
          if (browserRequestId) this.requestMatches.set(browserRequestId, match);
        }
      } else if (browserRequestId && this.requestMatches.has(browserRequestId)) {
        event.data.match = this.requestMatches.get(browserRequestId);
      }

      this.store.appendEvent(sessionId, event);
      this.activeSession.eventCount += 1;
      accepted += 1;
      const rendererEvent = {
        ...event,
        data: {
          ...event.data,
          body: typeof event.data?.body === 'string' && event.data.body.length > 128 * 1024
            ? `${event.data.body.slice(0, 128 * 1024)}\n<... open exported recording for the full captured body ...>`
            : event.data?.body,
          payload: typeof event.data?.payload === 'string' && event.data.payload.length > 128 * 1024
            ? `${event.data.payload.slice(0, 128 * 1024)}\n<... open exported run for the full captured frame ...>`
            : event.data?.payload
        }
      };
      this.mainWindow?.webContents?.send('main:recorder-event', { sessionId, event: rendererEvent });
    }

    if (accepted > 0) {
      this.store.updateSession(sessionId, { eventCount: this.activeSession.eventCount });
      this.broadcastState();
    }
    return { accepted, eventCount: this.activeSession.eventCount };
  }

  getPublicBridgeState() {
    return {
      connected: true,
      port: this.port,
      session: this.activeSession ? {
        id: this.activeSession.id,
        name: this.activeSession.name,
        status: this.activeSession.status,
        startedAt: this.activeSession.startedAt,
        collection: this.activeSession.collection
      } : null
    };
  }

  exportSession(sessionId, destinationPath, options = {}) {
    let secretBundle = null;
    let secretRecordCount = 0;
    if (options.includeSecrets) {
      const records = this.secretVault.read(sessionId);
      if (!records.length) throw new Error('No locally encrypted secrets are available for this run');
      secretBundle = encryptSecretBundle(records, options.passphrase);
      secretRecordCount = records.length;
    }
    return this.store.exportSession(sessionId, destinationPath, { secretBundle, secretRecordCount });
  }

  unlockImportedSecrets(sessionId, passphrase) {
    const secretPath = path.join(this.store.getSessionDirectory(sessionId), 'secrets.enc');
    if (!fs.existsSync(secretPath)) throw new Error('This run has no encrypted secret bundle');
    const records = decryptSecretBundle(fs.readFileSync(secretPath), passphrase);
    const recordCount = this.secretVault.importRecords(sessionId, records);
    const manifest = this.store.readManifest(sessionId);
    this.store.updateSession(sessionId, {
      secrets: {
        ...(manifest?.secrets || {}),
        encrypted: true,
        unlocked: true,
        recordCount
      }
    });
    return { unlocked: true, recordCount };
  }

  getDebugSecrets(sessionId, source) {
    return this.secretVault.entriesForSource(sessionId, source);
  }

  getState() {
    return {
      bridge: {
        running: Boolean(this.server),
        host: '127.0.0.1',
        port: this.port,
        token: this.token
      },
      activeSession: this.activeSession ? {
        id: this.activeSession.id,
        name: this.activeSession.name,
        status: this.activeSession.status,
        startedAt: this.activeSession.startedAt,
        endedAt: this.activeSession.endedAt,
        eventCount: this.activeSession.eventCount,
        collection: this.activeSession.collection
      } : null
    };
  }

  broadcastState() {
    this.mainWindow?.webContents?.send('main:recorder-state', this.getState());
  }

  close() {
    if (this.server) this.server.close();
    this.server = null;
    this.port = null;
  }
}

module.exports = RecorderManager;
module.exports.normalizeSensitiveValue = normalizeSensitiveValue;
