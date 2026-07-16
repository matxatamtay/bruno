const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { buildCollectionIdentity } = require('./identity');
const { atomicWriteJson } = require('./storage/contract-store');
const { matchRoute, applyFailurePreset, sanitizeRecordedValue } = require('./mock-lab');

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LOGS = 250;
const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
};

const readRequestBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(new Error('Request body exceeds Mock Lab limit'));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return resolve({ raw: '', parsed: null });
    try { resolve({ raw, parsed: JSON.parse(raw) }); } catch { resolve({ raw, parsed: raw }); }
  });
  request.on('error', reject);
});

const weightedResponse = (responses = [], counter = 0) => {
  if (!responses.length) return { status: 200, headers: { 'content-type': 'application/json' }, body: { ok: true } };
  const expanded = responses.flatMap((response) => Array.from({ length: Math.max(1, Number(response.weight || response.repeat || 1)) }, () => response));
  return expanded[counter % expanded.length];
};

class MockLabService {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    this.server = null;
    this.collection = null;
    this.lab = null;
    this.port = null;
    this.logs = [];
    this.routeCounters = new Map();
  }

  location(collection) {
    const identity = buildCollectionIdentity(collection);
    const directory = path.join(this.baseDirectory, 'collections', identity.key, 'mocks');
    ensureDir(directory);
    return { identity, directory, filePath: path.join(directory, 'lab.json') };
  }

  load(collection) {
    const { identity, filePath } = this.location(collection);
    return readJson(filePath, {
      format: 'bruno-mock-lab',
      schemaVersion: 1,
      collectionIdentity: identity,
      mode: 'pure-mock',
      proxyBaseUrl: null,
      recordProxyResponses: false,
      routes: []
    });
  }

  save(collection, lab) {
    const { identity, filePath } = this.location(collection);
    const next = { ...sanitizeRecordedValue(lab), format: 'bruno-mock-lab', schemaVersion: 1, collectionIdentity: identity, updatedAt: new Date().toISOString() };
    atomicWriteJson(filePath, next);
    if (this.collection && buildCollectionIdentity(this.collection).key === identity.key) this.lab = next;
    return next;
  }

  upsertRoute(collection, route) {
    const lab = this.load(collection);
    const index = (lab.routes || []).findIndex((candidate) => candidate.id === route.id);
    const nextRoute = { ...route, id: route.id || crypto.randomUUID() };
    if (index >= 0) lab.routes[index] = nextRoute;
    else lab.routes = [...(lab.routes || []), nextRoute];
    return this.save(collection, lab);
  }

  deleteRoute(collection, routeId) {
    const lab = this.load(collection);
    lab.routes = (lab.routes || []).filter((route) => route.id !== routeId);
    this.routeCounters.delete(routeId);
    return this.save(collection, lab);
  }

  resetState() {
    this.routeCounters.clear();
    this.logs = [];
    return this.state();
  }

  async start(collection) {
    if (this.server) await this.stop();
    this.collection = collection;
    this.lab = this.load(collection);
    this.server = http.createServer((request, response) => this.handle(request, response));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = this.server.address().port;
    return this.state();
  }

  async stop() {
    if (!this.server) return this.state();
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
    this.port = null;
    return this.state();
  }

  state() {
    return {
      running: Boolean(this.server),
      url: this.port ? `http://127.0.0.1:${this.port}` : null,
      port: this.port,
      collection: this.collection ? buildCollectionIdentity(this.collection) : null,
      routes: this.lab?.routes?.length || 0,
      activeFailures: (this.lab?.routes || []).filter((route) => route.failurePreset).length,
      requestsServed: this.logs.length,
      mode: this.lab?.mode || 'pure-mock'
    };
  }

  listLogs() {
    return [...this.logs].reverse();
  }

  pushLog(entry) {
    this.logs.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry });
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
  }

  async handle(request, response) {
    const startedAt = Date.now();
    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
    try {
      const body = await readRequestBody(request);
      const requestShape = {
        method: request.method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: request.headers,
        body: body.parsed
      };
      const matched = (this.lab?.routes || []).map((route) => ({ route, match: matchRoute(route, requestShape) })).find((candidate) => candidate.match);
      if (!matched) {
        if (this.lab?.mode === 'proxy-override' && this.lab.proxyBaseUrl) return this.proxy(request, response, body.raw, url, startedAt);
        this.pushLog({ method: request.method, path: url.pathname, status: 404, matchedRouteId: null, duration: Date.now() - startedAt });
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'No Mock Lab route matched', method: request.method, path: url.pathname }));
        return;
      }

      const counter = this.routeCounters.get(matched.route.id) || 0;
      this.routeCounters.set(matched.route.id, counter + 1);
      let selected = weightedResponse(matched.route.responses, counter);
      const sequence = matched.route.stateMachine?.sequence || matched.route.failurePreset?.sequence;
      if (Array.isArray(sequence) && sequence.length) {
        const sequenceIndex = Math.min(counter, sequence.length - 1);
        selected = { ...selected, ...sequence[sequenceIndex] };
      }
      selected = applyFailurePreset(selected, matched.route.failurePreset || {});
      if (matched.route.failurePreset?.type === 'connection-reset') {
        this.pushLog({ method: request.method, path: url.pathname, status: 'connection-reset', matchedRouteId: matched.route.id, duration: Date.now() - startedAt });
        request.socket.destroy();
        return;
      }
      if (matched.route.failurePreset?.type === 'timeout') {
        const timeoutMs = Math.min(30000, Number(matched.route.failurePreset.timeoutMs || 10000));
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      }
      const delayMs = Math.min(30000, Math.max(0, Number(selected.delayMs || 0)));
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const headers = { ...(selected.headers || {}) };
      const rawBody = selected.rawBody ?? (typeof selected.body === 'string' ? selected.body : JSON.stringify(selected.body ?? null));
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['content-type'] = typeof selected.body === 'string' ? 'text/plain' : 'application/json';
      if (matched.route.failurePreset?.type === 'partial-stream') {
        response.writeHead(Number(selected.status || 200), headers);
        response.write(rawBody.slice(0, Math.ceil(rawBody.length / 2)));
        response.destroy();
        this.pushLog({ method: request.method, path: url.pathname, status: 'partial-stream', matchedRouteId: matched.route.id, duration: Date.now() - startedAt });
        return;
      }
      response.writeHead(Number(selected.status || 200), headers);
      response.end(rawBody);
      this.pushLog({
        method: request.method,
        path: url.pathname,
        status: Number(selected.status || 200),
        matchedRouteId: matched.route.id,
        matchedRouteName: matched.route.name,
        selectedResponseId: selected.id || null,
        failurePreset: matched.route.failurePreset?.type || null,
        params: matched.match.params,
        requestBody: sanitizeRecordedValue(body.parsed),
        duration: Date.now() - startedAt
      });
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.message.includes('exceeds') ? 413 : 500, { 'content-type': 'application/json' });
      if (!response.writableEnded) response.end(JSON.stringify({ error: error.message }));
      this.pushLog({ method: request.method, path: url.pathname, status: 500, error: error.message, duration: Date.now() - startedAt });
    }
  }

  async proxy(request, response, rawBody, url, startedAt) {
    const target = new URL(`${url.pathname}${url.search}`, this.lab.proxyBaseUrl);
    const headers = { ...request.headers };
    delete headers.host;
    delete headers['content-length'];
    const proxyResponse = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : rawBody,
      redirect: 'manual'
    });
    const buffer = Buffer.from(await proxyResponse.arrayBuffer());
    const responseHeaders = Object.fromEntries(proxyResponse.headers.entries());
    response.writeHead(proxyResponse.status, responseHeaders);
    response.end(buffer);
    if (this.lab.recordProxyResponses && this.collection) {
      const contentType = String(responseHeaders['content-type'] || '').split(';')[0].toLowerCase();
      let recordedBody = buffer.toString('utf8');
      if (contentType.includes('json')) {
        try { recordedBody = sanitizeRecordedValue(JSON.parse(recordedBody)); } catch { recordedBody = '<invalid-json>'; }
      } else recordedBody = sanitizeRecordedValue(recordedBody);
      const existing = (this.lab.routes || []).find((route) => route.recorded === true && route.method === request.method && route.pathTemplate === url.pathname);
      const route = {
        id: existing?.id || crypto.randomUUID(),
        name: `Recorded ${request.method} ${url.pathname}`,
        enabled: true,
        recorded: true,
        method: request.method,
        pathTemplate: url.pathname,
        match: { query: {}, headers: {} },
        responses: [{
          id: crypto.randomUUID(),
          status: proxyResponse.status,
          headers: { 'content-type': contentType || 'application/octet-stream' },
          body: recordedBody,
          delayMs: 0,
          weight: 1
        }],
        passthrough: false,
        failurePreset: null
      };
      this.upsertRoute(this.collection, route);
    }
    this.pushLog({ method: request.method, path: url.pathname, status: proxyResponse.status, matchedRouteId: null, proxied: true, recorded: Boolean(this.lab.recordProxyResponses), duration: Date.now() - startedAt });
  }
}

module.exports = { MockLabService, readRequestBody, weightedResponse };
