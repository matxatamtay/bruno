import { recordRunnerObservation } from './useIpcEvents';

const collection = {
  uid: 'collection-1',
  name: 'Shop API',
  pathname: '/tmp/shop-api',
  activeEnvironmentUid: 'dev',
  items: [{
    uid: 'get-user',
    name: 'Get user',
    type: 'http-request',
    pathname: '/tmp/shop-api/GetUser.bru',
    request: { method: 'GET', url: '{{baseUrl}}/users/{{id}}' }
  }]
};

const store = {
  getState: () => ({ collections: { collections: [collection] } })
};

describe('Runner intelligence observations', () => {
  test('records completed Collection Runner responses through the local intelligence IPC', async () => {
    const ipcRenderer = { invoke: jest.fn().mockResolvedValue({ observationId: 'observation-1' }) };
    await recordRunnerObservation({
      ipcRenderer,
      store,
      val: {
        type: 'response-received',
        collectionUid: collection.uid,
        itemUid: 'get-user',
        responseReceived: { status: 200, duration: 45, headers: { 'content-type': 'application/json' }, data: { id: 'usr_1' } }
      }
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:api-intelligence:record-observation',
      expect.objectContaining({
        source: 'runner',
        environmentKey: 'dev',
        collection: expect.objectContaining({ uid: collection.uid }),
        request: expect.objectContaining({ uid: 'get-user' }),
        response: expect.objectContaining({ status: 200 })
      })
    );
  });

  test('ignores non-response and incomplete runner events', () => {
    const ipcRenderer = { invoke: jest.fn() };
    expect(recordRunnerObservation({ ipcRenderer, store, val: { type: 'request-sent' } })).toBeNull();
    expect(recordRunnerObservation({ ipcRenderer, store, val: { type: 'response-received', responseReceived: { status: 'Error' } } })).toBeNull();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });
});
