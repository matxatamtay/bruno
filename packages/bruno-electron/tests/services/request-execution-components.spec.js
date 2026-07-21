const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHttpGraphqlAdapter } = require('../../src/services/request-execution/adapters/http-graphql-adapter');
const { linkAbortSignal, delayWithSignal, attachDeferredStreamCleanup } = require('../../src/services/request-execution/abort');
const { createRunnerExecutionEventContext, toRunnerPayload } = require('../../src/services/request-execution/runner-event-context');

describe('shared request execution components', () => {
  it('delegates HTTP and GraphQL to one protocol lifecycle adapter', async () => {
    const executeLifecycle = jest.fn(async ({ protocol }) => ({ status: 200, protocol }));
    const adapter = createHttpGraphqlAdapter({ executeLifecycle });

    await expect(adapter.execute({ protocol: 'http' })).resolves.toEqual({ status: 200, protocol: 'http' });
    await expect(adapter.execute({ protocol: 'graphql' })).resolves.toEqual({ status: 200, protocol: 'graphql' });
    expect(() => adapter.execute({ protocol: 'grpc' })).toThrow('does not support protocol');
    expect(executeLifecycle).toHaveBeenCalledTimes(2);
  });

  it('links external cancellation to the lifecycle AbortController', () => {
    const source = new AbortController();
    const target = new AbortController();
    const unlink = linkAbortSignal(source.signal, target);

    source.abort(new Error('stop now'));

    expect(target.signal.aborted).toBe(true);
    expect(target.signal.reason.message).toBe('stop now');
    unlink();
  });

  it('cancels an execution delay through the same signal', async () => {
    const controller = new AbortController();
    const delayed = delayWithSignal(10000, controller.signal);
    controller.abort(new Error('cancel delay'));

    await expect(delayed).rejects.toThrow('cancel delay');
  });

  it('defers stream cleanup until synchronous legacy listeners finish', async () => {
    const stream = new EventEmitter();
    const order = [];

    attachDeferredStreamCleanup(stream, () => order.push('cleanup'));
    stream.on('close', () => order.push('legacy-stream-end'));
    stream.emit('close');

    expect(order).toEqual(['legacy-stream-end']);
    await Promise.resolve();
    expect(order).toEqual(['legacy-stream-end', 'cleanup']);
  });

  it('translates request events to the legacy runner event contract', () => {
    const forwarded = [];
    const eventData = { collectionUid: 'collection', folderUid: 'folder', itemUid: 'item' };
    const context = createRunnerExecutionEventContext({
      eventData,
      forwardLegacyEvent: (channel, payload) => forwarded.push({ channel, payload })
    });

    context.emitLegacy('main:run-request-event', {
      type: 'assertion-results',
      results: [{ status: 'pass' }]
    });
    context.emitLegacy('main:run-request-event', { type: 'request-queued' });
    context.emitLegacy('main:cookies-update', [{ domain: 'example.test' }]);

    expect(forwarded).toEqual([
      {
        channel: 'main:run-folder-event',
        payload: {
          type: 'assertion-results',
          assertionResults: [{ status: 'pass' }],
          ...eventData
        }
      },
      {
        channel: 'main:cookies-update',
        payload: [{ domain: 'example.test' }]
      }
    ]);
    expect(toRunnerPayload({ type: 'test-results', results: [1] }, eventData)).toEqual({
      type: 'test-results',
      testResults: [1],
      ...eventData
    });
  });

  it('keeps one renderer-neutral HTTP/GraphQL lifecycle in the Electron network module', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/ipc/network/index.js'), 'utf8');
    expect(source.match(/^\s*response = await axiosInstance\(request\);$/gm)).toHaveLength(1);
    expect(source).toContain('requestExecutionService.executeWithLegacy');

    const lifecycleStart = source.indexOf('  const runRequest = async (');
    const lifecycleEnd = source.indexOf('  const extractPromptVariablesForRequest', lifecycleStart);
    expect(lifecycleStart).toBeGreaterThan(-1);
    expect(lifecycleEnd).toBeGreaterThan(lifecycleStart);
    expect(source.slice(lifecycleStart, lifecycleEnd)).not.toContain('mainWindow.webContents.send');
  });
});
