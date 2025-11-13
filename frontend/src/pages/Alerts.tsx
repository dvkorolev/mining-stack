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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  IconButton,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import HistoryIcon from '@mui/icons-material/History';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AddAlertIcon from '@mui/icons-material/AddAlert';
import CloseIcon from '@mui/icons-material/Close';

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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Manual alert form state
  const [formData, setFormData] = useState({
    name: '',
    severity: 'warning' as 'critical' | 'warning' | 'info',
    summary: '',
    description: '',
    miner: '',
    isFarmWide: false,
  });

  // Load alerts data
  const loadAlerts = async () => {
    try {
      setLoading(true);
      
      // Fetch active alerts
      const activeResponse = await fetch('/api/mining/alerts/active');
      const activeData = await activeResponse.json();
      setActiveAlerts(activeData);

      // Fetch alert history
      const historyResponse = await fetch('/api/mining/alerts/history?limit=50');
      const historyData = await historyResponse.json();
      setAlertHistory(historyData);

      // Fetch alert statistics
      const statsResponse = await fetch('/api/mining/alerts/stats');
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

  // Create manual alert
  const handleCreateAlert = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/mining/alerts/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create alert');
      }
      
      setSuccessMessage('Alert created successfully!');
      setCreateDialogOpen(false);
      setFormData({
        name: '',
        severity: 'warning',
        summary: '',
        description: '',
        miner: '',
        isFarmWide: false,
      });
      
      // Reload alerts
      await loadAlerts();
    } catch (err: any) {
      setError(err.message || 'Failed to create alert');
    } finally {
      setLoading(false);
    }
  };

  // Resolve manual alert
  const handleResolveAlert = async (alertId: string) => {
    try {
      const response = await fetch(`/api/mining/alerts/${alertId}/resolve`, {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to resolve alert');
      }
      
      setSuccessMessage('Alert resolved successfully!');
      
      // Reload alerts
      await loadAlerts();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve alert');
    }
  };

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
        <Box display="flex" gap={2}>
          <Button
            variant="contained"
            startIcon={<AddAlertIcon />}
            onClick={() => setCreateDialogOpen(true)}
            color="primary"
          >
            Create Alert
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadAlerts}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </MuiAlert>
      )}

      {successMessage && (
        <MuiAlert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
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
                    <TableCell>Actions</TableCell>
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
                      <TableCell>
                        {alert.labels?.source === 'manual' && (
                          <Tooltip title="Resolve Alert">
                            <Button
                              size="small"
                              variant="outlined"
                              color="success"
                              onClick={() => handleResolveAlert(alert.id)}
                            >
                              Resolve
                            </Button>
                          </Tooltip>
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

      {/* Create Alert Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">Create Manual Alert</Typography>
            <IconButton onClick={() => setCreateDialogOpen(false)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Alert Name"
              fullWidth
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Maintenance Required"
            />
            
            <FormControl fullWidth required>
              <InputLabel>Severity</InputLabel>
              <Select
                value={formData.severity}
                label="Severity"
                onChange={(e) => setFormData({ ...formData, severity: e.target.value as any })}
              >
                <MenuItem value="info">
                  <Box display="flex" alignItems="center" gap={1}>
                    <InfoIcon fontSize="small" color="info" />
                    Info
                  </Box>
                </MenuItem>
                <MenuItem value="warning">
                  <Box display="flex" alignItems="center" gap={1}>
                    <WarningIcon fontSize="small" color="warning" />
                    Warning
                  </Box>
                </MenuItem>
                <MenuItem value="critical">
                  <Box display="flex" alignItems="center" gap={1}>
                    <ErrorIcon fontSize="small" color="error" />
                    Critical
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>
            
            <TextField
              label="Summary"
              fullWidth
              required
              value={formData.summary}
              onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
              placeholder="Brief summary of the alert"
            />
            
            <TextField
              label="Description"
              fullWidth
              multiline
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detailed description (optional)"
            />
            
            <TextField
              label="Miner Name (Optional)"
              fullWidth
              value={formData.miner}
              onChange={(e) => setFormData({ ...formData, miner: e.target.value })}
              placeholder="Leave empty for farm-wide alert"
              helperText="Specify a miner name to send alert to miner owner only"
            />
            
            <FormControlLabel
              control={
                <Checkbox
                  checked={formData.isFarmWide}
                  onChange={(e) => setFormData({ ...formData, isFarmWide: e.target.checked })}
                />
              }
              label="Send to all users (farm-wide alert)"
            />
            
            <MuiAlert severity="info" sx={{ mt: 1 }}>
              This alert will be sent via Telegram to {formData.isFarmWide ? 'all authorized users' : formData.miner ? 'the miner owner' : 'all authorized users'}.
            </MuiAlert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateAlert}
            disabled={!formData.name || !formData.severity || !formData.summary}
          >
            Create Alert
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Alerts;
