// frontend/src/components/miners/MinerPoolConfig.tsx
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
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import SyncIcon from '@mui/icons-material/Sync';
import { useNotification } from '../../context/NotificationContext';
import {
  getMinerPoolAssignments,
  assignPoolToMiner,
  removePoolFromMiner,
  updateMinerPoolAssignments,
  syncHardwarePoolsToDatabase,
  MinerPoolAssignment,
  PoolAssignmentRequest,
} from '../../services/minerPoolsApi';
import { getPools, PoolConfig } from '../../services/poolsApi';

interface MinerPoolConfigProps {
  minerIp: string;
  minerName: string;
}

const MinerPoolConfig: React.FC<MinerPoolConfigProps> = ({ minerIp, minerName }) => {
  const { showSuccess, showError } = useNotification();
  const [assignments, setAssignments] = useState<MinerPoolAssignment[]>([]);
  const [availablePools, setAvailablePools] = useState<PoolConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newAssignment, setNewAssignment] = useState<PoolAssignmentRequest>({
    pool_id: 0,
    priority: 0,
    user: '',
    password: '',
  });

  // Load data
  const loadData = async () => {
    try {
      setLoading(true);
      const [assignmentsData, poolsData] = await Promise.all([
        getMinerPoolAssignments(minerIp),
        getPools(),
      ]);
      setAssignments(assignmentsData);
      setAvailablePools(poolsData);
    } catch (error) {
      showError('Failed to load pool configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [minerIp]);

  // Add pool assignment
  const handleAddPool = async () => {
    try {
      if (newAssignment.pool_id === 0) {
        showError('Please select a pool');
        return;
      }

      await assignPoolToMiner(minerIp, newAssignment);
      showSuccess('Pool assigned successfully');
      setShowAddDialog(false);
      setNewAssignment({ pool_id: 0, priority: 0, user: '', password: '' });
      loadData();
    } catch (error) {
      showError('Failed to assign pool');
    }
  };

  // Remove pool assignment
  const handleRemovePool = async (poolId: number, poolName: string) => {
    if (!window.confirm(`Remove pool "${poolName}" from ${minerName}?`)) {
      return;
    }

    try {
      await removePoolFromMiner(minerIp, poolId);
      showSuccess('Pool assignment removed');
      loadData();
    } catch (error) {
      showError('Failed to remove pool assignment');
    }
  };

  // Sync hardware pools to database
  const handleSyncFromHardware = async () => {
    try {
      setLoading(true);
      const result = await syncHardwarePoolsToDatabase(minerIp);
      
      if (result.success) {
        if (result.synced > 0) {
          showSuccess(`Synced ${result.synced} of ${result.total} pools from hardware`);
        }
        if (result.errors && result.errors.length > 0) {
          result.errors.forEach(err => showError(err));
        }
        loadData();
      } else {
        showError(result.message || 'Failed to sync pools');
      }
    } catch (error) {
      showError('Failed to sync pools from hardware');
    } finally {
      setLoading(false);
    }
  };

  // Get priority badge color
  const getPriorityColor = (priority: number): 'primary' | 'secondary' | 'default' => {
    if (priority === 0) return 'primary';
    if (priority === 1) return 'secondary';
    return 'default';
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Pool Configuration</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<SyncIcon />}
            onClick={handleSyncFromHardware}
            disabled={loading}
          >
            Sync from Hardware
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowAddDialog(true)}
            disabled={availablePools.length === 0}
          >
            Assign Pool
          </Button>
        </Box>
      </Box>

      {/* Info Alert */}
      {assignments.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No pools assigned to this miner. Click "Sync from Hardware" to import current pools, or "Assign Pool" to add manually.
        </Alert>
      )}

      {/* Assignments Table */}
      {assignments.length > 0 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Priority</TableCell>
                <TableCell>Pool Name</TableCell>
                <TableCell>URL</TableCell>
                <TableCell>Worker</TableCell>
                <TableCell>Assigned</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments
                .sort((a, b) => a.pool_priority - b.pool_priority)
                .map((assignment) => (
                  <TableRow key={assignment.pool_id}>
                    <TableCell>
                      <Chip
                        label={`Pool ${assignment.pool_priority + 1}`}
                        color={getPriorityColor(assignment.pool_priority)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {assignment.pool_name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {assignment.pool_url}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {assignment.pool_user || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {new Date(assignment.assigned_at).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleRemovePool(assignment.pool_id, assignment.pool_name)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add Pool Dialog */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Pool to {minerName}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            {/* Pool Selection */}
            <FormControl fullWidth>
              <InputLabel>Select Pool</InputLabel>
              <Select
                value={newAssignment.pool_id}
                label="Select Pool"
                onChange={(e) =>
                  setNewAssignment({ ...newAssignment, pool_id: Number(e.target.value) })
                }
              >
                <MenuItem value={0}>
                  <em>Select a pool...</em>
                </MenuItem>
                {availablePools
                  .filter((pool) => !assignments.some((a) => a.pool_id === pool.id))
                  .map((pool) => (
                    <MenuItem key={pool.id} value={pool.id}>
                      {pool.name} ({pool.url})
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>

            {/* Priority */}
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                value={newAssignment.priority}
                label="Priority"
                onChange={(e) =>
                  setNewAssignment({ ...newAssignment, priority: Number(e.target.value) })
                }
              >
                <MenuItem value={0}>Pool 1 (Primary)</MenuItem>
                <MenuItem value={1}>Pool 2 (Secondary)</MenuItem>
                <MenuItem value={2}>Pool 3 (Tertiary)</MenuItem>
              </Select>
            </FormControl>

            {/* Worker Name */}
            <TextField
              fullWidth
              label="Worker Name"
              placeholder="e.g., worker1.001"
              value={newAssignment.user}
              onChange={(e) => setNewAssignment({ ...newAssignment, user: e.target.value })}
              helperText="Worker name for this pool (e.g., username.worker)"
            />

            {/* Password */}
            <TextField
              fullWidth
              label="Password (optional)"
              type="password"
              value={newAssignment.password}
              onChange={(e) => setNewAssignment({ ...newAssignment, password: e.target.value })}
              helperText="Pool password (usually 'x' or leave empty)"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddDialog(false)}>Cancel</Button>
          <Button onClick={handleAddPool} variant="contained" startIcon={<SaveIcon />}>
            Assign Pool
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MinerPoolConfig;
