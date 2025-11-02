import React, { useState, useEffect } from 'react';
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
  Button,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  Alert,
  CircularProgress,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import WarningIcon from '@mui/icons-material/Warning';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TuneIcon from '@mui/icons-material/Tune';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import { fetchMiningStats, addMiner as addMinerAPI, updateMiner as updateMinerAPI, deleteMiner as deleteMinerAPI, discoverMiners as discoverMinersAPI, rebootMiner as rebootMinerAPI, bulkRebootMiners, rebootAllMiners, getMinerPools } from '../services/api';

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
  ip: string;
  model: string;
  alias?: string;
  owner?: string;
  status: 'online' | 'offline' | 'error';
  statusMessage?: string;
  lastSeen: Date;
  currentHashrate?: number;
  hardware?: {
    temperature?: number;
    powerUsage?: number;
  };
  errors?: MinerError[];
  errorCount?: number;
  lastError?: MinerError;
}

const Miners: React.FC = () => {
  const [miners, setMiners] = useState<Miner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingMiner, setEditingMiner] = useState<Miner | null>(null);
  const [selectedMiners, setSelectedMiners] = useState<string[]>([]);
  const [minerPools, setMinerPools] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    ip: '',
    model: '',
    alias: '',
    owner: '',
    thresholds: {
      temperature: { warning: '', critical: '', shutdown: '' },
      hashrate: { expected: '', warningPercent: '', criticalPercent: '' },
      power: { expected: '', warningPercent: '' },
      rejectionRate: { warning: '', critical: '' },
      fanSpeed: { warning: '', critical: '' },
    },
  });

  // Load miners data
  const loadMiners = async () => {
    try {
      setLoading(true);
      const stats = await fetchMiningStats();
      // Convert MinerStats to Miner interface
      const minersData = (stats.miners || []).map(m => ({
        ...m,
        lastSeen: new Date(m.lastSeen),
      }));
      setMiners(minersData);
      setError(null);
    } catch (error) {
      console.error('Error loading miners:', error);
      setError('Failed to load miners');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMiners();
    // Refresh every 30 seconds
    const interval = setInterval(loadMiners, 30000);
    return () => clearInterval(interval);
  }, []);

  // Open add/edit dialog
  const handleOpenDialog = (miner?: Miner) => {
    if (miner) {
      setEditingMiner(miner);
      setFormData({
        name: miner.name,
        ip: miner.ip,
        model: miner.model,
        alias: miner.alias || '',
        owner: miner.owner || '',
        thresholds: {
          temperature: { 
            warning: (miner as any).thresholds?.temperature?.warning?.toString() || '', 
            critical: (miner as any).thresholds?.temperature?.critical?.toString() || '', 
            shutdown: (miner as any).thresholds?.temperature?.shutdown?.toString() || '' 
          },
          hashrate: { 
            expected: (miner as any).thresholds?.hashrate?.expected?.toString() || '', 
            warningPercent: (miner as any).thresholds?.hashrate?.warningPercent?.toString() || '', 
            criticalPercent: (miner as any).thresholds?.hashrate?.criticalPercent?.toString() || '' 
          },
          power: { 
            expected: (miner as any).thresholds?.power?.expected?.toString() || '', 
            warningPercent: (miner as any).thresholds?.power?.warningPercent?.toString() || '' 
          },
          rejectionRate: { 
            warning: (miner as any).thresholds?.rejectionRate?.warning?.toString() || '', 
            critical: (miner as any).thresholds?.rejectionRate?.critical?.toString() || '' 
          },
          fanSpeed: { 
            warning: (miner as any).thresholds?.fanSpeed?.warning?.toString() || '', 
            critical: (miner as any).thresholds?.fanSpeed?.critical?.toString() || '' 
          },
        },
      });
    } else {
      setEditingMiner(null);
      setFormData({
        name: '',
        ip: '',
        model: '',
        alias: '',
        owner: '',
        thresholds: {
          temperature: { warning: '', critical: '', shutdown: '' },
          hashrate: { expected: '', warningPercent: '', criticalPercent: '' },
          power: { expected: '', warningPercent: '' },
          rejectionRate: { warning: '', critical: '' },
          fanSpeed: { warning: '', critical: '' },
        },
      });
    }
    setOpenDialog(true);
  };

  // Close dialog
  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingMiner(null);
    setFormData({
      name: '',
      ip: '',
      model: '',
      alias: '',
      owner: '',
      thresholds: {
        temperature: { warning: '', critical: '', shutdown: '' },
        hashrate: { expected: '', warningPercent: '', criticalPercent: '' },
        power: { expected: '', warningPercent: '' },
        rejectionRate: { warning: '', critical: '' },
        fanSpeed: { warning: '', critical: '' },
      },
    });
  };

  // Handle form input changes
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Save miner (add or update)
  const handleSaveMiner = async () => {
    try {
      if (editingMiner) {
        await updateMinerAPI(editingMiner.minerId, formData);
      } else {
        await addMinerAPI(formData);
      }
      handleCloseDialog();
      await loadMiners();
    } catch (error) {
      console.error('Error saving miner:', error);
      setError('Failed to save miner');
    }
  };

  // Delete miner
  const handleDeleteMiner = async (minerId: string) => {
    if (!window.confirm('Are you sure you want to delete this miner?')) {
      return;
    }
    
    try {
      await deleteMinerAPI(minerId);
      await loadMiners();
    } catch (error) {
      console.error('Error deleting miner:', error);
      setError('Failed to delete miner');
    }
  };

  // Auto-discover miners
  const handleAutoDiscover = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await discoverMinersAPI();
      alert(`Success! Discovered ${result.miners?.length || 0} miners`);
      await loadMiners();
    } catch (error) {
      console.error('Error during auto-discovery:', error);
      setError('Failed to auto-discover miners. Make sure Python and pyasic are installed.');
    } finally {
      setLoading(false);
    }
  };

  // Reboot single miner
  const handleRebootMiner = async (minerId: string, minerName: string) => {
    if (!window.confirm(`Reboot ${minerName}? This will temporarily interrupt mining.`)) {
      return;
    }
    
    try {
      const result = await rebootMinerAPI(minerId);
      if (result.success) {
        alert(result.message);
      } else {
        setError(result.message);
      }
    } catch (error) {
      console.error('Error rebooting miner:', error);
      setError('Failed to reboot miner');
    }
  };

  // Bulk reboot selected miners
  const handleBulkReboot = async () => {
    if (selectedMiners.length === 0) {
      alert('Please select miners to reboot');
      return;
    }

    if (!window.confirm(`Reboot ${selectedMiners.length} selected miners? This will temporarily interrupt mining.`)) {
      return;
    }

    try {
      const result = await bulkRebootMiners(selectedMiners);
      const successCount = result.results.filter((r: any) => r.success).length;
      alert(`Rebooted ${successCount} of ${selectedMiners.length} miners`);
      setSelectedMiners([]);
    } catch (error) {
      console.error('Error bulk rebooting:', error);
      setError('Failed to reboot miners');
    }
  };

  // Reboot all miners
  const handleRebootAll = async () => {
    const totalMiners = miners.length;
    
    if (!window.confirm(`⚠️ REBOOT ALL ${totalMiners} MINERS?\n\nThis will temporarily interrupt mining on your entire farm.\n\nAre you sure?`)) {
      return;
    }

    try {
      const result = await rebootAllMiners();
      const successCount = result.results.filter((r: any) => r.success).length;
      alert(`Rebooted ${successCount} of ${totalMiners} miners`);
      setSelectedMiners([]);
    } catch (error) {
      console.error('Error rebooting all miners:', error);
      setError('Failed to reboot all miners');
    }
  };

  // Toggle miner selection
  const handleToggleSelect = (minerId: string) => {
    setSelectedMiners(prev =>
      prev.includes(minerId)
        ? prev.filter(id => id !== minerId)
        : [...prev, minerId]
    );
  };

  // Select all miners
  const handleSelectAll = () => {
    if (selectedMiners.length === miners.length) {
      setSelectedMiners([]);
    } else {
      setSelectedMiners(miners.map(m => m.minerId));
    }
  };

  // Load pools when editing miner
  const loadMinerPools = async (minerId: string) => {
    try {
      const result = await getMinerPools(minerId);
      if (result.success && result.pools) {
        setMinerPools(result.pools);
      }
    } catch (error) {
      console.error('Error loading pools:', error);
    }
  };

  // Get status color
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

  if (loading && miners.length === 0) {
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
          Miners Management
        </Typography>
        <Box>
          <Tooltip title="Auto-discover miners on network">
            <Button
              variant="outlined"
              startIcon={<SearchIcon />}
              onClick={handleAutoDiscover}
              sx={{ mr: 1 }}
              disabled={loading}
            >
              Auto-Discover
            </Button>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadMiners}
            sx={{ mr: 1 }}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
          >
            Add Miner
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {selectedMiners.length > 0 && (
        <Paper sx={{ mb: 2, p: 2, bgcolor: 'action.selected' }}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="body1">
              {selectedMiners.length} miner{selectedMiners.length > 1 ? 's' : ''} selected
            </Typography>
            <Box>
              <Button
                variant="outlined"
                startIcon={<RestartAltIcon />}
                onClick={handleBulkReboot}
                sx={{ mr: 1 }}
              >
                Reboot Selected
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<RestartAltIcon />}
                onClick={handleRebootAll}
                sx={{ mr: 1 }}
              >
                Reboot All ({miners.length})
              </Button>
              <Button
                variant="outlined"
                onClick={() => setSelectedMiners([])}
              >
                Clear Selection
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Tooltip title={selectedMiners.length === miners.length ? "Deselect all" : "Select all"}>
                    <IconButton onClick={handleSelectAll} size="small">
                      {selectedMiners.length === miners.length ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
                    </IconButton>
                  </Tooltip>
                </TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>IP Address</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Alias</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {miners.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography color="textSecondary" sx={{ py: 4 }}>
                      No miners configured. Click "Add Miner" or "Auto-Discover" to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                miners.map((miner) => (
                  <TableRow key={miner.minerId} selected={selectedMiners.includes(miner.minerId)}>
                    <TableCell padding="checkbox">
                      <IconButton
                        size="small"
                        onClick={() => handleToggleSelect(miner.minerId)}
                      >
                        {selectedMiners.includes(miner.minerId) ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Chip
                          label={miner.statusMessage || miner.status.toUpperCase()}
                          color={getStatusColor(miner.status)}
                          size="small"
                        />
                        {miner.lastError && (
                          <Tooltip 
                            title={
                              <Box>
                                <Typography variant="body2" fontWeight="bold">
                                  {miner.lastError.message}
                                </Typography>
                                <Typography variant="caption">
                                  {miner.lastError.description}
                                </Typography>
                                {miner.lastError.details && (
                                  <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                                    Details: {JSON.stringify(miner.lastError.details)}
                                  </Typography>
                                )}
                                <Typography variant="caption" display="block" sx={{ mt: 0.5, opacity: 0.7 }}>
                                  {new Date(miner.lastError.timestamp).toLocaleString()}
                                </Typography>
                              </Box>
                            }
                            arrow
                          >
                            <IconButton size="small" color="error">
                              <WarningIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{miner.name}</TableCell>
                    <TableCell>{miner.ip}</TableCell>
                    <TableCell>{miner.model}</TableCell>
                    <TableCell>{miner.alias || '-'}</TableCell>
                    <TableCell>{miner.owner || '-'}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Reboot miner">
                        <IconButton
                          size="small"
                          color="warning"
                          onClick={() => handleRebootMiner(miner.minerId, miner.name)}
                        >
                          <RestartAltIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit miner">
                        <IconButton
                          size="small"
                          onClick={() => handleOpenDialog(miner)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete miner">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteMiner(miner.minerId)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Add/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingMiner ? 'Edit Miner' : 'Add New Miner'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                required
                helperText="Unique identifier for the miner"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="IP Address"
                value={formData.ip}
                onChange={(e) => handleInputChange('ip', e.target.value)}
                required
                placeholder="192.168.1.100"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Model"
                value={formData.model}
                onChange={(e) => handleInputChange('model', e.target.value)}
                required
                placeholder="Antminer S19j Pro"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Alias"
                value={formData.alias}
                onChange={(e) => handleInputChange('alias', e.target.value)}
                placeholder="Main Mining Rig 1"
                helperText="Friendly display name (optional)"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Owner"
                value={formData.owner}
                onChange={(e) => handleInputChange('owner', e.target.value)}
                placeholder="EN"
                helperText="Owner identifier (optional)"
              />
            </Grid>
            
            {/* Advanced Thresholds Section */}
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <TuneIcon />
                    <Typography>Advanced Thresholds (Optional)</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                        Leave empty to use global defaults
                      </Typography>
                      <Divider sx={{ mb: 2 }} />
                    </Grid>
                    
                    {/* Temperature Thresholds */}
                    <Grid item xs={12}>
                      <Typography variant="body2" fontWeight="bold" gutterBottom>
                        Temperature (°C)
                      </Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <TextField
                        fullWidth
                        label="Warning"
                        type="number"
                        value={formData.thresholds.temperature.warning}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            temperature: { ...prev.thresholds.temperature, warning: e.target.value }
                          }
                        }))}
                        placeholder="75"
                        helperText="Default: 75°C"
                      />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField
                        fullWidth
                        label="Critical"
                        type="number"
                        value={formData.thresholds.temperature.critical}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            temperature: { ...prev.thresholds.temperature, critical: e.target.value }
                          }
                        }))}
                        placeholder="85"
                        helperText="Default: 85°C"
                      />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField
                        fullWidth
                        label="Shutdown"
                        type="number"
                        value={formData.thresholds.temperature.shutdown}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            temperature: { ...prev.thresholds.temperature, shutdown: e.target.value }
                          }
                        }))}
                        placeholder="90"
                        helperText="Default: 90°C"
                      />
                    </Grid>
                    
                    {/* Hashrate Thresholds */}
                    <Grid item xs={12} sx={{ mt: 2 }}>
                      <Typography variant="body2" fontWeight="bold" gutterBottom>
                        Hashrate
                      </Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <TextField
                        fullWidth
                        label="Expected (TH/s)"
                        type="number"
                        value={formData.thresholds.hashrate.expected}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            hashrate: { ...prev.thresholds.hashrate, expected: e.target.value }
                          }
                        }))}
                        placeholder="105"
                        helperText="Expected hashrate"
                      />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField
                        fullWidth
                        label="Warning %"
                        type="number"
                        value={formData.thresholds.hashrate.warningPercent}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            hashrate: { ...prev.thresholds.hashrate, warningPercent: e.target.value }
                          }
                        }))}
                        placeholder="20"
                        helperText="Default: 20% below"
                      />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField
                        fullWidth
                        label="Critical %"
                        type="number"
                        value={formData.thresholds.hashrate.criticalPercent}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            hashrate: { ...prev.thresholds.hashrate, criticalPercent: e.target.value }
                          }
                        }))}
                        placeholder="50"
                        helperText="Default: 50% below"
                      />
                    </Grid>
                    
                    {/* Power Thresholds */}
                    <Grid item xs={12} sx={{ mt: 2 }}>
                      <Typography variant="body2" fontWeight="bold" gutterBottom>
                        Power
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Expected (W)"
                        type="number"
                        value={formData.thresholds.power.expected}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            power: { ...prev.thresholds.power, expected: e.target.value }
                          }
                        }))}
                        placeholder="3400"
                        helperText="Expected power consumption"
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Warning %"
                        type="number"
                        value={formData.thresholds.power.warningPercent}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            power: { ...prev.thresholds.power, warningPercent: e.target.value }
                          }
                        }))}
                        placeholder="15"
                        helperText="Default: ±15% deviation"
                      />
                    </Grid>
                    
                    {/* Rejection Rate Thresholds */}
                    <Grid item xs={12} sx={{ mt: 2 }}>
                      <Typography variant="body2" fontWeight="bold" gutterBottom>
                        Rejection Rate (%)
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Warning"
                        type="number"
                        value={formData.thresholds.rejectionRate.warning}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            rejectionRate: { ...prev.thresholds.rejectionRate, warning: e.target.value }
                          }
                        }))}
                        placeholder="2"
                        helperText="Default: 2%"
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Critical"
                        type="number"
                        value={formData.thresholds.rejectionRate.critical}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            rejectionRate: { ...prev.thresholds.rejectionRate, critical: e.target.value }
                          }
                        }))}
                        placeholder="5"
                        helperText="Default: 5%"
                      />
                    </Grid>
                    
                    {/* Fan Speed Thresholds */}
                    <Grid item xs={12} sx={{ mt: 2 }}>
                      <Typography variant="body2" fontWeight="bold" gutterBottom>
                        Fan Speed (RPM)
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Warning"
                        type="number"
                        value={formData.thresholds.fanSpeed.warning}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            fanSpeed: { ...prev.thresholds.fanSpeed, warning: e.target.value }
                          }
                        }))}
                        placeholder="3000"
                        helperText="Default: 3000 RPM"
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Critical"
                        type="number"
                        value={formData.thresholds.fanSpeed.critical}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          thresholds: {
                            ...prev.thresholds,
                            fanSpeed: { ...prev.thresholds.fanSpeed, critical: e.target.value }
                          }
                        }))}
                        placeholder="2000"
                        helperText="Default: 2000 RPM"
                      />
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            onClick={handleSaveMiner}
            variant="contained"
            disabled={!formData.name || !formData.ip || !formData.model}
          >
            {editingMiner ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Miners;
