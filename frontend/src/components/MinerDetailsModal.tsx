import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Divider,
  IconButton,
  Tooltip,
  Tabs,
  Tab,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Line } from 'react-chartjs-2';
import MinerPoolConfig from './miners/MinerPoolConfig';

interface MinerError {
  code: string;
  message: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: number;
  details?: Record<string, any>;
}

interface Miner {
  minerId: string;
  name: string;
  model: string;
  ip: string;
  status: 'online' | 'offline' | 'error';
  statusMessage?: string;
  lastSeen: Date;
  currentHashrate?: number;
  averageHashrate?: number;
  shares?: {
    accepted: number;
    rejected: number;
    rejectionRate?: number;
  };
  hardware?: {
    temperature?: number;
    fanSpeed?: number;
    powerUsage?: number;
  };
  uptime?: number;
  errors?: MinerError[];
  errorCount?: number;
  lastError?: MinerError;
}

interface MinerDetailsModalProps {
  open: boolean;
  miner: Miner | null;
  onClose: () => void;
  onReboot?: (minerId: string, minerName: string) => void;
}

const MinerDetailsModal: React.FC<MinerDetailsModalProps> = ({
  open,
  miner,
  onClose,
  onReboot,
}) => {
  const [tabValue, setTabValue] = useState(0);
  const [historyData, setHistoryData] = useState<{
    timestamps: string[];
    hashrate: number[];
    temperature: number[];
    fanSpeed: number[];
  }>({
    timestamps: [],
    hashrate: [],
    temperature: [],
    fanSpeed: [],
  });

  // Simulate historical data (in production, fetch from API)
  useEffect(() => {
    if (miner && open) {
      // Generate mock historical data for the last hour
      const now = Date.now();
      const timestamps: string[] = [];
      const hashrate: number[] = [];
      const temperature: number[] = [];
      const fanSpeed: number[] = [];

      for (let i = 60; i >= 0; i -= 5) {
        const time = new Date(now - i * 60 * 1000);
        timestamps.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        
        // Add some variance to make it realistic (proportional to base value)
        const baseHashrate = miner.currentHashrate || 100;
        const baseTemp = miner.hardware?.temperature || 70;
        const baseFan = miner.hardware?.fanSpeed || 6000;
        
        // Use percentage-based variance for better scaling
        const hashrateVariance = baseHashrate * (Math.random() - 0.5) * 0.02; // ±1%
        const tempVariance = (Math.random() - 0.5) * 3;
        const fanVariance = (Math.random() - 0.5) * 200;
        
        // Ensure values are valid numbers and non-negative
        const hashrateValue = Math.max(0, baseHashrate + hashrateVariance);
        const tempValue = Math.max(0, baseTemp + tempVariance);
        const fanValue = Math.max(0, baseFan + fanVariance);
        
        hashrate.push(isNaN(hashrateValue) ? 0 : hashrateValue);
        temperature.push(isNaN(tempValue) ? 0 : tempValue);
        fanSpeed.push(isNaN(fanValue) ? 0 : fanValue);
      }

      setHistoryData({ timestamps, hashrate, temperature, fanSpeed });
    }
  }, [miner, open]);

  if (!miner) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'success';
      case 'offline':
        return 'default';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'default';
    }
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  // Chart configurations
  const hashrateChartData = {
    labels: historyData.timestamps,
    datasets: [
      {
        label: 'Hashrate (TH/s)',
        data: historyData.hashrate,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  };

  const temperatureChartData = {
    labels: historyData.timestamps,
    datasets: [
      {
        label: 'Temperature (°C)',
        data: historyData.temperature,
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
      x: {
        display: true,
        grid: {
          display: false,
        },
      },
      y: {
        display: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
      },
    },
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { minHeight: '80vh' },
      }}
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h5" component="span">
              {miner.name}
            </Typography>
            <Chip
              label={miner.statusMessage || miner.status}
              color={getStatusColor(miner.status) as any}
              size="small"
              sx={{ ml: 2 }}
            />
          </Box>
          <Box>
            {onReboot && miner.status === 'online' && (
              <Tooltip title="Reboot Miner">
                <IconButton
                  onClick={() => onReboot(miner.minerId, miner.name)}
                  color="warning"
                  sx={{ mr: 1 }}
                >
                  <RestartAltIcon />
                </IconButton>
              </Tooltip>
            )}
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {miner.model} • {miner.ip}
        </Typography>
      </DialogTitle>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
          <Tab label="Overview" />
          <Tab label="Charts" />
          <Tab label="Pool Configuration" />
        </Tabs>
      </Box>

      <DialogContent dividers>
        {/* Tab Panel 0: Overview */}
        {tabValue === 0 && (
        <Grid container spacing={3}>
          {/* Key Stats Cards */}
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom variant="body2">
                  Current Hashrate
                </Typography>
                <Typography variant="h5">
                  {miner.currentHashrate?.toFixed(2) || 'N/A'} TH/s
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom variant="body2">
                  Temperature
                </Typography>
                <Typography variant="h5">
                  {miner.hardware?.temperature?.toFixed(1) || 'N/A'}°C
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom variant="body2">
                  Power Usage
                </Typography>
                <Typography variant="h5">
                  {miner.hardware?.powerUsage?.toFixed(0) || 'N/A'}W
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom variant="body2">
                  Uptime
                </Typography>
                <Typography variant="h5">
                  {formatUptime(miner.uptime)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>


          {/* Share Statistics */}
          {miner.shares && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Share Statistics
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={4}>
                    <Typography color="text.secondary" variant="body2">
                      Accepted
                    </Typography>
                    <Typography variant="h6">
                      {miner.shares.accepted.toLocaleString()}
                    </Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography color="text.secondary" variant="body2">
                      Rejected
                    </Typography>
                    <Typography variant="h6">
                      {miner.shares.rejected.toLocaleString()}
                    </Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography color="text.secondary" variant="body2">
                      Rejection Rate
                    </Typography>
                    <Typography variant="h6">
                      {miner.shares.rejectionRate?.toFixed(2) || '0.00'}%
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          )}

          {/* Recent Errors */}
          {miner.errors && miner.errors.length > 0 && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Recent Errors ({miner.errors.length})
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Time</TableCell>
                        <TableCell>Severity</TableCell>
                        <TableCell>Message</TableCell>
                        <TableCell>Description</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {miner.errors.slice(0, 10).map((error, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            {new Date(error.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={error.severity}
                              color={getSeverityColor(error.severity) as any}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>{error.message}</TableCell>
                          <TableCell>{error.description}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Grid>
          )}
        </Grid>
        )}

        {/* Tab Panel 1: Charts */}
        {tabValue === 1 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Hashrate (Last Hour)
              </Typography>
              <Box sx={{ height: 300 }}>
                {historyData.hashrate.length > 0 ? (
                  <Line data={hashrateChartData} options={chartOptions} />
                ) : (
                  <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                    <Typography color="text.secondary">No data available</Typography>
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Temperature (Last Hour)
              </Typography>
              <Box sx={{ height: 300 }}>
                {historyData.temperature.length > 0 ? (
                  <Line data={temperatureChartData} options={chartOptions} />
                ) : (
                  <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                    <Typography color="text.secondary">No data available</Typography>
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
        )}

        {/* Tab Panel 2: Pool Configuration */}
        {tabValue === 2 && (
          <MinerPoolConfig minerIp={miner.ip} minerName={miner.name} />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default MinerDetailsModal;
