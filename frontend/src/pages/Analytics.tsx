import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  TableSortLabel,
  Chip,
  Tooltip,
} from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import { fetchMiningStats, MiningStatsResponse, MinerStats, getThresholds, ThresholdsResponse } from '../services/api';
import { formatHashrate, getHashrateValue } from '../utils/hashrate';

type SortColumn = 'name' | 'hashrate' | 'efficiency' | 'temperature' | 'rejection';
type SortOrder = 'asc' | 'desc';


const Analytics: React.FC = () => {
  const [stats, setStats] = useState<MiningStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [thresholds, setThresholds] = useState<ThresholdsResponse | null>(null);

  // Load thresholds on mount
  useEffect(() => {
    const loadThresholds = async () => {
      try {
        const data = await getThresholds();
        setThresholds(data);
      } catch (error) {
        console.error('Error fetching thresholds:', error);
        // Fall back to default thresholds if API fails
        setThresholds({
          global: {
            temperature: { warning: 75, critical: 85, shutdown: 95 },
            rejectionRate: { warning: 2, critical: 5 },
            fanSpeed: { warning: 3000, critical: 2000 },
            hashrate: { warningPercent: 20, criticalPercent: 50 },
            power: { warningPercent: 15 },
          },
        });
      }
    };

    loadThresholds();
  }, []);

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
  // SHA256 metrics only (excluding SCRYPT)
  const analyticsStats = {
    avgHashrate: stats?.averageHashrate24hSha256 || 0,
    maxHashrate: stats?.aggregates?.maxHashrate || 0,
    minHashrate: stats?.aggregates?.minHashrate || 0,
    // SCRYPT metrics
    avgHashrateScrypt: stats?.averageHashrate24hScrypt || 0,
    maxHashrateScrypt: stats?.aggregates?.maxHashrateScrypt || 0,
    minHashrateScrypt: stats?.aggregates?.minHashrateScrypt || 0,
    uptimePercent: stats?.aggregates?.uptimePercent || 0,
    totalBTC: stats?.totalMined || 0,
  };

  // Handle sorting
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortOrder('asc');
    }
  };

  // Sort miners
  const sortedMiners = useMemo(() => {
    const minersList = stats?.miners ?? [];
    return [...minersList].sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'hashrate':
          aVal = a.currentHashrate || 0;
          bVal = b.currentHashrate || 0;
          break;
        case 'efficiency':
          aVal = a.hardware?.powerUsage ? (a.currentHashrate / a.hardware.powerUsage) * 1000 : 0;
          bVal = b.hardware?.powerUsage ? (b.currentHashrate / b.hardware.powerUsage) * 1000 : 0;
          break;
        case 'temperature':
          aVal = a.hardware?.temperature || 0;
          bVal = b.hardware?.temperature || 0;
          break;
        case 'rejection':
          aVal = (a.shares.rejected / (a.shares.accepted + a.shares.rejected || 1)) * 100;
          bVal = (b.shares.rejected / (b.shares.accepted + b.shares.rejected || 1)) * 100;
          break;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [stats?.miners, sortColumn, sortOrder]);

  // Check if miner has issues using configured thresholds from database
  const getMinerIssues = (miner: MinerStats) => {
    const issues: Array<{ type: string; icon: React.ReactElement; message: string; severity: 'critical' | 'warning' | 'info' }> = [];
    if (!thresholds) return issues;

    const config = thresholds.global;
    const temp = miner.hardware?.temperature;
    const power = miner.hardware?.powerUsage;
    const rejectionRate = (miner.shares.rejected / (miner.shares.accepted + miner.shares.rejected || 1)) * 100;

    // Check temperature
    if (temp) {
      if (temp > config.temperature.critical) {
        issues.push({ 
          type: 'temperature', 
          icon: <LocalFireDepartmentIcon fontSize="small" />, 
          message: `Critical temperature: ${temp.toFixed(1)}°C (threshold: ${config.temperature.critical}°C)`,
          severity: 'critical',
        });
      } else if (temp > config.temperature.warning) {
        issues.push({ 
          type: 'temperature', 
          icon: <LocalFireDepartmentIcon fontSize="small" />, 
          message: `High temperature: ${temp.toFixed(1)}°C (threshold: ${config.temperature.warning}°C)`,
          severity: 'warning',
        });
      }
    }

    // Check rejection rate
    if (rejectionRate > config.rejectionRate.critical) {
      issues.push({ 
        type: 'rejection', 
        icon: <WarningIcon fontSize="small" />, 
        message: `Critical rejection rate: ${rejectionRate.toFixed(2)}% (threshold: ${config.rejectionRate.critical}%)`,
        severity: 'critical',
      });
    } else if (rejectionRate > config.rejectionRate.warning) {
      issues.push({ 
        type: 'rejection', 
        icon: <WarningIcon fontSize="small" />, 
        message: `High rejection rate: ${rejectionRate.toFixed(2)}% (threshold: ${config.rejectionRate.warning}%)`,
        severity: 'warning',
      });
    }

    // Check fan speed (low fan speed is a problem)
    const fanSpeed = miner.hardware?.fanSpeed;
    if (fanSpeed) {
      if (fanSpeed < config.fanSpeed.critical) {
        issues.push({ 
          type: 'fanSpeed', 
          icon: <WarningIcon fontSize="small" />, 
          message: `Critical low fan speed: ${fanSpeed} RPM (threshold: ${config.fanSpeed.critical} RPM)`,
          severity: 'critical',
        });
      } else if (fanSpeed < config.fanSpeed.warning) {
        issues.push({ 
          type: 'fanSpeed', 
          icon: <FlashOnIcon fontSize="small" />, 
          message: `Low fan speed: ${fanSpeed} RPM (threshold: ${config.fanSpeed.warning} RPM)`,
          severity: 'warning',
        });
      }
    }

    // Check offline status
    if (miner.status === 'offline' || miner.status === 'error') {
      issues.push({ 
        type: 'offline', 
        icon: <WarningIcon fontSize="small" />, 
        message: `Miner ${miner.status}`,
        severity: 'critical',
      });
    }

    return issues;
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
        <Typography variant="h4">Analytics</Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Summary Statistics */}
        {/* SHA256 Metrics */}
        {(stats?.activeMinersSha256 || 0) > 0 && (
          <>
            <Grid item xs={12}>
              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                SHA-256 Miners
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Avg Hashrate (24h)
                  </Typography>
                  <Typography variant="h5">
                    {analyticsStats.avgHashrate.toFixed(2)} TH/s
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
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

            <Grid item xs={12} md={4}>
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
          </>
        )}

        {/* SCRYPT Metrics */}
        {(stats?.activeMinersScrypt || 0) > 0 && (
          <>
            <Grid item xs={12}>
              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                SCRYPT Miners
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Avg Hashrate (24h)
                  </Typography>
                  <Typography variant="h5">
                    {(analyticsStats.avgHashrateScrypt * 1000).toFixed(2)} GH/s
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Peak Hashrate
                  </Typography>
                  <Typography variant="h5">
                    {(analyticsStats.maxHashrateScrypt * 1000).toFixed(2)} GH/s
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Min Hashrate
                  </Typography>
                  <Typography variant="h5">
                    {(analyticsStats.minHashrateScrypt * 1000).toFixed(2)} GH/s
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </>
        )}

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
                    <TableCell>
                      <TableSortLabel
                        active={sortColumn === 'name'}
                        direction={sortColumn === 'name' ? sortOrder : 'asc'}
                        onClick={() => handleSort('name')}
                      >
                        Miner
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Issues</TableCell>
                    <TableCell align="right">Status</TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={sortColumn === 'hashrate'}
                        direction={sortColumn === 'hashrate' ? sortOrder : 'asc'}
                        onClick={() => handleSort('hashrate')}
                      >
                        Hashrate
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={sortColumn === 'efficiency'}
                        direction={sortColumn === 'efficiency' ? sortOrder : 'asc'}
                        onClick={() => handleSort('efficiency')}
                      >
                        Efficiency (GH/W)
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={sortColumn === 'temperature'}
                        direction={sortColumn === 'temperature' ? sortOrder : 'asc'}
                        onClick={() => handleSort('temperature')}
                      >
                        Temperature (°C)
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={sortColumn === 'rejection'}
                        direction={sortColumn === 'rejection' ? sortOrder : 'asc'}
                        onClick={() => handleSort('rejection')}
                      >
                        Rejection %
                      </TableSortLabel>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedMiners.map((miner) => {
                    const power = miner.hardware?.powerUsage;
                    const efficiency = power ? (miner.currentHashrate / power) * 1000 : null;
                    const rejectionRate = ((miner.shares.rejected / (miner.shares.accepted + miner.shares.rejected || 1)) * 100);
                    const issues = getMinerIssues(miner);

                    return (
                      <TableRow key={miner.minerId}>
                        <TableCell>{miner.name}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {issues.map((issue, idx) => (
                              <Tooltip key={idx} title={issue.message} arrow>
                                <Chip
                                  icon={issue.icon}
                                  label=""
                                  size="small"
                                  color={issue.severity === 'critical' ? 'error' : 
                                         issue.severity === 'warning' ? 'warning' : 'info'}
                                  sx={{ minWidth: '32px', '& .MuiChip-label': { px: 0 } }}
                                />
                              </Tooltip>
                            ))}
                          </Box>
                        </TableCell>
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
                        <TableCell align="right">
                          {efficiency !== null ? efficiency.toFixed(2) : '—'}
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            color={
                              miner.hardware?.temperature && thresholds
                                ? (() => {
                                    const temp = miner.hardware.temperature;
                                    if (temp > thresholds.global.temperature.critical) return 'error';
                                    if (temp > thresholds.global.temperature.warning) return 'warning.main';
                                    return 'inherit';
                                  })()
                                : 'inherit'
                            }
                          >
                            {miner.hardware?.temperature !== undefined ? miner.hardware.temperature.toFixed(1) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            color={
                              thresholds
                                ? (() => {
                                    if (rejectionRate > thresholds.global.rejectionRate.critical) return 'error';
                                    if (rejectionRate > thresholds.global.rejectionRate.warning) return 'warning.main';
                                    return 'inherit';
                                  })()
                                : 'inherit'
                            }
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
