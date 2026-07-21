const SUPPORTED_PROTOCOLS = new Set(['http', 'graphql']);

class HttpGraphqlAdapter {
  constructor({ executeLifecycle }) {
    if (typeof executeLifecycle !== 'function') {
      throw new TypeError('HttpGraphqlAdapter requires executeLifecycle');
    }
    this.executeLifecycle = executeLifecycle;
  }

  supports(protocol) {
    return SUPPORTED_PROTOCOLS.has(protocol);
  }

  execute(input) {
    if (!this.supports(input.protocol)) {
      throw new Error(`HttpGraphqlAdapter does not support protocol: ${input.protocol}`);
    }
    return this.executeLifecycle(input);
  }
}

const createHttpGraphqlAdapter = (options) => new HttpGraphqlAdapter(options);

module.exports = {
  HttpGraphqlAdapter,
  createHttpGraphqlAdapter
};
