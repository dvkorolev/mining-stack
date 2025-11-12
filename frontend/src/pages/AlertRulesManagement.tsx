import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Tooltip,
  Alert,
  Snackbar,
  Grid,
  Card,
  CardContent,
  Tabs,
  Tab,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  History as HistoryIcon,
  PlayArrow as EnableIcon,
  Stop as DisableIcon,
  FilterList as FilterIcon,
} from '@mui/icons-material';
import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  toggleAlertRule,
  getAlertRuleHistory,
  regeneratePrometheusYAML,
  AlertRule,
  CreateAlertRuleParams,
  UpdateAlertRuleParams,
} from '../services/api';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const AlertRulesManagement: React.FC = () => {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [filteredRules, setFilteredRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  
  // Dialog states
  const [openDialog, setOpenDialog] = useState(false);
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [openHistoryDialog, setOpenHistoryDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [deletingRule, setDeletingRule] = useState<AlertRule | null>(null);
  const [ruleHistory, setRuleHistory] = useState<any[]>([]);
  
  // Form state
  const [formData, setFormData] = useState<CreateAlertRuleParams>({
    name: '',
    display_name: '',
    description: '',
    rule_group: 'mining_warning',
    severity: 'warning',
    component: 'miner',
    expr: '',
    for_duration: '5m',
    summary_template: '',
    description_template: '',
    scope: 'global',
    enabled: true,
  });
  
  // Filter state
  const [filters, setFilters] = useState({
    severity: 'all',
    component: 'all',
    enabled: 'all',
  });
  
  // Notification state
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as 'success' | 'error' | 'info',
  });

  useEffect(() => {
    loadRules();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [rules, filters, tabValue]);

  const loadRules = async () => {
    try {
      setLoading(true);
      const response = await getAlertRules();
      if (response.success) {
        setRules(response.rules);
      }
    } catch (error) {
      showSnackbar('Failed to load alert rules', 'error');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...rules];

    // Filter by tab (severity)
    if (tabValue === 1) {
      filtered = filtered.filter(r => r.severity === 'critical');
    } else if (tabValue === 2) {
      filtered = filtered.filter(r => r.severity === 'warning');
    }

    // Filter by component
    if (filters.component !== 'all') {
      filtered = filtered.filter(r => r.component === filters.component);
    }

    // Filter by enabled status
    if (filters.enabled !== 'all') {
      const isEnabled = filters.enabled === 'enabled';
      filtered = filtered.filter(r => (r.enabled === 1) === isEnabled);
    }

    setFilteredRules(filtered);
  };

  const handleOpenDialog = (rule?: AlertRule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        name: rule.name,
        display_name: rule.display_name,
        description: rule.description || '',
        rule_group: rule.rule_group,
        severity: rule.severity,
        component: rule.component,
        expr: rule.expr,
        for_duration: rule.for_duration,
        summary_template: rule.summary_template,
        description_template: rule.description_template || '',
        scope: rule.scope,
        target_miner_ip: rule.target_miner_ip,
        target_owner: rule.target_owner,
        enabled: rule.enabled === 1,
      });
    } else {
      setEditingRule(null);
      setFormData({
        name: '',
        display_name: '',
        description: '',
        rule_group: 'mining_warning',
        severity: 'warning',
        component: 'miner',
        expr: '',
        for_duration: '5m',
        summary_template: '',
        description_template: '',
        scope: 'global',
        enabled: true,
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingRule(null);
  };

  const handleSaveRule = async () => {
    try {
      if (editingRule) {
        const updateParams: UpdateAlertRuleParams = {
          display_name: formData.display_name,
          description: formData.description,
          rule_group: formData.rule_group,
          severity: formData.severity,
          component: formData.component,
          expr: formData.expr,
          for_duration: formData.for_duration,
          summary_template: formData.summary_template,
          description_template: formData.description_template,
          scope: formData.scope,
          target_miner_ip: formData.target_miner_ip,
          target_owner: formData.target_owner,
          enabled: formData.enabled,
        };
        const response = await updateAlertRule(editingRule.id, updateParams);
        if (response.success) {
          showSnackbar('Alert rule updated successfully', 'success');
          loadRules();
          handleCloseDialog();
        }
      } else {
        const response = await createAlertRule(formData);
        if (response.success) {
          showSnackbar('Alert rule created successfully', 'success');
          loadRules();
          handleCloseDialog();
        }
      }
    } catch (error: any) {
      showSnackbar(error.response?.data?.error || 'Failed to save alert rule', 'error');
    }
  };

  const handleDeleteRule = async () => {
    if (!deletingRule) return;
    
    try {
      const response = await deleteAlertRule(deletingRule.id);
      if (response.success) {
        showSnackbar('Alert rule deleted successfully', 'success');
        loadRules();
        setOpenDeleteDialog(false);
        setDeletingRule(null);
      }
    } catch (error: any) {
      showSnackbar(error.response?.data?.error || 'Failed to delete alert rule', 'error');
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      const newEnabled = rule.enabled === 0;
      const response = await toggleAlertRule(rule.id, newEnabled);
      if (response.success) {
        showSnackbar(`Alert rule ${newEnabled ? 'enabled' : 'disabled'}`, 'success');
        loadRules();
      }
    } catch (error: any) {
      showSnackbar(error.response?.data?.error || 'Failed to toggle alert rule', 'error');
    }
  };

  const handleViewHistory = async (rule: AlertRule) => {
    try {
      const response = await getAlertRuleHistory(rule.id, 50);
      if (response.success) {
        setRuleHistory(response.history);
        setEditingRule(rule);
        setOpenHistoryDialog(true);
      }
    } catch (error: any) {
      showSnackbar(error.response?.data?.error || 'Failed to load history', 'error');
    }
  };

  const handleRegenerateYAML = async () => {
    try {
      const response = await regeneratePrometheusYAML();
      if (response.success) {
        showSnackbar('Prometheus YAML regenerated successfully', 'success');
      }
    } catch (error: any) {
      showSnackbar(error.response?.data?.error || 'Failed to regenerate YAML', 'error');
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'error';
      case 'warning': return 'warning';
      case 'info': return 'info';
      default: return 'default';
    }
  };

  const getComponentColor = (component: string) => {
    switch (component) {
      case 'miner': return 'primary';
      case 'network': return 'secondary';
      case 'farm': return 'success';
      case 'system': return 'info';
      default: return 'default';
    }
  };

  const stats = {
    total: rules.length,
    enabled: rules.filter(r => r.enabled === 1).length,
    disabled: rules.filter(r => r.enabled === 0).length,
    critical: rules.filter(r => r.severity === 'critical').length,
    warning: rules.filter(r => r.severity === 'warning').length,
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Alert Rules Management</Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRegenerateYAML}
            sx={{ mr: 1 }}
          >
            Regenerate YAML
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadRules}
            sx={{ mr: 1 }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
          >
            New Rule
          </Button>
        </Box>
      </Box>

      {/* Statistics Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Total Rules</Typography>
              <Typography variant="h4">{stats.total}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Enabled</Typography>
              <Typography variant="h4" color="success.main">{stats.enabled}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Disabled</Typography>
              <Typography variant="h4" color="text.secondary">{stats.disabled}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Critical</Typography>
              <Typography variant="h4" color="error.main">{stats.critical}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Warning</Typography>
              <Typography variant="h4" color="warning.main">{stats.warning}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ mb: 2, p: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item>
            <FilterIcon />
          </Grid>
          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Component</InputLabel>
              <Select
                value={filters.component}
                label="Component"
                onChange={(e) => setFilters({ ...filters, component: e.target.value })}
              >
                <MenuItem value="all">All Components</MenuItem>
                <MenuItem value="miner">Miner</MenuItem>
                <MenuItem value="network">Network</MenuItem>
                <MenuItem value="farm">Farm</MenuItem>
                <MenuItem value="system">System</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={filters.enabled}
                label="Status"
                onChange={(e) => setFilters({ ...filters, enabled: e.target.value })}
              >
                <MenuItem value="all">All Status</MenuItem>
                <MenuItem value="enabled">Enabled</MenuItem>
                <MenuItem value="disabled">Disabled</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Tabs */}
      <Paper>
        <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
          <Tab label={`All (${rules.length})`} />
          <Tab label={`Critical (${stats.critical})`} />
          <Tab label={`Warning (${stats.warning})`} />
        </Tabs>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TabPanel value={tabValue} index={tabValue}>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Component</TableCell>
                    <TableCell>Expression</TableCell>
                    <TableCell>Duration</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight="bold">
                          {rule.display_name}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {rule.description}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={rule.severity.toUpperCase()}
                          color={getSeverityColor(rule.severity) as any}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={rule.component}
                          color={getComponentColor(rule.component) as any}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                          {rule.expr.length > 50 ? `${rule.expr.substring(0, 50)}...` : rule.expr}
                        </Typography>
                      </TableCell>
                      <TableCell>{rule.for_duration}</TableCell>
                      <TableCell>
                        <Chip
                          label={rule.enabled ? 'Enabled' : 'Disabled'}
                          color={rule.enabled ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title={rule.enabled ? 'Disable' : 'Enable'}>
                          <IconButton
                            size="small"
                            onClick={() => handleToggleRule(rule)}
                            color={rule.enabled ? 'warning' : 'success'}
                          >
                            {rule.enabled ? <DisableIcon /> : <EnableIcon />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => handleOpenDialog(rule)}
                            color="primary"
                          >
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="History">
                          <IconButton
                            size="small"
                            onClick={() => handleViewHistory(rule)}
                            color="info"
                          >
                            <HistoryIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setDeletingRule(rule);
                              setOpenDeleteDialog(true);
                            }}
                            color="error"
                            disabled={rule.is_system === 1}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredRules.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography color="textSecondary">No alert rules found</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </TabPanel>
        )}
      </Paper>

      {/* Create/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>{editingRule ? 'Edit Alert Rule' : 'Create Alert Rule'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Rule Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={!!editingRule}
                helperText="Unique identifier (cannot be changed)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Display Name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Severity</InputLabel>
                <Select
                  value={formData.severity}
                  label="Severity"
                  onChange={(e) => setFormData({ ...formData, severity: e.target.value as any })}
                >
                  <MenuItem value="critical">Critical</MenuItem>
                  <MenuItem value="warning">Warning</MenuItem>
                  <MenuItem value="info">Info</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Component</InputLabel>
                <Select
                  value={formData.component}
                  label="Component"
                  onChange={(e) => setFormData({ ...formData, component: e.target.value as any })}
                >
                  <MenuItem value="miner">Miner</MenuItem>
                  <MenuItem value="network">Network</MenuItem>
                  <MenuItem value="farm">Farm</MenuItem>
                  <MenuItem value="system">System</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Duration"
                value={formData.for_duration}
                onChange={(e) => setFormData({ ...formData, for_duration: e.target.value })}
                helperText="e.g., 5m, 10m, 1h"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="PromQL Expression"
                value={formData.expr}
                onChange={(e) => setFormData({ ...formData, expr: e.target.value })}
                multiline
                rows={3}
                helperText="Prometheus query expression"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Summary Template"
                value={formData.summary_template}
                onChange={(e) => setFormData({ ...formData, summary_template: e.target.value })}
                helperText="Alert summary (supports {{ $labels.name }}, {{ $value }})"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description Template"
                value={formData.description_template}
                onChange={(e) => setFormData({ ...formData, description_template: e.target.value })}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  />
                }
                label="Enabled"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSaveRule} variant="contained" color="primary">
            {editingRule ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)}>
        <DialogTitle>Delete Alert Rule</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the alert rule "{deletingRule?.display_name}"?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteDialog(false)}>Cancel</Button>
          <Button onClick={handleDeleteRule} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={openHistoryDialog} onClose={() => setOpenHistoryDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Change History: {editingRule?.display_name}</DialogTitle>
        <DialogContent>
          {ruleHistory.length === 0 ? (
            <Typography color="textSecondary">No history available</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Changed By</TableCell>
                    <TableCell>Changes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ruleHistory.map((entry, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        {new Date(entry.changed_at * 1000).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Chip label={entry.action} size="small" />
                      </TableCell>
                      <TableCell>{entry.changed_by || 'System'}</TableCell>
                      <TableCell>
                        <Typography variant="caption">
                          {entry.changes || 'N/A'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenHistoryDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AlertRulesManagement;
