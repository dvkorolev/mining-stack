// frontend/src/components/pools/PoolConfigPanel.tsx
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormControlLabel,
  Switch,
  Button,
  Grid,
  Divider,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { PoolsConfiguration } from '../../services/poolsApi';

interface PoolConfigPanelProps {
  config: PoolsConfiguration;
  onUpdate: (config: PoolsConfiguration) => void;
}

const PoolConfigPanel: React.FC<PoolConfigPanelProps> = ({ config, onUpdate }) => {
  const [formData, setFormData] = useState(config.config);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setFormData(config.config);
    setHasChanges(false);
  }, [config]);

  const handleChange = (field: keyof typeof formData, value: number | boolean) => {
    setFormData({ ...formData, [field]: value });
    setHasChanges(true);
  };

  const handleSave = () => {
    onUpdate({
      ...config,
      config: formData,
    });
    setHasChanges(false);
  };

  const handleReset = () => {
    setFormData(config.config);
    setHasChanges(false);
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Pool Monitoring Configuration
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Configure how pools are monitored and tested. Changes will be applied immediately.
      </Typography>

      <Divider sx={{ my: 2 }} />

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            type="number"
            label="Test Interval (minutes)"
            value={formData.test_interval}
            onChange={(e) => handleChange('test_interval', parseInt(e.target.value, 10))}
            inputProps={{ min: 1, max: 60 }}
            helperText="How often to test pool connections"
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            type="number"
            label="Connection Timeout (seconds)"
            value={formData.connection_timeout}
            onChange={(e) => handleChange('connection_timeout', parseInt(e.target.value, 10))}
            inputProps={{ min: 1, max: 30 }}
            helperText="Maximum time to wait for connection"
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            type="number"
            label="DNS Timeout (seconds)"
            value={formData.dns_timeout}
            onChange={(e) => handleChange('dns_timeout', parseInt(e.target.value, 10))}
            inputProps={{ min: 1, max: 10 }}
            helperText="Maximum time to wait for DNS resolution"
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <FormControlLabel
            control={
              <Switch
                checked={formData.enable_ping}
                onChange={(e) => handleChange('enable_ping', e.target.checked)}
              />
            }
            label="Enable ICMP Ping"
          />
          <Typography variant="caption" display="block" color="text.secondary">
            Test pools using ICMP ping (requires root/admin privileges)
          </Typography>
        </Grid>
      </Grid>

      <Divider sx={{ my: 3 }} />

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={!hasChanges}
        >
          Save Changes
        </Button>
        <Button
          variant="outlined"
          onClick={handleReset}
          disabled={!hasChanges}
        >
          Reset
        </Button>
      </Box>

      {hasChanges && (
        <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 2 }}>
          You have unsaved changes
        </Typography>
      )}
    </Box>
  );
};

export default PoolConfigPanel;
