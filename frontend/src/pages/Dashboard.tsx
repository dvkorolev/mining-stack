import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Grid, Typography, Paper, Box } from '@mui/material';
import { Line } from 'react-chartjs-2';
import { fetchMiningStats } from '../services/api';
import { setStats, selectMiningStats } from '../features/mining/miningSlice';
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

const Dashboard: React.FC = () => {
  const dispatch = useDispatch();
  const stats = useSelector(selectMiningStats);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetchMiningStats();
        dispatch(setStats(data));
      } catch (error) {
        console.error('Error fetching mining stats:', error);
      }
    };

    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [dispatch]);

  // Sample data for the chart
  const chartData = {
    labels: stats.hashrateHistory?.map((_, index) => `Min ${index + 1}`) || [],
    datasets: [
      {
        label: 'Hashrate (MH/s)',
        data: stats.hashrateHistory || [],
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
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

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Mining Dashboard
      </Typography>
      
      <Grid container spacing={3}>
        {/* Hashrate Card */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              Current Hashrate
            </Typography>
            <Typography variant="h4">
              {stats.currentHashrate ? `${stats.currentHashrate} MH/s` : 'N/A'}
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
              {stats.activeMiners !== undefined ? stats.activeMiners : 'N/A'}
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
              {stats.totalMined ? `${stats.totalMined} ETH` : 'N/A'}
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
