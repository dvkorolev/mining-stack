/**
 * Virtualized Miner List Component
 * Uses react-window for efficient rendering of large miner lists
 */

import React, { memo } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import EditIcon from '@mui/icons-material/Edit';

interface Miner {
  minerId: string;
  name: string;
  ip: string;
  model: string;
  status: 'online' | 'offline' | 'error';
  statusMessage?: string;
  currentHashrate?: number;
  hardware?: {
    temperature?: number;
    powerUsage?: number;
  };
  shares?: {
    accepted: number;
    rejected: number;
  };
}

interface VirtualizedMinerListProps {
  miners: Miner[];
  onReboot: (minerId: string, minerName: string) => void;
  onEdit: (miner: Miner) => void;
}

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

// Memoized row component to prevent unnecessary re-renders
const MinerRow = memo(({ data, index, style }: any) => {
  const { miners, onReboot, onEdit } = data;
  const miner = miners[index];

  return (
    <div style={style}>
      <Card sx={{ mb: 1, mx: 1 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          {/* Header: Name and Status */}
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Box flex={1}>
              <Typography variant="body1" fontWeight="medium">
                {miner.name}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {miner.model} • {miner.ip}
              </Typography>
            </Box>
            <Chip
              label={miner.statusMessage || miner.status.toUpperCase()}
              color={getStatusColor(miner.status) as any}
              size="small"
            />
          </Box>

          {/* Key Metrics */}
          <Box display="flex" justifyContent="space-between" mb={1}>
            <Box>
              <Typography variant="caption" color="textSecondary" display="block">
                Hashrate
              </Typography>
              <Typography variant="body2" fontWeight="medium">
                {miner.currentHashrate?.toFixed(1) || '0'} TH/s
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="textSecondary" display="block">
                Temp
              </Typography>
              <Typography variant="body2" fontWeight="medium">
                {miner.hardware?.temperature?.toFixed(1) || '0'}°C
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="textSecondary" display="block">
                Power
              </Typography>
              <Typography variant="body2" fontWeight="medium">
                {miner.hardware?.powerUsage?.toFixed(0) || '0'}W
              </Typography>
            </Box>
          </Box>

          {/* Actions */}
          <Box display="flex" justifyContent="flex-end" gap={1}>
            <IconButton
              size="small"
              onClick={() => onEdit(miner)}
              aria-label="edit"
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => onReboot(miner.minerId, miner.name)}
              aria-label="reboot"
              disabled={miner.status === 'offline'}
            >
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </Box>
        </CardContent>
      </Card>
    </div>
  );
});

MinerRow.displayName = 'MinerRow';

const VirtualizedMinerList: React.FC<VirtualizedMinerListProps> = ({
  miners,
  onReboot,
  onEdit,
}) => {
  if (miners.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <Typography color="textSecondary">
          No miners configured. Add miners to get started.
        </Typography>
      </Box>
    );
  }

  // Item size: card height + margin
  const ITEM_SIZE = 160;

  return (
    <Box sx={{ height: 'calc(100vh - 200px)', width: '100%' }}>
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => (
          <List
            height={height}
            itemCount={miners.length}
            itemSize={ITEM_SIZE}
            width={width}
            itemData={{ miners, onReboot, onEdit }}
          >
            {MinerRow}
          </List>
        )}
      </AutoSizer>
    </Box>
  );
};

export default memo(VirtualizedMinerList);
