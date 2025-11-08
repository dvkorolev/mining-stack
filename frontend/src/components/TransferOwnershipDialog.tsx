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
  const [newOwner, setNewOwner] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTransfer = async () => {
    if (!miner || !newOwner.trim()) {
      setError('Please enter a valid Telegram Chat ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get admin chat ID from localStorage or environment
      const adminChatId = localStorage.getItem('adminChatId') || '';
      
      if (!adminChatId) {
        setError('Admin Chat ID not configured. Please set it in Settings.');
        setLoading(false);
        return;
      }

      // Use IP for transfer to avoid URL encoding issues with Cyrillic names/aliases
      const minerIdentifier = miner.ip || miner.name;
      const response = await fetch(`/api/mining/miners/${encodeURIComponent(minerIdentifier)}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Chat-ID': adminChatId,
        },
        body: JSON.stringify({ newOwner: newOwner.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
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
      } else {
        setError(data.error || data.message || 'Failed to transfer ownership');
      }
    } catch (err) {
      console.error('Transfer error:', err);
      setError('Error connecting to server');
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
            Make sure you have set your Admin Chat ID in Settings.
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
