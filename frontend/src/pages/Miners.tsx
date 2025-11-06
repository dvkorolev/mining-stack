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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useSelector, useDispatch } from 'react-redux';
import { selectMiners, setMinerRebooting } from '../features/mining/miningSlice';
import { fetchMiningStats, addMiner as addMinerAPI, updateMiner as updateMinerAPI, deleteMiner as deleteMinerAPI, rebootMiner as rebootMinerAPI, bulkRebootMiners, rebootAllMiners, getMinerPools } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { useIsMobile } from '../hooks/useIsMobile';
import MinerCardList from '../components/MinerCardList';
import VirtualizedMinerTable from '../components/VirtualizedMinerTable';
import MinersTableSkeleton from '../components/MinersTableSkeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import MinerDetailsModal from '../components/MinerDetailsModal';

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

const Miners: React.FC = () => {
  // Get miners from Redux store (updated in real-time via WebSocket)
  const minersFromStore = useSelector(selectMiners);
  const miners = minersFromStore.map(m => ({
    ...m,
    lastSeen: new Date(m.lastSeen),
  }));
  
  const dispatch = useDispatch();
  const { showSuccess, showError, showWarning } = useNotification();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingMiner, setEditingMiner] = useState<Miner | null>(null);
  const [selectedMiners, setSelectedMiners] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'hashrate' | 'temperature' | 'errors'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [formData, setFormData] = useState({
    name: '',
    ip: '',
    model: '',
    alias: '',
    owner: '',
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedMinerForDetails, setSelectedMinerForDetails] = useState<Miner | null>(null);

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
    const miner = miners.find(m => m.minerId === minerId);
    const minerName = miner?.name || minerId;
    
    setConfirmDialog({
      open: true,
      title: 'Delete Miner',
      message: `Are you sure you want to delete ${minerName}? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await deleteMinerAPI(minerId);
          showSuccess(`Miner ${minerName} deleted successfully`);
          await loadMiners();
        } catch (error) {
          console.error('Error deleting miner:', error);
          showError('Failed to delete miner');
        } finally {
          setConfirmDialog({ ...confirmDialog, open: false });
        }
      },
    });
  };

  // Reboot single miner with optimistic update
  const handleRebootMiner = async (minerId: string, minerName: string) => {
    if (!window.confirm(`Reboot ${minerName}? This will temporarily interrupt mining.`)) {
      return;
    }
    
    try {
      // Optimistic update: immediately show rebooting status
      dispatch(setMinerRebooting(minerId));
      showSuccess(`Rebooting ${minerName}...`);
      
      // Make API call
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

  // Open miner details modal
  const handleOpenDetails = (miner: Miner) => {
    setSelectedMinerForDetails(miner);
    setDetailsModalOpen(true);
  };

  // Close miner details modal
  const handleCloseDetails = () => {
    setDetailsModalOpen(false);
    setSelectedMinerForDetails(null);
  };

  // Handle sorting
  const handleSort = (column: 'name' | 'status' | 'hashrate' | 'temperature' | 'errors') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Sort miners
  const sortedMiners = [...miners].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortBy) {
      case 'name':
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
        break;
      case 'status':
        const statusOrder = { online: 1, error: 2, offline: 3 };
        aValue = statusOrder[a.status] || 4;
        bValue = statusOrder[b.status] || 4;
        break;
      case 'hashrate':
        aValue = a.currentHashrate || 0;
        bValue = b.currentHashrate || 0;
        break;
      case 'temperature':
        aValue = a.hardware?.temperature || 0;
        bValue = b.hardware?.temperature || 0;
        break;
      case 'errors':
        aValue = a.errorCount || 0;
        bValue = b.errorCount || 0;
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  if (loading && miners.length === 0) {
    return (
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4">
            Miners Management
          </Typography>
        </Box>
        <MinersTableSkeleton />
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
      ) : miners.length > 50 ? (
        /* Desktop View: Virtualized Table for large lists (50+ miners) */
        <VirtualizedMinerTable
          miners={miners}
          onReboot={handleRebootMiner}
          onEdit={(miner) => handleOpenDialog(miner)}
          onDelete={handleDeleteMiner}
        />
      ) : (
        /* Desktop View: Regular Table for small lists */
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
                <TableCell 
                  onClick={() => handleSort('status')}
                  sx={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <Box display="flex" alignItems="center" gap={0.5}>
                    Status
                    {sortBy === 'status' && (
                      sortOrder === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                    )}
                  </Box>
                </TableCell>
                <TableCell 
                  onClick={() => handleSort('name')}
                  sx={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <Box display="flex" alignItems="center" gap={0.5}>
                    Name
                    {sortBy === 'name' && (
                      sortOrder === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                    )}
                  </Box>
                </TableCell>
                <TableCell>IP Address</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Alias</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedMiners.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography color="textSecondary" sx={{ py: 4 }}>
                      No miners configured. Click "Add Miner" or "Auto-Discover" to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                sortedMiners.map((miner) => (
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
                    <TableCell>
                      <Typography
                        sx={{
                          cursor: 'pointer',
                          color: 'primary.main',
                          '&:hover': {
                            textDecoration: 'underline',
                          },
                        }}
                        onClick={() => handleOpenDetails(miner)}
                      >
                        {miner.name}
                      </Typography>
                    </TableCell>
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

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="Delete"
        confirmColor="error"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ ...confirmDialog, open: false })}
      />

      {/* Miner Details Modal */}
      <MinerDetailsModal
        open={detailsModalOpen}
        miner={selectedMinerForDetails}
        onClose={handleCloseDetails}
        onReboot={handleRebootMiner}
      />
    </Box>
  );
};

export default Miners;
