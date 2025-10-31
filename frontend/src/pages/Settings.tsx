import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';

const Settings: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
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
        <SettingsIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h5" gutterBottom>
          Coming Soon
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Settings and configuration options are currently under development.
        </Typography>
      </Paper>
    </Box>
  );
};

export default Settings;
