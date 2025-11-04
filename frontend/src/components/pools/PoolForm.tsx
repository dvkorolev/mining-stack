// frontend/src/components/pools/PoolForm.tsx
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  FormHelperText,
} from '@mui/material';
import { PoolConfig } from '../../services/poolsApi';

interface PoolFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (pool: PoolConfig) => void;
  initialData?: PoolConfig;
  title: string;
}

const PoolForm: React.FC<PoolFormProps> = ({
  open,
  onClose,
  onSubmit,
  initialData,
  title,
}) => {
  const [formData, setFormData] = useState<PoolConfig>({
    url: '',
    name: '',
    algorithm: 'sha256',
    priority: 'medium',
  });

  const [errors, setErrors] = useState<{
    url?: string;
    name?: string;
  }>({});

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData({
        url: '',
        name: '',
        algorithm: 'sha256',
        priority: 'medium',
      });
    }
    setErrors({});
  }, [initialData, open]);

  const validateForm = (): boolean => {
    const newErrors: { url?: string; name?: string } = {};

    if (!formData.url.trim()) {
      newErrors.url = 'URL is required';
    } else if (!formData.url.includes(':')) {
      newErrors.url = 'URL must be in format hostname:port';
    } else {
      const [hostname, portStr] = formData.url.split(':');
      const port = parseInt(portStr, 10);
      
      if (!hostname || hostname.length === 0) {
        newErrors.url = 'Invalid hostname';
      }
      
      if (isNaN(port) || port < 1 || port > 65535) {
        newErrors.url = 'Port must be between 1 and 65535';
      }
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  const handleChange = (field: keyof PoolConfig, value: string) => {
    setFormData({ ...formData, [field]: value });
    // Clear error for this field
    if (errors[field as keyof typeof errors]) {
      setErrors({ ...errors, [field]: undefined });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Pool Name"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              error={!!errors.name}
              helperText={errors.name || 'e.g., SlushPool, F2Pool'}
              required
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Pool URL"
              value={formData.url}
              onChange={(e) => handleChange('url', e.target.value)}
              error={!!errors.url}
              helperText={errors.url || 'Format: hostname:port (e.g., stratum.slushpool.com:3333)'}
              placeholder="stratum.example.com:3333"
              required
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Algorithm</InputLabel>
              <Select
                value={formData.algorithm}
                label="Algorithm"
                onChange={(e) => handleChange('algorithm', e.target.value)}
              >
                <MenuItem value="sha256">SHA-256 (Bitcoin)</MenuItem>
                <MenuItem value="scrypt">Scrypt (Litecoin)</MenuItem>
                <MenuItem value="multi">Multi-Algorithm</MenuItem>
              </Select>
              <FormHelperText>Mining algorithm used by this pool</FormHelperText>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                value={formData.priority}
                label="Priority"
                onChange={(e) => handleChange('priority', e.target.value)}
              >
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
              <FormHelperText>Monitoring priority level</FormHelperText>
            </FormControl>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" color="primary">
          {initialData ? 'Update' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PoolForm;
