import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Typography,
  Box,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

interface TransferOwnershipDialogProps {
  open: boolean;
  onClose: () => void;
  miner: {
    name: string;
    ip: string;
    model: string;
    owner?: string;
  } | null;
  onTransferSuccess: () => void;
}

const TransferOwnershipDialog: React.FC<TransferOwnershipDialogProps> = ({
  open,
  onClose,
  miner,
  onTransferSuccess,
}) => {
  const { isAdmin } = useAuth();
  const [newOwner, setNewOwner] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTransfer = async () => {
    if (!miner || !newOwner.trim()) {
      setError('Please enter a valid Telegram Chat ID');
      return;
    }

    if (!isAdmin) {
      setError('Admin access required to transfer ownership');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use IP for transfer to avoid URL encoding issues with Cyrillic names/aliases
      const minerIdentifier = miner.ip || miner.name;
      await api.post(`/mining/miners/${encodeURIComponent(minerIdentifier)}/transfer`, {
        newOwner: newOwner.trim(),
      });

      // Close dialog first to prevent error display
      handleClose();
      // Call success callback outside try-catch to avoid catching its errors
      setTimeout(() => {
        try {
          onTransferSuccess();
        } catch (callbackErr) {
          console.error('Success callback error:', callbackErr);
        }
      }, 0);
    } catch (err: any) {
      console.error('Transfer error:', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to transfer ownership');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setNewOwner('');
    setError(null);
    onClose();
  };

  if (!miner) return null;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <SwapHorizIcon />
          Transfer Ownership
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box mb={2}>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Miner Details:
          </Typography>
          <Typography variant="body1">
            <strong>Name:</strong> {miner.name}
          </Typography>
          <Typography variant="body1">
            <strong>IP:</strong> {miner.ip}
          </Typography>
          <Typography variant="body1">
            <strong>Model:</strong> {miner.model}
          </Typography>
          {miner.owner && (
            <Typography variant="body1">
              <strong>Current Owner:</strong> {miner.owner.substring(0, 4)}***
            </Typography>
          )}
        </Box>

        <TextField
          autoFocus
          margin="dense"
          label="New Owner Telegram Chat ID"
          type="text"
          fullWidth
          variant="outlined"
          value={newOwner}
          onChange={(e) => setNewOwner(e.target.value)}
          placeholder="e.g., 123456789"
          helperText="Enter the Telegram Chat ID of the new owner. They can get it by sending /whoami to the bot."
          disabled={loading}
        />

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        <Alert severity="warning" sx={{ mt: 2 }}>
          <Typography variant="body2">
            <strong>Admin Only:</strong> This action requires administrator privileges.
          </Typography>
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleTransfer}
          variant="contained"
          color="primary"
          disabled={loading || !newOwner.trim()}
          startIcon={loading ? <CircularProgress size={20} /> : <SwapHorizIcon />}
        >
          {loading ? 'Transferring...' : 'Transfer Ownership'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TransferOwnershipDialog;
