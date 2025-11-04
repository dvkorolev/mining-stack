import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Grid,
  Card,
  CardContent,
  Tabs,
  Tab,
  Alert as MuiAlert,
  CircularProgress,
  Button,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import HistoryIcon from '@mui/icons-material/History';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface Alert {
  id: string;
  name: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'firing' | 'resolved';
  miner?: string;
  summary: string;
  description: string;
  firedAt: number;
  resolvedAt?: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

interface AlertStats {
  active: number;
  critical: number;
  warning: number;
  info: number;
  total24h: number;
}

const Alerts: React.FC = () => {
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [alertHistory, setAlertHistory] = useState<Alert[]>([]);
  const [alertStats, setAlertStats] = useState<AlertStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState(0);

  // Load alerts data
  const loadAlerts = async () => {
    try {
      setLoading(true);
      
      // Fetch active alerts
      const activeResponse = await fetch('/api/alerts/active');
      const activeData = await activeResponse.json();
      setActiveAlerts(activeData);

      // Fetch alert history
      const historyResponse = await fetch('/api/alerts/history?limit=50');
      const historyData = await historyResponse.json();
      setAlertHistory(historyData);

      // Fetch alert statistics
      const statsResponse = await fetch('/api/alerts/stats');
      const statsData = await statsResponse.json();
      setAlertStats(statsData);

      setError(null);
    } catch (err) {
      console.error('Error loading alerts:', err);
      setError('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
    // Refresh every 30 seconds
    const interval = setInterval(loadAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Get severity icon and color
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <ErrorIcon fontSize="small" />;
      case 'warning':
        return <WarningIcon fontSize="small" />;
      case 'info':
        return <InfoIcon fontSize="small" />;
      default:
        return <InfoIcon fontSize="small" />;
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

  const getStatusColor = (status: string) => {
    return status === 'firing' ? 'error' : 'success';
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatDuration = (start: number, end?: number) => {
    const duration = (end || Date.now()) - start;
    const minutes = Math.floor(duration / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  if (loading && !alertStats) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Alerts & Notifications
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadAlerts}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </MuiAlert>
      )}

      {/* Statistics Cards */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Active Alerts
                  </Typography>
                  <Typography variant="h4">
                    {alertStats?.active || 0}
                  </Typography>
                </Box>
                <NotificationsActiveIcon sx={{ fontSize: 48, color: 'primary.main' }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Critical
                  </Typography>
                  <Typography variant="h4" color="error">
                    {alertStats?.critical || 0}
                  </Typography>
                </Box>
                <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Warnings
                  </Typography>
                  <Typography variant="h4" color="warning.main">
                    {alertStats?.warning || 0}
                  </Typography>
                </Box>
                <WarningIcon sx={{ fontSize: 48, color: 'warning.main' }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Last 24h
                  </Typography>
                  <Typography variant="h4">
                    {alertStats?.total24h || 0}
                  </Typography>
                </Box>
                <HistoryIcon sx={{ fontSize: 48, color: 'info.main' }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Paper sx={{ mb: 2 }}>
        <Tabs value={currentTab} onChange={(_, newValue) => setCurrentTab(newValue)}>
          <Tab label={`Active (${activeAlerts.length})`} />
          <Tab label={`History (${alertHistory.length})`} />
        </Tabs>
      </Paper>

      {/* Active Alerts Tab */}
      {currentTab === 0 && (
        <Paper>
          {activeAlerts.length === 0 ? (
            <Box p={4} textAlign="center">
              <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                No Active Alerts
              </Typography>
              <Typography color="textSecondary">
                All systems are operating normally
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Severity</TableCell>
                    <TableCell>Alert</TableCell>
                    <TableCell>Miner</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Fired At</TableCell>
                    <TableCell>Duration</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeAlerts.map((alert) => (
                    <TableRow key={alert.id}>
                      <TableCell>
                        <Chip
                          icon={getSeverityIcon(alert.severity)}
                          label={alert.severity.toUpperCase()}
                          color={getSeverityColor(alert.severity) as any}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight="bold">
                          {alert.name}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {alert.summary}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {alert.miner ? (
                          <Chip label={alert.miner} size="small" variant="outlined" />
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                          {alert.description}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatTimestamp(alert.firedAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={formatDuration(alert.firedAt)}
                          size="small"
                          color="error"
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}

      {/* History Tab */}
      {currentTab === 1 && (
        <Paper>
          {alertHistory.length === 0 ? (
            <Box p={4} textAlign="center">
              <HistoryIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                No Alert History
              </Typography>
              <Typography color="textSecondary">
                No alerts have been recorded yet
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Status</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Alert</TableCell>
                    <TableCell>Miner</TableCell>
                    <TableCell>Fired At</TableCell>
                    <TableCell>Duration</TableCell>
                    <TableCell>Resolved At</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {alertHistory.map((alert) => (
                    <TableRow key={`${alert.id}-${alert.firedAt}`}>
                      <TableCell>
                        <Chip
                          label={alert.status.toUpperCase()}
                          color={getStatusColor(alert.status) as any}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          icon={getSeverityIcon(alert.severity)}
                          label={alert.severity.toUpperCase()}
                          color={getSeverityColor(alert.severity) as any}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight="bold">
                          {alert.name}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {alert.summary}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {alert.miner ? (
                          <Chip label={alert.miner} size="small" variant="outlined" />
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatTimestamp(alert.firedAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDuration(alert.firedAt, alert.resolvedAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {alert.resolvedAt ? (
                          <Typography variant="body2">
                            {formatTimestamp(alert.resolvedAt)}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="error">
                            Active
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default Alerts;
