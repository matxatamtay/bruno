import { createSlice } from '@reduxjs/toolkit';

const MAX_LIVE_EVENTS = 5000;

const initialState = {
  bridge: { running: false, host: '127.0.0.1', port: null, token: '' },
  activeSession: null,
  sessions: [],
  eventsBySession: {},
  selectedSessionId: null,
  selectedEventId: null,
  error: null
};

export const recorderSlice = createSlice({
  name: 'recorder',
  initialState,
  reducers: {
    recorderStateReceived: (state, action) => {
      state.bridge = action.payload?.bridge || state.bridge;
      state.activeSession = action.payload?.activeSession || null;
      if (state.activeSession?.id && !state.selectedSessionId) state.selectedSessionId = state.activeSession.id;
      if (state.activeSession?.id && !state.eventsBySession[state.activeSession.id]) state.eventsBySession[state.activeSession.id] = [];
    },
    recorderEventReceived: (state, action) => {
      const { sessionId, event } = action.payload || {};
      if (!sessionId || !event) return;
      const current = state.eventsBySession[sessionId] || [];
      current.push(event);
      if (current.length > MAX_LIVE_EVENTS) current.splice(0, current.length - MAX_LIVE_EVENTS);
      state.eventsBySession[sessionId] = current;
      if (state.activeSession?.id === sessionId) state.activeSession.eventCount = (state.activeSession.eventCount || 0) + 1;
    },
    recorderSessionsLoaded: (state, action) => {
      state.sessions = Array.isArray(action.payload) ? action.payload : [];
    },
    recorderSessionLoaded: (state, action) => {
      const { manifest, events } = action.payload || {};
      if (!manifest?.id) return;
      state.eventsBySession[manifest.id] = Array.isArray(events) ? events.slice(-MAX_LIVE_EVENTS) : [];
      const existingIndex = state.sessions.findIndex((session) => session.id === manifest.id);
      if (existingIndex >= 0) state.sessions[existingIndex] = manifest;
      else state.sessions.unshift(manifest);
      state.selectedSessionId = manifest.id;
      state.selectedEventId = null;
    },
    selectRecorderSession: (state, action) => {
      state.selectedSessionId = action.payload || null;
      state.selectedEventId = null;
    },
    selectRecorderEvent: (state, action) => {
      state.selectedEventId = action.payload || null;
    },
    recorderErrorSet: (state, action) => {
      state.error = action.payload || null;
    }
  }
});

export const {
  recorderStateReceived,
  recorderEventReceived,
  recorderSessionsLoaded,
  recorderSessionLoaded,
  selectRecorderSession,
  selectRecorderEvent,
  recorderErrorSet
} = recorderSlice.actions;

export default recorderSlice.reducer;
