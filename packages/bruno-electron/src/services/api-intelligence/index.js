const { buildCollectionIdentity, buildRequestIdentity, resolveCollectionReference, resolveRequestReference, requestFingerprint } = require('./identity');
const { ContractStore } = require('./storage/contract-store');
const { ObservationStore } = require('./storage/observation-store');
const { CoverageStore } = require('./storage/coverage-store');
const { TraceStore } = require('./storage/trace-store');
const { TestDataStore } = require('./storage/test-data-store');
const { IntelligenceBundle } = require('./storage/intelligence-bundle');
const { createContractFromResponse, createContractFromObservations, generateAssertionsFromContract, compareContractWithResponse, compareContractWithObservation } = require('./contracts');
const { createContractFromOpenApi } = require('./openapi-contract');
const { buildObservation, buildObservationFromShape } = require('./observations');
const { computeCoverage } = require('./coverage');
const { buildTraceFromRun, compareTraces, sanitizeValue } = require('./traces');
const { materializeProfile, seededRandom, generateValue, parseCsv, serializeCsv } = require('./test-data');
const { MockLabService } = require('./mock-lab-service');
const { buildMockRoute, matchRoute, applyFailurePreset, exampleFromSchema } = require('./mock-lab');
const schema = require('./schema');

module.exports = {
  buildCollectionIdentity,
  buildRequestIdentity,
  resolveCollectionReference,
  resolveRequestReference,
  requestFingerprint,
  ContractStore,
  ObservationStore,
  CoverageStore,
  TraceStore,
  TestDataStore,
  IntelligenceBundle,
  MockLabService,
  buildObservation,
  buildObservationFromShape,
  createContractFromResponse,
  createContractFromObservations,
  generateAssertionsFromContract,
  createContractFromOpenApi,
  compareContractWithResponse,
  compareContractWithObservation,
  computeCoverage,
  buildTraceFromRun,
  compareTraces,
  sanitizeValue,
  materializeProfile,
  seededRandom,
  generateValue,
  parseCsv,
  serializeCsv,
  buildMockRoute,
  matchRoute,
  applyFailurePreset,
  exampleFromSchema,
  ...schema
};
