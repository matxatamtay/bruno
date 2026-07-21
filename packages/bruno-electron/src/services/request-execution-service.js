const { uuid } = require('../utils/common');
const { createExecutionEventContext } = require('./request-execution/execution-event-context');
const { inferExecutionStatus, normalizeExecutionResult } = require('./request-execution/execution-result');

const EXECUTION_SOURCES = new Set(['renderer', 'flow-runtime', 'mcp', 'lca-bridge', 'headless-test', 'runner', 'system']);

const flowDebug = (stage, details = {}) => {
  console.log(`[FLOW-DEBUG][request][${new Date().toISOString()}] ${stage}`, details);
};
const debugError = (error) => ({
  name: error?.name,
  code: error?.code,
  message: error?.message || String(error || 'Unknown error'),
  stack: error?.stack
});

const inferProtocol = (item) => {
  switch (item?.type) {
    case 'http-request':
      return 'http';
    case 'graphql-request':
      return 'graphql';
    case 'grpc-request':
      return 'grpc';
    case 'ws-request':
      return 'websocket';
    default:
      return 'unknown';
  }
};

const validateInput = (input) => {
  if (!input || typeof input !== 'object') {
    throw new TypeError('RequestExecutionService.execute requires an input object');
  }
  if (!input.collection || typeof input.collection !== 'object') {
    throw new TypeError('RequestExecutionService.execute requires collection');
  }
  if (!input.item || typeof input.item !== 'object') {
    throw new TypeError('RequestExecutionService.execute requires item');
  }
};

class RequestExecutionService {
  constructor({
    adapters,
    executeRequest,
    idFactory = uuid,
    now = () => Date.now(),
    emitEvent = () => {},
    createEventContext = createExecutionEventContext
  }) {
    const fallbackAdapter = executeRequest ? { execute: executeRequest } : null;
    this.adapters = adapters || (fallbackAdapter ? { http: fallbackAdapter, graphql: fallbackAdapter, unknown: fallbackAdapter } : {});
    this.idFactory = idFactory;
    this.now = now;
    this.emitEvent = emitEvent;
    this.createEventContext = createEventContext;
  }

  getAdapter(protocol) {
    const adapter = this.adapters[protocol] || this.adapters.default || this.adapters.unknown;
    if (!adapter || typeof adapter.execute !== 'function') {
      throw new Error(`No request execution adapter registered for protocol: ${protocol}`);
    }
    return adapter;
  }

  emitLifecycleEvent({ type, executionId, source, protocol, status, durationMs, timestamp }) {
    this.emitEvent({
      schemaVersion: 1,
      type,
      executionId,
      source,
      protocol,
      status,
      durationMs,
      timestamp
    });
  }

  async executeWithLegacy(input, { normalizeResult = true } = {}) {
    validateInput(input);

    const executionContext = input.executionContext || {};
    const executionId = executionContext.executionId || this.idFactory();
    const source = EXECUTION_SOURCES.has(executionContext.source) ? executionContext.source : 'system';
    const protocol = inferProtocol(input.item);
    flowDebug('execution:start', {
      executionId,
      source,
      protocol,
      correlationId: executionContext.correlationId,
      flowUid: executionContext.flowUid,
      nodeId: executionContext.nodeId,
      itemUid: input.item?.uid,
      itemName: input.item?.name,
      itemType: input.item?.type,
      method: input.item?.request?.method,
      aborted: Boolean(input.signal?.aborted)
    });
    const startedAtMs = this.now();
    const eventContext = executionContext.eventContext || this.createEventContext({
      emitEvent: this.emitEvent,
      metadata: {
        executionId,
        source,
        protocol,
        correlationId: executionContext.correlationId,
        workspaceUid: input.workspaceContext?.uid
      }
    });

    this.emitLifecycleEvent({
      type: 'request.execution.started',
      executionId,
      source,
      protocol,
      timestamp: new Date(startedAtMs).toISOString()
    });

    let legacyResult;
    let thrownError;

    if (input.signal?.aborted) {
      legacyResult = {
        statusText: 'REQUEST_CANCELLED',
        isCancel: true,
        error: 'REQUEST_CANCELLED'
      };
    } else {
      try {
        flowDebug('execution:adapter-call', { executionId, source, protocol });
        legacyResult = await this.getAdapter(protocol).execute({
          ...input,
          protocol,
          eventContext,
          executionContext: {
            ...executionContext,
            executionId,
            source
          }
        });
        flowDebug('execution:adapter-returned', {
          executionId,
          source,
          protocol,
          status: legacyResult?.status,
          statusText: legacyResult?.statusText,
          isCancel: Boolean(legacyResult?.isCancel)
        });
      } catch (error) {
        flowDebug('execution:adapter-error', { executionId, source, protocol, error: debugError(error) });
        if (input.signal?.aborted || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') {
          legacyResult = {
            statusText: 'REQUEST_CANCELLED',
            isCancel: true,
            error: 'REQUEST_CANCELLED',
            timeline: error?.timeline
          };
        } else {
          thrownError = error;
        }
      }
    }

    const completedAtMs = this.now();
    const durationMs = Math.max(0, completedAtMs - startedAtMs);
    const result = normalizeResult
      ? normalizeExecutionResult({
          executionId,
          protocol,
          item: input.item,
          legacyResult,
          thrownError,
          signal: input.signal,
          projection: eventContext.getProjection(),
          durationMs
        })
      : null;
    const status = inferExecutionStatus(legacyResult, thrownError, input.signal);
    flowDebug('execution:normalized', {
      executionId,
      source,
      protocol,
      status,
      durationMs,
      resultStatus: result?.status,
      responseStatus: result?.response?.status,
      thrownError: thrownError ? debugError(thrownError) : null
    });

    this.emitLifecycleEvent({
      type: `request.execution.${status === 'success' ? 'completed' : status}`,
      executionId,
      source,
      protocol,
      status,
      durationMs,
      timestamp: new Date(completedAtMs).toISOString()
    });

    if (thrownError) {
      if (result) {
        thrownError.executionResult = result;
      }
      throw thrownError;
    }

    return { result, legacyResult };
  }

  async execute(input) {
    const { result } = await this.executeWithLegacy(input);
    return result;
  }

  async executeLegacy(input) {
    const { legacyResult } = await this.executeWithLegacy(input, { normalizeResult: false });
    return legacyResult;
  }
}

const createRequestExecutionService = (options) => new RequestExecutionService(options);

module.exports = {
  RequestExecutionService,
  createRequestExecutionService,
  inferProtocol
};
