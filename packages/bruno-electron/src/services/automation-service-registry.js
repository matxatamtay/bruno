let automationServices = Object.freeze({});

const registerAutomationServices = (services) => {
  if (!services || typeof services !== 'object') {
    throw new TypeError('registerAutomationServices requires a services object');
  }

  automationServices = Object.freeze({
    ...automationServices,
    ...services
  });

  return automationServices;
};

const getAutomationServices = () => automationServices;

const getRequestExecutionService = () => {
  const service = automationServices.requestExecutionService;
  if (!service) {
    throw new Error('RequestExecutionService has not been registered');
  }
  return service;
};

const getFlowPersistenceService = () => {
  const service = automationServices.flowPersistenceService;
  if (!service) {
    throw new Error('FlowPersistenceService has not been registered');
  }
  return service;
};

const getFlowRuntimeService = () => {
  const service = automationServices.flowRuntimeService;
  if (!service) {
    throw new Error('FlowRuntimeService has not been registered');
  }
  return service;
};

const resetAutomationServicesForTest = () => {
  automationServices = Object.freeze({});
};

module.exports = {
  registerAutomationServices,
  getAutomationServices,
  getRequestExecutionService,
  getFlowPersistenceService,
  getFlowRuntimeService,
  resetAutomationServicesForTest
};
