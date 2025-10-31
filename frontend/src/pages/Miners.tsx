import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

const Miners: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Miners Management
      </Typography>
      
      <Paper
        sx={{
          p: 4,
          textAlign: 'center',
          minHeight: 400,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ConstructionIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h5" gutterBottom>
          Coming Soon
        </Typography>
        <Typography variant="body1" color="text.secondary">
          The Miners Management page is currently under development.
        </Typography>
      </Paper>
    </Box>
  );
};

export default Miners;
