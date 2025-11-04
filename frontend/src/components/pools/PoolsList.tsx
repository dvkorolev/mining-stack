// frontend/src/components/pools/PoolsList.tsx
import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Tooltip,
  Box,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { PoolConfig } from '../../services/poolsApi';

interface PoolsListProps {
  pools: PoolConfig[];
  onEdit: (pool: PoolConfig) => void;
  onDelete: (url: string, name: string) => void;
  onTest: (url: string, name: string) => void;
}

const PoolsList: React.FC<PoolsListProps> = ({ pools, onEdit, onDelete, onTest }) => {
  const getAlgorithmColor = (algorithm: string) => {
    switch (algorithm) {
      case 'sha256':
        return 'primary';
      case 'scrypt':
        return 'secondary';
      case 'multi':
        return 'info';
      default:
        return 'default';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'success';
      default:
        return 'default';
    }
  };

  if (pools.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body1" color="text.secondary">
          No pools configured. Click "Add Pool" to get started.
        </Typography>
      </Box>
    );
  }

  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>URL</TableCell>
            <TableCell>Algorithm</TableCell>
            <TableCell>Priority</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pools.map((pool) => (
            <TableRow key={pool.url} hover>
              <TableCell>
                <Typography variant="body2" fontWeight="medium">
                  {pool.name}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" fontFamily="monospace">
                  {pool.url}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip
                  label={pool.algorithm.toUpperCase()}
                  color={getAlgorithmColor(pool.algorithm)}
                  size="small"
                />
              </TableCell>
              <TableCell>
                <Chip
                  label={pool.priority.toUpperCase()}
                  color={getPriorityColor(pool.priority)}
                  size="small"
                  variant="outlined"
                />
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Test Connection">
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => onTest(pool.url, pool.name)}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Edit">
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => onEdit(pool)}
                  >
                    <EditIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => onDelete(pool.url, pool.name)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default PoolsList;
