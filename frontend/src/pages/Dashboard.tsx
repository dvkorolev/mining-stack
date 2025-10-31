import React, { useEffect, useState } from 'react';
import { Grid, Typography, Paper, Box, CircularProgress, Alert } from '@mui/material';
import { Line } from 'react-chartjs-2';
import { fetchMiningStats, MiningStatsResponse } from '../services/api';
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
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:5000/ws';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<MiningStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);

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

    // Setup WebSocket connection for real-time updates
    const websocket = new WebSocket(WS_URL);
    
    websocket.onopen = () => {
      console.log('WebSocket connected');
      setError(null);
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'mining-stats') {
          setStats(message.data);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
    };

    setWs(websocket);

    // Fallback polling if WebSocket fails
    const pollInterval = setInterval(loadData, UPDATE_INTERVAL);

    return () => {
      clearInterval(pollInterval);
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
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
      <Typography variant="h4" gutterBottom>
        Mining Dashboard
      </Typography>

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
