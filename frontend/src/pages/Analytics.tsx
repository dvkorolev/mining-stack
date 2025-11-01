import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  ToggleButtonGroup,
  ToggleButton,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Line, Bar } from 'react-chartjs-2';
import DownloadIcon from '@mui/icons-material/Download';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { fetchMiningStats, MiningStatsResponse } from '../services/api';
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

const Analytics: React.FC = () => {
  const [stats, setStats] = useState<MiningStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h');

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await fetchMiningStats();
        setStats(data);
        setError(null);
      } catch (error) {
        console.error('Error fetching mining stats:', error);
        setError('Failed to load analytics data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Calculate statistics
  const calculateStats = () => {
    if (!stats?.statsHistory || stats.statsHistory.length === 0) {
      return {
        avgHashrate: 0,
        maxHashrate: 0,
        minHashrate: 0,
        uptimePercent: 0,
        totalBTC: 0,
      };
    }

    const hashrates = stats.statsHistory.map(h => h.hashrate);
    const avgHashrate = hashrates.reduce((sum, h) => sum + h, 0) / hashrates.length;
    const maxHashrate = Math.max(...hashrates);
    const minHashrate = Math.min(...hashrates);
    const uptimePercent = (stats.activeMiners / (stats.miners?.length || 1)) * 100;

    // Calculate total BTC for the period
    const networkHashrate = 600000000;
    const dailyBTC = 450;
    const updateInterval = 5000;
    const timeFraction = updateInterval / 1000 / 86400;
    const totalBTC = stats.statsHistory.reduce((sum, h) => 
      sum + ((h.hashrate / networkHashrate) * dailyBTC * timeFraction), 0
    );

    return { avgHashrate, maxHashrate, minHashrate, uptimePercent, totalBTC };
  };

  const analyticsStats = calculateStats();

  // Export data to CSV
  const exportToCSV = () => {
    if (!stats?.statsHistory) return;

    const headers = ['Timestamp', 'Hashrate (TH/s)', 'Active Miners'];
    const rows = stats.statsHistory.map(item => [
      new Date(item.timestamp).toISOString(),
      item.hashrate.toFixed(2),
      stats.activeMiners,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mining-stats-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Miner performance comparison chart
  const minerComparisonData = {
    labels: stats?.miners?.map(m => m.name) || [],
    datasets: [
      {
        label: 'Current Hashrate (TH/s)',
        data: stats?.miners?.map(m => m.currentHashrate) || [],
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
        borderColor: 'rgb(75, 192, 192)',
        borderWidth: 1,
      },
      {
        label: 'Average Hashrate (TH/s)',
        data: stats?.miners?.map(m => m.averageHashrate) || [],
        backgroundColor: 'rgba(255, 159, 64, 0.6)',
        borderColor: 'rgb(255, 159, 64)',
        borderWidth: 1,
      },
    ],
  };

  const minerComparisonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Miner Performance Comparison',
        font: { size: 16 },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Hashrate (TH/s)',
        },
      },
    },
  };

  // Efficiency chart
  const efficiencyData = {
    labels: stats?.miners?.map(m => m.name) || [],
    datasets: [
      {
        label: 'Efficiency (GH/W)',
        data: stats?.miners?.map(m => 
          (m.currentHashrate / (m.hardware?.powerUsage || 1)) * 1000
        ) || [],
        backgroundColor: 'rgba(153, 102, 255, 0.6)',
        borderColor: 'rgb(153, 102, 255)',
        borderWidth: 1,
      },
    ],
  };

  const efficiencyOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Mining Efficiency by Device',
        font: { size: 16 },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'GH/W',
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
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Analytics & Reporting
        </Typography>
        <Button
          variant="contained"
          startIcon={<DownloadIcon />}
          onClick={exportToCSV}
          disabled={!stats?.statsHistory?.length}
        >
          Export CSV
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Summary Statistics */}
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Average Hashrate
              </Typography>
              <Typography variant="h5">
                {analyticsStats.avgHashrate.toFixed(2)} TH/s
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Peak Hashrate
              </Typography>
              <Typography variant="h5">
                {analyticsStats.maxHashrate.toFixed(2)} TH/s
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Uptime
              </Typography>
              <Typography variant="h5">
                {analyticsStats.uptimePercent.toFixed(1)}%
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Total BTC Mined
              </Typography>
              <Typography variant="h5">
                {analyticsStats.totalBTC.toFixed(8)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Miner Comparison Chart */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ height: '400px' }}>
              <Bar data={minerComparisonData} options={minerComparisonOptions} />
            </Box>
          </Paper>
        </Grid>

        {/* Efficiency Chart */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ height: '400px' }}>
              <Bar data={efficiencyData} options={efficiencyOptions} />
            </Box>
          </Paper>
        </Grid>

        {/* Detailed Miner Table */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Detailed Miner Statistics
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Miner</TableCell>
                    <TableCell align="right">Status</TableCell>
                    <TableCell align="right">Hashrate (TH/s)</TableCell>
                    <TableCell align="right">Efficiency (GH/W)</TableCell>
                    <TableCell align="right">Temperature (°C)</TableCell>
                    <TableCell align="right">Rejection %</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stats?.miners?.map((miner) => {
                    const efficiency = (miner.currentHashrate / (miner.hardware?.powerUsage || 1)) * 1000;
                    const rejectionRate = ((miner.shares.rejected / (miner.shares.accepted + miner.shares.rejected || 1)) * 100);
                    
                    return (
                      <TableRow key={miner.minerId}>
                        <TableCell>{miner.name}</TableCell>
                        <TableCell align="right">
                          <Box
                            component="span"
                            sx={{
                              px: 1,
                              py: 0.5,
                              borderRadius: 1,
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              bgcolor: miner.status === 'online' ? 'success.main' : 
                                       miner.status === 'error' ? 'error.main' : 'grey.500',
                              color: 'white',
                            }}
                          >
                            {miner.status.toUpperCase()}
                          </Box>
                        </TableCell>
                        <TableCell align="right">{miner.currentHashrate.toFixed(2)}</TableCell>
                        <TableCell align="right">{efficiency.toFixed(2)}</TableCell>
                        <TableCell align="right">
                          <Typography
                            color={miner.hardware?.temperature > 80 ? 'error' : 'inherit'}
                          >
                            {miner.hardware?.temperature.toFixed(1)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            color={rejectionRate > 5 ? 'error' : 'inherit'}
                          >
                            {rejectionRate.toFixed(2)}%
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Analytics;
