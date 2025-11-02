import React from 'react';
import { Grid, Typography, Box, Chip, Card, CardContent } from '@mui/material';
import { MiningStatsResponse } from '../services/api';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';

interface MobileDashboardProps {
  stats: MiningStatsResponse;
  isConnected: boolean;
  hashrateTrend: { value: number; isPositive: boolean };
  minersTrend: { value: number; isPositive: boolean };
}

const MobileDashboard: React.FC<MobileDashboardProps> = ({
  stats,
  isConnected,
  hashrateTrend,
  minersTrend,
}) => {
  return (
    <Box>
      {/* Header with connection status */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5">
          Dashboard
        </Typography>
        <Chip 
          label={isConnected ? 'Live' : 'Reconnecting'}
          color={isConnected ? 'success' : 'warning'}
          size="small"
        />
      </Box>

      {/* Compact Stats Cards - 2 columns */}
      <Grid container spacing={2} mb={2}>
        {/* Hashrate Card */}
        <Grid item xs={6}>
          <Card>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="caption" color="textSecondary" display="block">
                Hashrate
              </Typography>
              <Typography variant="h6" sx={{ my: 0.5 }}>
                {stats.totalHashrate.toFixed(1)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                TH/s
              </Typography>
              <Box display="flex" alignItems="center" gap={0.5} mt={0.5}>
                {hashrateTrend.isPositive ? (
                  <TrendingUpIcon color="success" fontSize="small" />
                ) : (
                  <TrendingDownIcon color="error" fontSize="small" />
                )}
                <Typography 
                  variant="caption" 
                  color={hashrateTrend.isPositive ? 'success.main' : 'error.main'}
                >
                  {hashrateTrend.value.toFixed(1)}%
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Active Miners Card */}
        <Grid item xs={6}>
          <Card>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="caption" color="textSecondary" display="block">
                Miners
              </Typography>
              <Typography variant="h6" sx={{ my: 0.5 }}>
                {stats.activeMiners}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Active
              </Typography>
              <Box display="flex" alignItems="center" gap={0.5} mt={0.5}>
                {minersTrend.isPositive ? (
                  <TrendingUpIcon color="success" fontSize="small" />
                ) : (
                  <TrendingDownIcon color="error" fontSize="small" />
                )}
                <Typography 
                  variant="caption" 
                  color={minersTrend.isPositive ? 'success.main' : 'error.main'}
                >
                  {minersTrend.value.toFixed(1)}%
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>


      {/* Quick Miner Status List */}
      <Box mt={2}>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Miner Status
        </Typography>
        {stats.miners.slice(0, 5).map((miner) => (
          <Card key={miner.minerId} sx={{ mb: 1 }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    {miner.name}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    {miner.currentHashrate.toFixed(1)} TH/s
                  </Typography>
                </Box>
                <Chip
                  label={miner.status}
                  color={miner.status === 'online' ? 'success' : 'error'}
                  size="small"
                />
              </Box>
            </CardContent>
          </Card>
        ))}
        {stats.miners.length > 5 && (
          <Typography variant="caption" color="textSecondary" align="center" display="block" mt={1}>
            +{stats.miners.length - 5} more miners
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export default MobileDashboard;
