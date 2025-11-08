import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import EditIcon from '@mui/icons-material/Edit';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

interface Miner {
  minerId: string;
  name: string;
  ip: string;
  model: string;
  alias?: string;
  owner?: string;
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

interface MinerCardListProps {
  miners: Miner[];
  onReboot: (minerId: string, minerName: string) => void;
  onEdit: (miner: Miner) => void;
  onTransfer?: (miner: Miner) => void;
  isAdmin?: boolean;
}

const MinerCardList: React.FC<MinerCardListProps> = ({ miners, onReboot, onEdit, onTransfer, isAdmin = false }) => {
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

  if (miners.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <Typography color="textSecondary">
          No miners configured. Add miners to get started.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {miners.map((miner) => (
        <Card key={miner.minerId} sx={{ mb: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            {/* Header: Name and Status */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Box flex={1}>
                <Typography variant="body1" fontWeight="medium">
                  {miner.name}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {miner.model}
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
                  {miner.hardware?.temperature?.toFixed(0) || '0'}°C
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
            <Box display="flex" justifyContent="flex-end" gap={1} mt={1}>
              <IconButton
                size="small"
                color="warning"
                onClick={() => onReboot(miner.minerId, miner.name)}
                sx={{ p: 1 }}
              >
                <RestartAltIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => onEdit(miner)}
                sx={{ p: 1 }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
              {onTransfer && (
                <IconButton
                  size="small"
                  color="info"
                  onClick={() => onTransfer(miner)}
                  sx={{ p: 1 }}
                >
                  <SwapHorizIcon fontSize="small" />
                </IconButton>
              )}
            </Box>

            {/* Expandable Details */}
            <Accordion 
              sx={{ 
                mt: 1, 
                boxShadow: 'none',
                '&:before': { display: 'none' },
                bgcolor: 'transparent'
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{ 
                  minHeight: 36,
                  px: 0,
                  '& .MuiAccordionSummary-content': { my: 0.5 }
                }}
              >
                <Typography variant="caption" color="primary">
                  Show Details
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0, pt: 0 }}>
                <Divider sx={{ mb: 1 }} />
                <Box>
                  <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Typography variant="caption" color="textSecondary">
                      IP Address:
                    </Typography>
                    <Typography variant="caption">
                      {miner.ip}
                    </Typography>
                  </Box>
                  {isAdmin && miner.owner && (
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="caption" color="textSecondary">
                        Owner (Chat ID):
                      </Typography>
                      <Typography variant="caption">
                        {miner.owner.substring(0, 4)}***
                      </Typography>
                    </Box>
                  )}
                  {miner.shares && (
                    <>
                      <Box display="flex" justifyContent="space-between" mb={0.5}>
                        <Typography variant="caption" color="textSecondary">
                          Accepted Shares:
                        </Typography>
                        <Typography variant="caption">
                          {miner.shares.accepted.toLocaleString()}
                        </Typography>
                      </Box>
                      <Box display="flex" justifyContent="space-between" mb={0.5}>
                        <Typography variant="caption" color="textSecondary">
                          Rejected Shares:
                        </Typography>
                        <Typography variant="caption">
                          {miner.shares.rejected.toLocaleString()}
                        </Typography>
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography variant="caption" color="textSecondary">
                          Rejection Rate:
                        </Typography>
                        <Typography variant="caption">
                          {miner.shares.accepted > 0
                            ? ((miner.shares.rejected / (miner.shares.accepted + miner.shares.rejected)) * 100).toFixed(2)
                            : '0.00'}%
                        </Typography>
                      </Box>
                    </>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
};

export default MinerCardList;
