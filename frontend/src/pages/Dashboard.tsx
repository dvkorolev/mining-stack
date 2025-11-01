import React, { useEffect, useState } from 'react';
import { Grid, Typography, Paper, Box, CircularProgress, Alert, Chip, ToggleButton, ToggleButtonGroup, Card, CardContent } from '@mui/material';
import { Line, Bar } from 'react-chartjs-2';
import { fetchMiningStats, MiningStatsResponse } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const UPDATE_INTERVAL = parseInt(process.env.REACT_APP_UPDATE_INTERVAL || '5000', 10);
// Use relative WebSocket URL to work with nginx proxy
const WS_URL = process.env.REACT_APP_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<MiningStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h'>('24h');
  const [previousStats, setPreviousStats] = useState<MiningStatsResponse | null>(null);

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
        setPreviousStats(stats); // Store previous for comparison
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

  // Calculate trends
  const calculateTrend = (current: number, previous: number | undefined) => {
    if (!previous || previous === 0) return { value: 0, isPositive: true };
    const change = ((current - previous) / previous) * 100;
    return { value: Math.abs(change), isPositive: change >= 0 };
  };

  const hashrateTrend = calculateTrend(stats?.totalHashrate || 0, previousStats?.totalHashrate);
  const minersTrend = calculateTrend(stats?.activeMiners || 0, previousStats?.activeMiners);

  // Filter history based on time range
  const getFilteredHistory = () => {
    if (!stats?.statsHistory) return [];
    const now = Date.now();
    const ranges = { '1h': 3600000, '6h': 21600000, '24h': 86400000 };
    const cutoff = now - ranges[timeRange];
    return stats.statsHistory.filter(item => item.timestamp >= cutoff);
  };

  const filteredHistory = getFilteredHistory();

  // Hashrate chart
  const hashrateChartData = {
    labels: filteredHistory.map((item) => 
      new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    ),
    datasets: [
      {
        label: 'Hashrate (TH/s)',
        data: filteredHistory.map((item) => item.hashrate),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
      },
      {
        label: '24h Average',
        data: filteredHistory.map(() => stats?.averageHashrate24h || 0),
        borderColor: 'rgb(255, 159, 64)',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0,
      },
    ],
  };

  // BTC earnings chart
  const btcChartData = {
    labels: filteredHistory.map((item) => 
      new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    ),
    datasets: [
      {
        label: 'BTC Mined (Cumulative)',
        data: filteredHistory.map((_, index) => {
          // Calculate cumulative BTC for this time range
          const networkHashrate = 600000000;
          const dailyBTC = 450;
          const updateInterval = 5000;
          const timeFraction = updateInterval / 1000 / 86400;
          const avgHashrate = filteredHistory[index]?.hashrate || 0;
          const btcPerUpdate = (avgHashrate / networkHashrate) * dailyBTC * timeFraction;
          return filteredHistory.slice(0, index + 1).reduce((sum, h) => 
            sum + ((h.hashrate / networkHashrate) * dailyBTC * timeFraction), 0
          );
        }),
        borderColor: 'rgb(255, 205, 86)',
        backgroundColor: 'rgba(255, 205, 86, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
      },
    ],
  };

  const hashrateChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Hashrate Over Time',
        font: { size: 16 },
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'TH/s',
        },
      },
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 45,
        },
      },
    },
    interaction: {
      mode: 'nearest' as const,
      axis: 'x' as const,
      intersect: false,
    },
  };

  const btcChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'BTC Earnings (Cumulative)',
        font: { size: 16 },
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            return `BTC: ${context.parsed.y.toFixed(8)}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'BTC',
        },
        ticks: {
          callback: (value: any) => value.toFixed(8),
        },
      },
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 45,
        },
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
        {/* Current Hashrate Card */}
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" color="textSecondary" gutterBottom>
                Current Hashrate
              </Typography>
              <Typography variant="h4" sx={{ mb: 1 }}>
                {stats?.totalHashrate ? `${stats.totalHashrate.toFixed(2)} TH/s` : 'N/A'}
              </Typography>
              {previousStats && (
                <Box display="flex" alignItems="center" gap={0.5}>
                  {hashrateTrend.isPositive ? (
                    <TrendingUpIcon color="success" fontSize="small" />
                  ) : (
                    <TrendingDownIcon color="error" fontSize="small" />
                  )}
                  <Typography 
                    variant="body2" 
                    color={hashrateTrend.isPositive ? 'success.main' : 'error.main'}
                  >
                    {hashrateTrend.value.toFixed(1)}%
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* 24h Average Hashrate Card */}
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              24h Avg Hashrate
            </Typography>
            <Typography variant="h4">
              {stats?.averageHashrate24h ? `${stats.averageHashrate24h.toFixed(2)} TH/s` : 'N/A'}
            </Typography>
          </Paper>
        </Grid>

        {/* Active Miners Card */}
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" color="textSecondary" gutterBottom>
                Active Miners
              </Typography>
              <Typography variant="h4" sx={{ mb: 1 }}>
                {stats?.activeMiners !== undefined ? stats.activeMiners : 'N/A'}
                <Typography component="span" variant="body2" color="textSecondary" sx={{ ml: 1 }}>
                  / {stats?.miners?.length || 0}
                </Typography>
              </Typography>
              {previousStats && (
                <Box display="flex" alignItems="center" gap={0.5}>
                  {minersTrend.isPositive ? (
                    <TrendingUpIcon color="success" fontSize="small" />
                  ) : (
                    <TrendingDownIcon color="error" fontSize="small" />
                  )}
                  <Typography 
                    variant="body2" 
                    color={minersTrend.isPositive ? 'success.main' : 'error.main'}
                  >
                    {minersTrend.value.toFixed(0)}%
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Total Mined Card */}
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              Total Mined (24h)
            </Typography>
            <Typography variant="h4">
              {stats?.totalMined ? `${stats.totalMined.toFixed(8)} BTC` : 'N/A'}
            </Typography>
          </Paper>
        </Grid>

        {/* Time Range Selector */}
        <Grid item xs={12}>
          <Box display="flex" justifyContent="center" sx={{ mb: 2 }}>
            <ToggleButtonGroup
              value={timeRange}
              exclusive
              onChange={(_, newRange) => newRange && setTimeRange(newRange)}
              size="small"
            >
              <ToggleButton value="1h">1 Hour</ToggleButton>
              <ToggleButton value="6h">6 Hours</ToggleButton>
              <ToggleButton value="24h">24 Hours</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Grid>

        {/* Hashrate Chart */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ height: '350px' }}>
              <Line data={hashrateChartData} options={hashrateChartOptions} />
            </Box>
          </Paper>
        </Grid>

        {/* BTC Earnings Chart */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ height: '350px' }}>
              <Line data={btcChartData} options={btcChartOptions} />
            </Box>
          </Paper>
        </Grid>

        {/* Performance Metrics */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Performance Metrics
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    Avg Efficiency
                  </Typography>
                  <Typography variant="h6">
                    {stats?.miners?.length ? 
                      (stats.miners.reduce((sum, m) => sum + (m.currentHashrate / (m.hardware?.powerUsage || 1)), 0) / stats.miners.length * 1000).toFixed(2)
                      : 'N/A'
                    } GH/W
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    Total Power
                  </Typography>
                  <Typography variant="h6">
                    {stats?.miners?.reduce((sum, m) => sum + (m.hardware?.powerUsage || 0), 0).toFixed(0) || 'N/A'} W
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    Avg Temperature
                  </Typography>
                  <Typography variant="h6">
                    {stats?.miners?.length ?
                      (stats.miners.reduce((sum, m) => sum + (m.hardware?.temperature || 0), 0) / stats.miners.length).toFixed(1)
                      : 'N/A'
                    }°C
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    Rejection Rate
                  </Typography>
                  <Typography variant="h6">
                    {stats?.miners?.length ?
                      ((stats.miners.reduce((sum, m) => sum + m.shares.rejected, 0) / 
                        stats.miners.reduce((sum, m) => sum + m.shares.accepted + m.shares.rejected, 1)) * 100).toFixed(2)
                      : 'N/A'
                    }%
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
