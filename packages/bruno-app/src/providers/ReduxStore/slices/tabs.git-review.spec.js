const tabsModule = require('./tabs');

const tabsReducer = tabsModule.default;
const { addTab, restoreTabs } = tabsModule;

const makeState = (overrides = {}) => ({
  tabs: [],
  activeTabUid: null,
  recentlyClosedTabs: [],
  ...overrides
});

describe('git review tab identity', () => {
  it('repairs an existing legacy git review tab that has no uid', () => {
    const state = makeState({
      tabs: [{
        collectionUid: 'collection-uid',
        type: 'git-review',
        preview: false,
        pathname: null
      }],
      activeTabUid: undefined
    });

    const nextState = tabsReducer(state, addTab({
      uid: 'collection-uid-git-review',
      collectionUid: 'collection-uid',
      type: 'git-review',
      preview: false
    }));

    expect(nextState.tabs).toHaveLength(1);
    expect(nextState.tabs[0].uid).toBe('collection-uid-git-review');
    expect(nextState.activeTabUid).toBe('collection-uid-git-review');
  });

  it('restores a legacy git review snapshot with a valid active uid', () => {
    const collection = {
      uid: 'collection-uid',
      pathname: '/collections/a',
      items: []
    };

    const nextState = tabsReducer(makeState(), restoreTabs({
      collection,
      tabs: [{
        type: 'git-review',
        accessor: 'pathname',
        pathname: null,
        permanent: true
      }],
      activeTab: { accessor: 'type', value: 'git-review' }
    }));

    expect(nextState.tabs).toHaveLength(1);
    expect(nextState.tabs[0].uid).toBe('collection-uid-git-review');
    expect(nextState.activeTabUid).toBe('collection-uid-git-review');
  });

  it('skips malformed restored tabs that still cannot produce an uid', () => {
    const collection = {
      uid: 'collection-uid',
      pathname: '/collections/a',
      items: []
    };

    const nextState = tabsReducer(makeState(), restoreTabs({
      collection,
      tabs: [{
        type: 'git-settings',
        accessor: 'pathname',
        pathname: null,
        permanent: true
      }],
      activeTab: { accessor: 'type', value: 'git-settings' }
    }));

    expect(nextState.tabs).toEqual([]);
    expect(nextState.activeTabUid).toBeNull();
  });
});
