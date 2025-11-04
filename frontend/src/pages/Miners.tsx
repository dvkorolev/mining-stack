import React, { useState } from 'react';
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
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import WarningIcon from '@mui/icons-material/Warning';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import { useSelector } from 'react-redux';
import { selectMiners } from '../features/mining/miningSlice';
import { fetchMiningStats, addMiner as addMinerAPI, updateMiner as updateMinerAPI, deleteMiner as deleteMinerAPI, rebootMiner as rebootMinerAPI, bulkRebootMiners, rebootAllMiners, getMinerPools } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { useIsMobile } from '../hooks/useIsMobile';
import MinerCardList from '../components/MinerCardList';

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
  // Get miners from Redux store (updated in real-time via WebSocket)
  const minersFromStore = useSelector(selectMiners);
  const miners = minersFromStore.map(m => ({
    ...m,
    lastSeen: new Date(m.lastSeen),
  }));
  
  const { showSuccess, showError, showWarning } = useNotification();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingMiner, setEditingMiner] = useState<Miner | null>(null);
  const [selectedMiners, setSelectedMiners] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    ip: '',
    model: '',
    alias: '',
    owner: '',
  });

  // Load miners data (only for manual refresh)
  const loadMiners = async () => {
    try {
      setLoading(true);
      await fetchMiningStats();
      setError(null);
    } catch (error) {
      console.error('Error loading miners:', error);
      setError('Failed to load miners');
    } finally {
      setLoading(false);
    }
  };

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
      });
    } else {
      setEditingMiner(null);
      setFormData({
        name: '',
        ip: '',
        model: '',
        alias: '',
        owner: '',
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

  // Reboot single miner
  const handleRebootMiner = async (minerId: string, minerName: string) => {
    if (!window.confirm(`Reboot ${minerName}? This will temporarily interrupt mining.`)) {
      return;
    }
    
    try {
      const result = await rebootMinerAPI(minerId);
      if (result.success) {
        showSuccess(result.message);
      } else {
        showError(result.message);
      }
    } catch (error) {
      console.error('Error rebooting miner:', error);
      showError('Failed to reboot miner');
    }
  };

  // Bulk reboot selected miners (commented out - not used in UI currently)
  // const handleBulkReboot = async () => {
  //   if (selectedMiners.length === 0) {
  //     showWarning('Please select miners to reboot');
  //     return;
  //   }

  //   if (!window.confirm(`Reboot ${selectedMiners.length} selected miners? This will temporarily interrupt mining.`)) {
  //     return;
  //   }

  //   try {
  //     const result = await bulkRebootMiners(selectedMiners);
  //     const successCount = result.results.filter((r: any) => r.success).length;
  //     showSuccess(`Rebooted ${successCount} of ${selectedMiners.length} miners`);
  //     setSelectedMiners([]);
  //   } catch (error) {
  //     console.error('Error bulk rebooting:', error);
  //     showError('Failed to reboot miners');
  //   }
  // };

  // Reboot all miners (commented out - not used in UI currently)
  // const handleRebootAll = async () => {
  //   const totalMiners = miners.length;
  //   
  //   if (!window.confirm(`⚠️ REBOOT ALL ${totalMiners} MINERS?\n\nThis will temporarily interrupt mining on your entire farm.\n\nAre you sure?`)) {
  //     return;
  //   }

  //   try {
  //     const result = await rebootAllMiners();
  //     const successCount = result.results.filter((r: any) => r.success).length;
  //     showSuccess(`Rebooted ${successCount} of ${totalMiners} miners`);
  //     setSelectedMiners([]);
  //   } catch (error) {
  //     console.error('Error rebooting all miners:', error);
  //     showError('Failed to reboot all miners');
  //   }
  // };

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

  // Load pools when editing miner (commented out - not used currently)
  // const loadMinerPools = async (minerId: string) => {
  //   try {
  //     const result = await getMinerPools(minerId);
  //     if (result.success && result.pools) {
  //       console.log('Miner pools:', result.pools);
  //     }
  //   } catch (error) {
  //     console.error('Error loading pools:', error);
  //   }
  // };

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


      {/* Mobile View: Card List */}
      {isMobile ? (
        <MinerCardList
          miners={miners as any[]}
          onReboot={handleRebootMiner}
          onEdit={(miner) => handleOpenDialog(miner as any)}
        />
      ) : (
        /* Desktop View: Table */
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
                    <TableCell>{(miner as any).alias || '-'}</TableCell>
                    <TableCell>{(miner as any).owner || '-'}</TableCell>
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
      )}

      {/* Add/Edit Dialog */}
      <Dialog 
        open={openDialog} 
        onClose={handleCloseDialog} 
        maxWidth="sm" 
        fullWidth
        fullScreen={isMobile}
      >
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
