import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';

const Analytics: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Analytics
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
        <BarChartIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h5" gutterBottom>
          Coming Soon
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Advanced analytics and reporting features are currently under development.
        </Typography>
      </Paper>
    </Box>
  );
};

export default Analytics;
