import { configureStore } from '@reduxjs/toolkit';
import miningReducer from './features/mining/miningSlice';
import websocketMiddleware from './middleware/websocketMiddleware';

export const store = configureStore({
  reducer: {
    mining: miningReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ['your/action/type'],
        // Ignore these field paths in all actions
        ignoredActionPaths: ['meta.arg', 'payload.timestamp', 'payload.lastSeen'],
        // Ignore these paths in the state
        ignoredPaths: ['mining.stats.miners', 'mining.stats.timestamp'],
      },
    }).concat(websocketMiddleware),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
