import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Box,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { MinerPoolSyncResult } from '../../services/poolsApi';

interface SyncResultsDialogProps {
  open: boolean;
  onClose: () => void;
  results: MinerPoolSyncResult[];
}

const SyncResultsDialog: React.FC<SyncResultsDialogProps> = ({ open, onClose, results }) => {
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Miner Pool Sync Results</Typography>
          <Box>
            <Chip
              label={`${successCount} Success`}
              color="success"
              size="small"
              sx={{ mr: 1 }}
            />
            {failureCount > 0 && (
              <Chip
                label={`${failureCount} Failed`}
                color="error"
                size="small"
              />
            )}
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width="40px"></TableCell>
                <TableCell>Miner</TableCell>
                <TableCell>IP Address</TableCell>
                <TableCell>Pools</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((result) => (
                <TableRow key={result.minerIp}>
                  <TableCell>
                    {result.success ? (
                      <CheckCircleIcon color="success" fontSize="small" />
                    ) : (
                      <ErrorIcon color="error" fontSize="small" />
                    )}
                  </TableCell>
                  <TableCell>{result.minerName}</TableCell>
                  <TableCell>{result.minerIp}</TableCell>
                  <TableCell>
                    {result.success ? (
                      result.pools && result.pools.length > 0 ? (
                        <Box>
                          {result.pools.map((pool, idx) => (
                            <Typography key={idx} variant="body2" sx={{ mb: 0.5 }}>
                              {idx + 1}. {pool.url}
                              {pool.user && ` (${pool.user})`}
                            </Typography>
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No pools configured
                        </Typography>
                      )
                    ) : (
                      <Typography variant="body2" color="error">
                        {result.error || 'Failed to fetch'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SyncResultsDialog;
