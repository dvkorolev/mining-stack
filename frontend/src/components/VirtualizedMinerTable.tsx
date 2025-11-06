import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import WarningIcon from '@mui/icons-material/Warning';

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

interface VirtualizedMinerTableProps {
  miners: Miner[];
  onReboot: (minerId: string, minerName: string) => void;
  onEdit: (miner: Miner) => void;
  onDelete: (minerId: string) => void;
}

const VirtualizedMinerTable: React.FC<VirtualizedMinerTableProps> = ({
  miners,
  onReboot,
  onEdit,
  onDelete,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: miners.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 73, // Estimated row height
    overscan: 5, // Render 5 extra rows above and below viewport
  });

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

  return (
    <TableContainer
      component={Paper}
      ref={parentRef}
      sx={{
        height: '600px',
        overflow: 'auto',
      }}
    >
      <Table stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>Model</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Hashrate</TableCell>
            <TableCell>Temperature</TableCell>
            <TableCell>Power</TableCell>
            <TableCell>Errors</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <tr style={{ height: `${virtualizer.getTotalSize()}px` }}>
            <td />
          </tr>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const miner = miners[virtualRow.index];
            return (
              <TableRow
                key={miner.minerId}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TableCell>
                  <Box>
                    <Box fontWeight="bold">{miner.name}</Box>
                    {miner.alias && (
                      <Box fontSize="0.875rem" color="text.secondary">
                        {miner.alias}
                      </Box>
                    )}
                  </Box>
                </TableCell>
                <TableCell>{miner.ip}</TableCell>
                <TableCell>{miner.model}</TableCell>
                <TableCell>
                  <Chip
                    label={miner.statusMessage || miner.status}
                    color={getStatusColor(miner.status) as any}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  {miner.currentHashrate
                    ? `${miner.currentHashrate.toFixed(2)} TH/s`
                    : '-'}
                </TableCell>
                <TableCell>
                  {miner.hardware?.temperature
                    ? `${miner.hardware.temperature.toFixed(1)}°C`
                    : '-'}
                </TableCell>
                <TableCell>
                  {miner.hardware?.powerUsage
                    ? `${miner.hardware.powerUsage.toFixed(0)}W`
                    : '-'}
                </TableCell>
                <TableCell>
                  {miner.errorCount && miner.errorCount > 0 ? (
                    <Tooltip
                      title={
                        miner.lastError
                          ? `${miner.lastError.message}: ${miner.lastError.description}`
                          : 'Errors detected'
                      }
                    >
                      <Chip
                        icon={<WarningIcon />}
                        label={miner.errorCount}
                        color="warning"
                        size="small"
                      />
                    </Tooltip>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Reboot">
                    <IconButton
                      size="small"
                      onClick={() => onReboot(miner.minerId, miner.name)}
                      disabled={miner.status === 'offline'}
                    >
                      <RestartAltIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={() => onEdit(miner)}>
                      <EditIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      onClick={() => onDelete(miner.minerId)}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default VirtualizedMinerTable;
