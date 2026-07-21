const http = require('node:http');
const axios = require('axios');
const { createRequestExecutionService } = require('../../src/services/request-execution-service');
const { createExecutionEventContext } = require('../../src/services/request-execution/execution-event-context');

describe('RequestExecutionService shared core', () => {
  it('executes headlessly and returns the normalized ExecutionResult envelope', async () => {
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ method: request.method, path: request.url }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const events = [];
    let tick = 1000;

    const service = createRequestExecutionService({
      idFactory: () => 'execution_phase1',
      now: () => tick += 25,
      emitEvent: (event) => events.push(event),
      executeRequest: async ({ item, signal, eventContext }) => {
        eventContext.emitLegacy('main:run-request-event', {
          type: 'request-sent',
          requestSent: {
            method: item.request.method,
            url: item.request.url,
            headers: { authorization: 'Bearer secret-token', accept: 'application/json' },
            data: { password: 'secret-password', visible: true },
            timestamp: 1025
          }
        });
        eventContext.emitLegacy('main:run-request-event', {
          type: 'assertion-results',
          results: [{ status: 'pass', description: 'status is 200' }]
        });
        eventContext.emitLegacy('main:run-request-event', {
          type: 'test-results',
          results: [{ status: 'pass', description: 'body is valid' }]
        });

        const response = await axios({
          method: item.request.method,
          url: item.request.url,
          signal
        });

        return {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data,
          size: JSON.stringify(response.data).length,
          duration: 12,
          timeline: [{ name: 'request', timestamp: 1 }]
        };
      }
    });

    try {
      const outcome = await service.execute({
        collection: { uid: 'collection_phase1', pathname: '/tmp/phase1' },
        item: {
          uid: 'request_phase1',
          type: 'http-request',
          request: { method: 'GET', url: `http://127.0.0.1:${port}/phase-1` }
        },
        executionContext: { source: 'headless-test' }
      });

      expect(outcome).toMatchObject({
        executionId: 'execution_phase1',
        protocol: 'http',
        status: 'success',
        durationMs: 25,
        request: {
          method: 'GET',
          headers: {
            authorization: '[REDACTED]',
            accept: 'application/json'
          },
          body: {
            password: '[REDACTED]',
            visible: true
          }
        },
        response: {
          status: 200,
          body: { method: 'GET', path: '/phase-1' },
          durationMs: 12
        }
      });
      expect(outcome.assertions).toHaveLength(1);
      expect(outcome.tests).toEqual([
        expect.objectContaining({ phase: 'tests', status: 'pass' })
      ]);
      expect(events.map((event) => event.type)).toEqual([
        'request.execution.started',
        'request.execution.completed'
      ]);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('preserves the exact legacy response only through executeLegacy', async () => {
    const legacyResult = { status: 201, data: { created: true }, requestSent: { method: 'POST', url: 'http://example.test' } };
    const service = createRequestExecutionService({ executeRequest: async () => legacyResult });

    await expect(service.executeLegacy({
      collection: { uid: 'collection_phase1' },
      item: { uid: 'request_phase1', type: 'graphql-request' }
    })).resolves.toBe(legacyResult);

    const outcome = await service.execute({
      collection: { uid: 'collection_phase1' },
      item: { uid: 'request_phase1', type: 'graphql-request' }
    });
    expect(outcome.protocol).toBe('graphql');
    expect(outcome.status).toBe('success');
    expect(outcome).not.toHaveProperty('legacyResult');
  });

  it('projects event-context variable changes and control metadata', async () => {
    const eventContext = createExecutionEventContext();
    const service = createRequestExecutionService({
      executeRequest: async ({ eventContext: context }) => {
        context.emitLegacy('main:runtime-variables-update', {
          runtimeVariables: { token: 'runtime-secret', publicValue: 42 }
        });
        context.recordControl({ nextRequestName: 'checkout', stopExecution: true });
        return { status: 200, data: {} };
      }
    });

    const outcome = await service.execute({
      collection: { uid: 'collection_phase1' },
      item: { uid: 'request_phase1', type: 'http-request' },
      executionContext: { eventContext }
    });

    expect(outcome.variableChanges).toEqual([{
      scope: 'runtime',
      values: { token: '[REDACTED]', publicValue: 42 }
    }]);
    expect(outcome.control).toEqual({ nextRequestName: 'checkout', stopExecution: true });
  });

  it('emits a failed terminal event and attaches a safe result when the adapter throws', async () => {
    const events = [];
    const service = createRequestExecutionService({
      emitEvent: (event) => events.push(event),
      executeRequest: async () => {
        throw new Error('executor exploded');
      }
    });

    let thrown;
    try {
      await service.execute({
        collection: { uid: 'collection_phase1' },
        item: { uid: 'request_phase1', type: 'http-request' }
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown.message).toBe('executor exploded');
    expect(thrown.executionResult).toMatchObject({ status: 'failed', protocol: 'http' });
    expect(events.map((event) => event.type)).toEqual([
      'request.execution.started',
      'request.execution.failed'
    ]);
  });

  it('returns a cancelled result when a running adapter observes AbortSignal', async () => {
    const controller = new AbortController();
    const service = createRequestExecutionService({
      executeRequest: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled while running');
          error.name = 'CanceledError';
          error.code = 'ERR_CANCELED';
          reject(error);
        }, { once: true });
      })
    });

    const execution = service.execute({
      collection: { uid: 'collection_phase1' },
      item: { uid: 'request_phase1', type: 'http-request' },
      signal: controller.signal
    });
    controller.abort(new Error('cancelled while running'));

    await expect(execution).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'REQUEST_CANCELLED' }
    });
  });

  it('returns a cancelled result without invoking an adapter when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by caller'));
    const executeRequest = jest.fn();
    const service = createRequestExecutionService({ executeRequest });

    const outcome = await service.execute({
      collection: { uid: 'collection_phase1' },
      item: { uid: 'request_phase1', type: 'http-request' },
      signal: controller.signal
    });

    expect(outcome.status).toBe('cancelled');
    expect(outcome.error.code).toBe('REQUEST_CANCELLED');
    expect(executeRequest).not.toHaveBeenCalled();
  });
});
