import { flowCatalogEventReceived, flowCatalogFailed } from './flow-catalog';
import { registerFlowCatalogIpcListeners } from './flow-catalog-events';

describe('flow catalog IPC event bridge', () => {
  it('projects watcher events and errors into Redux and cleans both listeners', () => {
    const listeners = new Map();
    const removers = [];
    const ipcRenderer = {
      on: jest.fn((channel, listener) => {
        listeners.set(channel, listener);
        const remove = jest.fn();
        removers.push(remove);
        return remove;
      })
    };
    const dispatch = jest.fn();
    const cleanup = registerFlowCatalogIpcListeners({ ipcRenderer, dispatch });
    const event = { type: 'changed', relativePath: 'checkout.flow.yml' };

    listeners.get('main:flow-catalog-event')({ workspaceUid: 'workspace_local', event });
    listeners.get('main:flow-catalog-error')({ workspaceUid: 'workspace_local', error: 'watch failed' });

    expect(dispatch).toHaveBeenNthCalledWith(1, flowCatalogEventReceived({
      workspaceUid: 'workspace_local',
      event
    }));
    expect(dispatch).toHaveBeenNthCalledWith(2, flowCatalogFailed({
      workspaceUid: 'workspace_local',
      error: 'watch failed'
    }));

    cleanup();
    expect(removers[0]).toHaveBeenCalledTimes(1);
    expect(removers[1]).toHaveBeenCalledTimes(1);
  });
});
