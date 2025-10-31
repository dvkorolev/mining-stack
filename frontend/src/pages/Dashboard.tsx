import React, { useEffect, useState } from 'react';
import { Grid, Typography, Paper, Box, CircularProgress, Alert, Chip } from '@mui/material';
import { Line } from 'react-chartjs-2';
import { fetchMiningStats, MiningStatsResponse } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const UPDATE_INTERVAL = parseInt(process.env.REACT_APP_UPDATE_INTERVAL || '5000', 10);
// Use relative WebSocket URL to work with nginx proxy
const WS_URL = process.env.REACT_APP_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<MiningStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WebSocket with automatic reconnection
  const { isConnected, reconnectCount } = useWebSocket({
    url: WS_URL,
    onMessage: (message) => {
      if (message.type === 'mining-stats') {
        setStats(message.data);
        setError(null);
      }
    },
    onOpen: () => {
      console.log('WebSocket connected');
      setError(null);
    },
    onClose: () => {
      console.log('WebSocket disconnected');
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error - attempting to reconnect...');
    },
    reconnectAttempts: 10,
    reconnectInterval: 2000,
  });

  useEffect(() => {
    // Initial data load
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await fetchMiningStats();
        setStats(data);
        setError(null);
      } catch (error) {
        console.error('Error fetching mining stats:', error);
        setError('Failed to load mining statistics');
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Fallback polling if WebSocket fails
    const pollInterval = setInterval(loadData, UPDATE_INTERVAL);

    return () => {
      clearInterval(pollInterval);
    };
  }, []);

  // Chart data from stats history
  const chartData = {
    labels: stats?.statsHistory?.map((item) => 
      new Date(item.timestamp).toLocaleTimeString()
    ) || [],
    datasets: [
      {
        label: 'Hashrate (TH/s)',
        data: stats?.statsHistory?.map((item) => item.hashrate) || [],
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.4,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Hashrate Over Time',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  if (loading && !stats) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">
          Mining Dashboard
        </Typography>
        <Chip 
          label={isConnected ? 'Connected' : `Reconnecting... (${reconnectCount})`}
          color={isConnected ? 'success' : 'warning'}
          size="small"
        />
      </Box>

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      
      <Grid container spacing={3}>
        {/* Hashrate Card */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              Current Hashrate
            </Typography>
            <Typography variant="h4">
              {stats?.totalHashrate ? `${stats.totalHashrate} TH/s` : 'N/A'}
            </Typography>
          </Paper>
        </Grid>

        {/* Active Miners Card */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              Active Miners
            </Typography>
            <Typography variant="h4">
              {stats?.activeMiners !== undefined ? stats.activeMiners : 'N/A'}
            </Typography>
          </Paper>
        </Grid>

        {/* Total Mined Card */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              Total Mined (24h)
            </Typography>
            <Typography variant="h4">
              {stats?.totalMined ? `${stats.totalMined} BTC` : 'N/A'}
            </Typography>
          </Paper>
        </Grid>

        {/* Hashrate Chart */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ height: '400px' }}>
              <Line data={chartData} options={options} />
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
