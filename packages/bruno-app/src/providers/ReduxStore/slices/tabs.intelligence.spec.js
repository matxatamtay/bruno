const tabsModule = require('./tabs');
const { serializeTab, deserializeTab } = require('utils/snapshot');

const tabsReducer = tabsModule.default;
const { addTab } = tabsModule;

const makeState = (tabs = []) => ({
  tabs,
  activeTabUid: tabs[0]?.uid || null,
  recentlyClosedTabs: []
});

const collection = {
  uid: 'collection-uid',
  name: 'Collection',
  pathname: '/collections/a',
  items: []
};

describe('Intelligence tab navigation state', () => {
  it('stores the requested Intelligence mode and replay scenario on creation', () => {
    const next = tabsReducer(makeState(), addTab({
      uid: 'collection-uid-web-recorder',
      collectionUid: collection.uid,
      type: 'web-recorder',
      preview: false,
      intelligenceMode: 'traces',
      replayScenarioId: 'scenario-1'
    }));

    expect(next.tabs[0]).toMatchObject({
      type: 'web-recorder',
      intelligenceMode: 'traces',
      replayScenarioId: 'scenario-1'
    });
  });

  it('updates an existing singleton tab when a request chip opens another mode', () => {
    const existing = {
      uid: 'collection-uid-web-recorder',
      collectionUid: collection.uid,
      type: 'web-recorder',
      preview: false,
      intelligenceMode: 'coverage'
    };
    const next = tabsReducer(makeState([existing]), addTab({
      uid: existing.uid,
      collectionUid: collection.uid,
      type: 'web-recorder',
      preview: false,
      intelligenceMode: 'mocks',
      replayScenarioId: null
    }));

    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0]).toMatchObject({ intelligenceMode: 'mocks', replayScenarioId: null });
  });

  it('persists Intelligence mode in UI snapshots', () => {
    const serialized = serializeTab({
      uid: 'collection-uid-web-recorder',
      collectionUid: collection.uid,
      type: 'web-recorder',
      preview: false,
      intelligenceMode: 'contracts',
      replayScenarioId: 'scenario-2'
    }, collection);
    const restored = deserializeTab(serialized, collection);

    expect(serialized.intelligence).toEqual({ mode: 'contracts', scenarioId: 'scenario-2' });
    expect(restored).toMatchObject({
      uid: 'collection-uid-web-recorder',
      intelligenceMode: 'contracts',
      replayScenarioId: 'scenario-2'
    });
  });
});
