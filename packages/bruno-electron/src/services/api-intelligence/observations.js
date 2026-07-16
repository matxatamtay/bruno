const crypto = require('crypto');
const { inferSchema, schemaFingerprint } = require('./schema');
const { contentTypeFromResponse, responseBodyForSchema } = require('./contracts');

const buildObservationFromShape = ({
  requestRef,
  status,
  duration = null,
  contentType = null,
  schema,
  source = 'single-run',
  environmentKey = null,
  timestamp = null
}) => {
  const normalizedStatus = Number(status);
  if (!Number.isInteger(normalizedStatus)) throw new Error('A completed HTTP response is required to record an observation');
  if (!schema || typeof schema !== 'object') throw new Error('A response schema is required to record an observation');
  return {
    observationId: crypto.randomUUID(),
    schemaVersion: 1,
    source,
    requestRef,
    environmentKey,
    timestamp: timestamp || new Date().toISOString(),
    response: {
      status: normalizedStatus,
      duration: Number.isFinite(Number(duration)) ? Number(duration) : null,
      contentType: contentType ? String(contentType).split(';')[0].trim().toLowerCase() : null,
      schema,
      fingerprint: schemaFingerprint(schema)
    }
  };
};

const buildObservation = ({ requestRef, response, source = 'single-run', environmentKey = null }) => {
  const schema = inferSchema(responseBodyForSchema(response));
  return buildObservationFromShape({
    requestRef,
    status: response?.status,
    duration: response?.duration,
    contentType: contentTypeFromResponse(response),
    schema,
    source,
    environmentKey
  });
};

module.exports = { buildObservation, buildObservationFromShape };
