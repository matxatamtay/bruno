import { showMcpRequestOnUi } from './mcpRequestUi';

jest.mock('utils/common', () => ({ uuid: () => 'task_1' }));

const workspaceUid = 'workspace_current';
const collectionPathname = '/workspace/collections/api';
const requestPathname = '/workspace/collections/api/users/get-user.bru';

const request = {
  uid: 'request_1',
  type: 'http-request',
  pathname: requestPathname,
  request: { params: [], body: { mode: 'none' } }
};

const makeState = ({ activeWorkspaceUid = workspaceUid, items = [request], taskQueue = [] } = {}) => ({
  app: { taskQueue },
  workspaces: { activeWorkspaceUid },
  collections: {
    collections: [{ uid: 'collection_1', pathname: collectionPathname, items }]
  }
});

const payload = {
  workspaceUid,
  collectionPathname,
  pathname: requestPathname,
  requestUid: request.uid,
  type: request.type
};

describe('showMcpRequestOnUi', () => {
  it('opens or focuses an existing request as a regular tab', () => {
    const dispatch = jest.fn();

    expect(showMcpRequestOnUi({ payload, dispatch, getState: () => makeState() })).toEqual({ opened: true });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tabs/addTab',
      payload: expect.objectContaining({
        uid: request.uid,
        collectionUid: 'collection_1',
        pathname: requestPathname,
        preview: false
      })
    }));
  });

  it('queues a newly created request until the collection watcher adds it', () => {
    const dispatch = jest.fn();

    expect(showMcpRequestOnUi({ payload, dispatch, getState: () => makeState({ items: [] }) })).toEqual({
      opened: false,
      queued: true
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'app/insertTaskIntoQueue',
      payload: expect.objectContaining({
        type: 'OPEN_REQUEST',
        collectionUid: 'collection_1',
        itemPathname: requestPathname,
        preview: false
      })
    }));
  });

  it('does nothing if the renderer has switched to another workspace', () => {
    const dispatch = jest.fn();

    expect(showMcpRequestOnUi({
      payload,
      dispatch,
      getState: () => makeState({ activeWorkspaceUid: 'workspace_other' })
    })).toEqual({ opened: false, reason: 'workspace_not_current' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
