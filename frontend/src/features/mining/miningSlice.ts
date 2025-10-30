import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface MiningStats {
  currentHashrate: number | null;
  activeMiners: number | null;
  totalMined: number | null;
  hashrateHistory: number[];
}

const initialState: MiningStats = {
  currentHashrate: null,
  activeMiners: null,
  totalMined: null,
  hashrateHistory: [],
};

const miningSlice = createSlice({
  name: 'mining',
  initialState,
  reducers: {
    setStats: (state, action: PayloadAction<Partial<MiningStats>>) => {
      return { ...state, ...action.payload };
    },
    updateHashrate: (state, action: PayloadAction<number>) => {
      const newHistory = [...state.hashrateHistory, action.payload].slice(-60); // Keep last 60 readings
      return {
        ...state,
        currentHashrate: action.payload,
        hashrateHistory: newHistory,
      };
    },
  },
});

export const { setStats, updateHashrate } = miningSlice.actions;
export const selectMiningStats = (state: { mining: MiningStats }) => state.mining;
export default miningSlice.reducer;
