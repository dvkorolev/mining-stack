/**
 * RTK Query API Slice
 * Centralized API configuration with automatic caching and re-fetching
 */

import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { MiningStatsResponse } from './api';

// Define API base URL
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Define API endpoints and their types
export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: API_BASE_URL }),
  tagTypes: ['MiningStats', 'Miners', 'Alerts', 'MinerPools'],
  endpoints: (builder) => ({
    // Get mining stats
    getMiningStats: builder.query<MiningStatsResponse, void>({
      query: () => '/mining/stats',
      providesTags: ['MiningStats'],
      // Note: Polling is configured in the component using the hook
    }),

    // Get miners list
    getMiners: builder.query<{ miners: any[] }, void>({
      query: () => '/mining/miners',
      providesTags: ['Miners'],
    }),

    // Add miner
    addMiner: builder.mutation<any, { ip: string; model: string; name?: string; alias?: string; owner?: string }>({
      query: (miner) => ({
        url: '/mining/miners',
        method: 'POST',
        body: miner,
      }),
      invalidatesTags: ['Miners', 'MiningStats'],
    }),

    // Update miner
    updateMiner: builder.mutation<any, { minerId: string; updates: any }>({
      query: ({ minerId, updates }) => ({
        url: `/mining/miners/${minerId}`,
        method: 'PUT',
        body: updates,
      }),
      invalidatesTags: ['Miners', 'MiningStats'],
    }),

    // Delete miner
    deleteMiner: builder.mutation<any, string>({
      query: (minerId) => ({
        url: `/mining/miners/${minerId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Miners', 'MiningStats'],
    }),

    // Reboot miner
    rebootMiner: builder.mutation<any, string>({
      query: (minerId) => ({
        url: `/mining/miners/${minerId}/reboot`,
        method: 'POST',
      }),
    }),

    // Bulk reboot miners
    bulkRebootMiners: builder.mutation<any, string[]>({
      query: (minerIds) => ({
        url: '/mining/miners/bulk/reboot',
        method: 'POST',
        body: { minerIds },
      }),
    }),

    // Reboot all miners
    rebootAllMiners: builder.mutation<any, void>({
      query: () => ({
        url: '/mining/miners/reboot-all',
        method: 'POST',
      }),
    }),

    // Get miner pools
    getMinerPools: builder.query<any, string>({
      query: (minerId) => `/mining/miners/${minerId}/pools`,
      providesTags: (result, error, minerId) => [{ type: 'MinerPools', id: minerId }],
    }),

    // Update miner pools
    updateMinerPools: builder.mutation<any, { minerId: string; pools: any[] }>({
      query: ({ minerId, pools }) => ({
        url: `/mining/miners/${minerId}/pools`,
        method: 'PUT',
        body: { pools },
      }),
      invalidatesTags: (result, error, { minerId }) => [{ type: 'MinerPools', id: minerId }],
    }),

    // Bulk update pools
    bulkUpdatePools: builder.mutation<any, { minerIds: string[]; pools: any[] }>({
      query: ({ minerIds, pools }) => ({
        url: '/mining/miners/bulk/pools',
        method: 'POST',
        body: { minerIds, pools },
      }),
      invalidatesTags: ['MinerPools'],
    }),

    // Get active alerts
    getActiveAlerts: builder.query<any[], void>({
      query: () => '/alerts/active',
      providesTags: ['Alerts'],
      // Note: Polling is configured in the component using the hook
    }),

    // Get alert history
    getAlertHistory: builder.query<any[], number>({
      query: (limit = 100) => `/alerts/history?limit=${limit}`,
      providesTags: ['Alerts'],
    }),

    // Get miner-specific alerts
    getMinerAlerts: builder.query<any[], string>({
      query: (minerId) => `/alerts/miner/${minerId}`,
      providesTags: (result, error, minerId) => [{ type: 'Alerts', id: minerId }],
    }),

    // Get alert statistics
    getAlertStats: builder.query<any, void>({
      query: () => '/alerts/stats',
      providesTags: ['Alerts'],
    }),

    // Get historical stats
    getHistoricalStats: builder.query<any, { start: number; end: number; granularity?: 'raw' | 'hourly' | 'daily' }>({
      query: ({ start, end, granularity = 'raw' }) => 
        `/mining/history?start=${start}&end=${end}&granularity=${granularity}`,
    }),

    // Get database info
    getDatabaseInfo: builder.query<any, void>({
      query: () => '/mining/database/info',
    }),
  }),
});

// Export hooks for usage in components
export const {
  useGetMiningStatsQuery,
  useGetMinersQuery,
  useAddMinerMutation,
  useUpdateMinerMutation,
  useDeleteMinerMutation,
  useRebootMinerMutation,
  useBulkRebootMinersMutation,
  useRebootAllMinersMutation,
  useGetMinerPoolsQuery,
  useUpdateMinerPoolsMutation,
  useBulkUpdatePoolsMutation,
  useGetActiveAlertsQuery,
  useGetAlertHistoryQuery,
  useGetMinerAlertsQuery,
  useGetAlertStatsQuery,
  useGetHistoricalStatsQuery,
  useGetDatabaseInfoQuery,
} = apiSlice;
