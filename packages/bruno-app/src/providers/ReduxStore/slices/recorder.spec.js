import reducer, {
  recorderStateReceived,
  recorderEventReceived,
  recorderSessionLoaded,
  selectRecorderEvent
} from './recorder';

describe('recorder slice', () => {
  it('tracks bridge state and appends live events by session', () => {
    let state = reducer(undefined, recorderStateReceived({
      bridge: { running: true, host: '127.0.0.1', port: 6174, token: 'pair-token' },
      activeSession: { id: 'session-1', status: 'recording', eventCount: 0 }
    }));

    state = reducer(state, recorderEventReceived({
      sessionId: 'session-1',
      event: { id: 'event-1', type: 'action', timestamp: 1, data: { kind: 'click' } }
    }));

    expect(state.bridge.port).toBe(6174);
    expect(state.selectedSessionId).toBe('session-1');
    expect(state.eventsBySession['session-1']).toHaveLength(1);
    expect(state.activeSession.eventCount).toBe(1);
  });

  it('loads imported sessions and selects events', () => {
    let state = reducer(undefined, recorderSessionLoaded({
      manifest: { id: 'imported-1', name: 'Imported', status: 'imported' },
      events: [{ id: 'event-1', type: 'navigation', timestamp: 1, data: {} }]
    }));
    state = reducer(state, selectRecorderEvent('event-1'));

    expect(state.selectedSessionId).toBe('imported-1');
    expect(state.selectedEventId).toBe('event-1');
    expect(state.sessions[0].name).toBe('Imported');
  });
});
