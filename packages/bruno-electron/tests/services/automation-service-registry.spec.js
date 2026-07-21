const {
  registerAutomationServices,
  getAutomationServices,
  getRequestExecutionService,
  getFlowPersistenceService,
  getFlowRuntimeService,
  resetAutomationServicesForTest
} = require('../../src/services/automation-service-registry');

describe('automation service registry', () => {
  afterEach(() => {
    resetAutomationServicesForTest();
  });

  it('exposes the main-process RequestExecutionService to non-renderer callers', () => {
    const requestExecutionService = { execute: jest.fn() };

    registerAutomationServices({ requestExecutionService });

    expect(getRequestExecutionService()).toBe(requestExecutionService);
    expect(getAutomationServices()).toEqual({ requestExecutionService });
  });

  it('exposes the FlowPersistenceService to headless and MCP callers', () => {
    const flowPersistenceService = { readFlow: jest.fn(), saveFlow: jest.fn() };

    registerAutomationServices({ flowPersistenceService });

    expect(getFlowPersistenceService()).toBe(flowPersistenceService);
  });

  it('exposes the FlowRuntimeService to future MCP and headless callers', () => {
    const flowRuntimeService = { run: jest.fn(), previewRequest: jest.fn() };

    registerAutomationServices({ flowRuntimeService });

    expect(getFlowRuntimeService()).toBe(flowRuntimeService);
  });

  it('fails closed before services are registered', () => {
    expect(() => getRequestExecutionService()).toThrow('has not been registered');
    expect(() => getFlowPersistenceService()).toThrow('has not been registered');
    expect(() => getFlowRuntimeService()).toThrow('has not been registered');
  });
});
