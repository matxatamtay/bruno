import { insertTaskIntoQueue } from 'providers/ReduxStore/slices/app';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { uuid } from 'utils/common';
import { normalizePath } from 'utils/common/path';
import {
  findItemInCollectionByItemUid,
  findItemInCollectionByPathname,
  getDefaultRequestPaneTab
} from 'utils/collections';

export const showMcpRequestOnUi = ({ payload, dispatch, getState }) => {
  const state = getState();
  if (state.workspaces?.activeWorkspaceUid !== payload.workspaceUid) {
    return { opened: false, reason: 'workspace_not_current' };
  }

  const collectionPathname = normalizePath(payload.collectionPathname || '');
  const collection = state.collections?.collections?.find(
    (candidate) => normalizePath(candidate.pathname || '') === collectionPathname
  );
  if (!collection) return { opened: false, reason: 'collection_not_open' };

  const item = findItemInCollectionByPathname(collection, payload.pathname)
    || findItemInCollectionByItemUid(collection, payload.requestUid);
  if (item) {
    dispatch(addTab({
      uid: item.uid,
      collectionUid: collection.uid,
      type: item.type,
      pathname: item.pathname,
      requestPaneTab: getDefaultRequestPaneTab(item),
      preview: false,
      ...(item.isTransient ? { isTransient: true } : {})
    }));
    return { opened: true };
  }

  const alreadyQueued = state.app?.taskQueue?.some(
    (task) => task.type === 'OPEN_REQUEST'
      && task.collectionUid === collection.uid
      && normalizePath(task.itemPathname || '') === normalizePath(payload.pathname || '')
  );
  if (!alreadyQueued) {
    dispatch(insertTaskIntoQueue({
      uid: uuid(),
      type: 'OPEN_REQUEST',
      collectionUid: collection.uid,
      itemPathname: payload.pathname,
      preview: false
    }));
  }
  return { opened: false, queued: true };
};
