import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
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
import { Bar } from 'react-chartjs-2';
import DownloadIcon from '@mui/icons-material/Download';
import { fetchMiningStats, MiningStatsResponse } from '../services/api';
import { formatHashrate, getHashrateValue } from '../utils/hashrate';
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

  // Use backend aggregates instead of local calculations
  const analyticsStats = {
    avgHashrate: stats?.averageHashrate24h || 0,
    maxHashrate: stats?.aggregates?.maxHashrate || 0,
    minHashrate: stats?.aggregates?.minHashrate || 0,
    uptimePercent: stats?.aggregates?.uptimePercent || 0,
    totalBTC: stats?.totalMined || 0,
  };

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
                Min Hashrate
              </Typography>
              <Typography variant="h5">
                {analyticsStats.minHashrate.toFixed(2)} TH/s
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
                        <TableCell align="right">{formatHashrate(miner.currentHashrate, miner.algorithm)}</TableCell>
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
