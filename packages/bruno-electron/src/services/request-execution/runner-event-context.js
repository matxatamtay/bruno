const { createExecutionEventContext } = require('./execution-event-context');

const toRunnerPayload = (payload, eventData) => {
  switch (payload.type) {
    case 'test-results-pre-request':
      return {
        type: payload.type,
        preRequestTestResults: payload.results,
        ...eventData
      };
    case 'test-results-post-response':
      return {
        type: payload.type,
        postResponseTestResults: payload.results,
        ...eventData
      };
    case 'assertion-results':
      return {
        type: payload.type,
        assertionResults: payload.results,
        ...eventData
      };
    case 'test-results':
      return {
        type: payload.type,
        testResults: payload.results,
        ...eventData
      };
    default:
      return {
        ...payload,
        ...eventData
      };
  }
};

const createRunnerExecutionEventContext = ({
  eventData,
  forwardLegacyEvent,
  emitEvent = () => {},
  metadata = {}
}) => createExecutionEventContext({
  emitEvent,
  metadata,
  forwardLegacyEvent: (channel, payload) => {
    if (channel !== 'main:run-request-event') {
      forwardLegacyEvent(channel, payload);
      return;
    }

    // Runner emits this before prompt-variable checks, so suppress the service duplicate.
    if (payload.type === 'request-queued') return;

    forwardLegacyEvent('main:run-folder-event', toRunnerPayload(payload, eventData));
  }
});

module.exports = {
  createRunnerExecutionEventContext,
  toRunnerPayload
};
