import React from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Skeleton,
  Box,
} from '@mui/material';

const MinersTableSkeleton: React.FC = () => {
  return (
    <Paper>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Skeleton variant="rectangular" width={24} height={24} />
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
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <TableRow key={i}>
                <TableCell padding="checkbox">
                  <Skeleton variant="rectangular" width={24} height={24} />
                </TableCell>
                <TableCell>
                  <Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 1 }} />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width="80%" />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width="60%" />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width="70%" />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width="50%" />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width="50%" />
                </TableCell>
                <TableCell align="right">
                  <Box display="flex" gap={1} justifyContent="flex-end">
                    <Skeleton variant="circular" width={32} height={32} />
                    <Skeleton variant="circular" width={32} height={32} />
                    <Skeleton variant="circular" width={32} height={32} />
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default MinersTableSkeleton;
