import React, { useEffect, useState } from 'react';
import { Grid, Typography, Paper, Box, Alert, Chip, ToggleButton, ToggleButtonGroup, Card, CardContent } from '@mui/material';
import { Line } from 'react-chartjs-2';
import { fetchMiningStats, MiningStatsResponse } from '../services/api';
import { useSelector } from 'react-redux';
import { selectMiningStats, selectIsConnected, selectError } from '../features/mining/miningSlice';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import DashboardSkeleton from '../components/DashboardSkeleton';
import MobileDashboard from '../components/MobileDashboard';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatHashrate } from '../utils/hashrate';
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

const Dashboard: React.FC = () => {
  // Get data from Redux store
  const stats = useSelector(selectMiningStats);
  const isConnected = useSelector(selectIsConnected);
  const error = useSelector(selectError);
  const isMobile = useIsMobile();
  
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h'>('24h');
  const [previousStats, setPreviousStats] = useState<MiningStatsResponse | null>(null);

  useEffect(() => {
    // Initial data load (only once)
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await fetchMiningStats();
        setPreviousStats(data);
      } catch (error) {
        console.error('Error fetching initial mining stats:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Track previous stats for trend calculation
  useEffect(() => {
    if (stats) {
      setPreviousStats(stats);
    }
  }, [stats]);

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
        label: 'SHA-256 Hashrate (TH/s)',
        data: filteredHistory.map((item) => item.hashrateSha256),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        yAxisID: 'ySha256',
      },
      {
        label: 'SCRYPT Hashrate (GH/s)',
        data: filteredHistory.map((item) => item.hashrateScrypt * 1000),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        yAxisID: 'yScrypt',
      },
      {
        label: 'SHA-256 24h Average',
        data: filteredHistory.map(() => stats?.averageHashrate24hSha256 || 0),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0,
        yAxisID: 'ySha256',
      },
      {
        label: 'SCRYPT 24h Average',
        data: filteredHistory.map(() => (stats?.averageHashrate24hScrypt || 0) * 1000),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0,
        yAxisID: 'yScrypt',
      },
    ],
  };

  // BTC earnings chart
  // BTC chart removed - not useful for monitoring
  // const btcChartData = {
  //   labels: filteredHistory.map((item) => 
  //     new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  //   ),
  //   datasets: [
  //     {
  //       label: 'BTC Mined (Cumulative)',
  //       data: filteredHistory.map((_, index) => {
  //         const networkHashrate = 600000000;
  //         const dailyBTC = 450;
  //         const updateInterval = 5000;
  //         const timeFraction = updateInterval / 1000 / 86400;
  //         const avgHashrate = filteredHistory[index]?.hashrate || 0;
  //         const btcPerUpdate = (avgHashrate / networkHashrate) * dailyBTC * timeFraction;
  //         return filteredHistory.slice(0, index + 1).reduce((sum, h) => 
  //           sum + ((h.hashrate / networkHashrate) * dailyBTC * timeFraction), 0
  //         );
  //       }),
  //       borderColor: 'rgb(255, 205, 86)',
  //       backgroundColor: 'rgba(255, 205, 86, 0.1)',
  //       fill: true,
  //       tension: 0.4,
  //       pointRadius: 2,
  //     },
  //   ],
  // };

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
      ySha256: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        beginAtZero: true,
        title: {
          display: true,
          text: 'SHA-256 (TH/s)',
        },
      },
      yScrypt: {
        type: 'linear' as const,
        display: true,
        position: 'right' as const,
        beginAtZero: true,
        title: {
          display: true,
          text: 'SCRYPT (GH/s)',
        },
        grid: {
          drawOnChartArea: false, // only show the grid for the primary axis
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

  // BTC chart options removed - not useful for monitoring
  // const btcChartOptions = {
  //   responsive: true,
  //   maintainAspectRatio: false,
  //   plugins: {
  //     legend: {
  //       position: 'top' as const,
  //     },
  //     title: {
  //       display: true,
  //       text: 'BTC Earnings (Cumulative)',
  //       font: { size: 16 },
  //     },
  //     tooltip: {
  //       callbacks: {
  //         label: (context: any) => {
  //           return `BTC: ${context.parsed.y.toFixed(8)}`;
  //         },
  //       },
  //     },
  //   },
  //   scales: {
  //     y: {
  //       beginAtZero: true,
  //       title: {
  //         display: true,
  //         text: 'BTC',
  //       },
  //       ticks: {
  //         callback: (value: any) => value.toFixed(8),
  //       },
  //     },
  //     x: {
  //       ticks: {
  //         maxRotation: 45,
  //         minRotation: 45,
  //       },
  //     },
  //   },
  // };

  // Show skeleton while loading
  if (loading && !stats) {
    return <DashboardSkeleton />;
  }

  // Show empty state if no data
  if (!loading && !stats) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Mining Dashboard
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          No mining data available. Waiting for first collection...
        </Alert>
      </Box>
    );
  }

  // Mobile view
  if (isMobile && stats) {
    return (
      <MobileDashboard
        stats={stats}
        isConnected={isConnected}
        hashrateTrend={hashrateTrend}
        minersTrend={minersTrend}
      />
    );
  }

  // Desktop view
  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">
          Mining Dashboard
        </Typography>
        <Chip 
          label={isConnected ? 'Connected' : 'Reconnecting...'}
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
        {/* Current Hashrate Card - Split by Algorithm */}
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" color="textSecondary" gutterBottom>
                Current Hashrate
              </Typography>
              {(() => {
                const sha256Miners = stats?.miners?.filter(m => m.algorithm === 'sha256') || [];
                const scryptMiners = stats?.miners?.filter(m => m.algorithm === 'scrypt') || [];
                const sha256Hashrate = sha256Miners.reduce((sum, m) => sum + m.currentHashrate, 0);
                const scryptHashrate = scryptMiners.reduce((sum, m) => sum + m.currentHashrate, 0);
                
                return (
                  <>
                    {sha256Hashrate > 0 && (
                      <Box sx={{ mb: 1 }}>
                        <Typography variant="caption" color="textSecondary">SHA-256</Typography>
                        <Typography variant="h5">
                          {sha256Hashrate.toFixed(2)} TH/s
                        </Typography>
                      </Box>
                    )}
                    {scryptHashrate > 0 && (
                      <Box>
                        <Typography variant="caption" color="textSecondary">SCRYPT</Typography>
                        <Typography variant="h5">
                          {(scryptHashrate * 1000000).toFixed(0)} MH/s
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          ({scryptHashrate.toFixed(4)} TH/s)
                        </Typography>
                      </Box>
                    )}
                    {sha256Hashrate === 0 && scryptHashrate === 0 && (
                      <Typography variant="h4">N/A</Typography>
                    )}
                  </>
                );
              })()}
              {previousStats && (
                <Box display="flex" alignItems="center" gap={0.5} sx={{ mt: 1 }}>
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

        {/* 24h Average Hashrate Card - Separate by Algorithm */}
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              24h Avg Hashrate
            </Typography>
            {(stats?.activeMinersSha256 || 0) > 0 && (
              <Box>
                <Typography variant="body2" color="textSecondary">
                  SHA-256
                </Typography>
                <Typography variant="h5">
                  {stats?.averageHashrate24hSha256 ? `${stats.averageHashrate24hSha256.toFixed(2)} TH/s` : 'N/A'}
                </Typography>
              </Box>
            )}
            {(stats?.activeMinersScrypt || 0) > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="textSecondary">
                  SCRYPT
                </Typography>
                <Typography variant="h5">
                  {stats?.averageHashrate24hScrypt ? `${(stats.averageHashrate24hScrypt * 1000).toFixed(2)} GH/s` : 'N/A'}
                </Typography>
              </Box>
            )}
            {!stats?.activeMinersSha256 && !stats?.activeMinersScrypt && (
              <Typography variant="h4">N/A</Typography>
            )}
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

        {/* Total Mined Card - Hidden (not useful for monitoring) */}
        {/* <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              Total Mined (24h)
            </Typography>
            <Typography variant="h4">
              {stats?.totalMined ? `${stats.totalMined.toFixed(8)} BTC` : 'N/A'}
            </Typography>
          </Paper>
        </Grid> */}

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

        {/* BTC Earnings Chart - Removed (not useful for monitoring) */}
        {/* <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ height: '350px' }}>
              <Line data={btcChartData} options={btcChartOptions} />
            </Box>
          </Paper>
        </Grid> */}

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
                    {stats?.aggregates?.avgEfficiency?.toFixed(2) || 'N/A'} GH/W
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    Total Power
                  </Typography>
                  <Typography variant="h6">
                    {stats?.aggregates?.totalPower?.toFixed(0) || 'N/A'} W
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    Avg Temperature
                  </Typography>
                  <Typography variant="h6">
                    {stats?.aggregates?.avgTemperature?.toFixed(1) || 'N/A'}°C
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    Rejection Rate
                  </Typography>
                  <Typography variant="h6">
                    {stats?.aggregates?.rejectionRate?.toFixed(2) || 'N/A'}%
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
