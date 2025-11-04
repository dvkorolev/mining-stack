// frontend/src/pages/PoolsManagement.tsx
import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Snackbar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import PoolsList from '../components/pools/PoolsList';
import PoolForm from '../components/pools/PoolForm';
import PoolConfigPanel from '../components/pools/PoolConfigPanel';
import {
  getPoolsConfig,
  updatePoolsConfig,
  addPool,
  updatePool,
  deletePool,
  testPool,
  triggerPoolCollection,
  PoolConfig,
  PoolsConfiguration,
} from '../services/poolsApi';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`pools-tabpanel-${index}`}
      aria-labelledby={`pools-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const PoolsManagement: React.FC = () => {
  const [config, setConfig] = useState<PoolsConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPool, setEditingPool] = useState<PoolConfig | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

  // Load pools configuration
  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getPoolsConfig();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pools configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // Add pool
  const handleAddPool = async (pool: PoolConfig) => {
    try {
      await addPool(pool);
      await loadConfig();
      setShowAddForm(false);
      showSnackbar(`Pool "${pool.name}" added successfully`);
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to add pool', 'error');
    }
  };

  // Update pool
  const handleUpdatePool = async (oldUrl: string, updatedPool: PoolConfig) => {
    try {
      await updatePool(oldUrl, updatedPool);
      await loadConfig();
      setEditingPool(null);
      showSnackbar(`Pool "${updatedPool.name}" updated successfully`);
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to update pool', 'error');
    }
  };

  // Delete pool
  const handleDeletePool = async (url: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete pool "${name}"?`)) {
      return;
    }

    try {
      await deletePool(url);
      await loadConfig();
      showSnackbar(`Pool "${name}" deleted successfully`);
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to delete pool', 'error');
    }
  };

  // Test pool connection
  const handleTestPool = async (url: string, name: string) => {
    try {
      showSnackbar(`Testing connection to ${name}...`, 'info');
      const result = await testPool(url);
      
      if (result.success) {
        showSnackbar(
          `${name} is reachable (${result.duration_ms}ms)`,
          'success'
        );
      } else {
        showSnackbar(
          `${name} is not reachable: ${result.error || result.message}`,
          'error'
        );
      }
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to test pool', 'error');
    }
  };

  // Update configuration settings
  const handleUpdateConfig = async (newConfig: PoolsConfiguration) => {
    try {
      await updatePoolsConfig(newConfig);
      await loadConfig();
      showSnackbar('Configuration updated successfully');
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to update configuration', 'error');
    }
  };

  // Trigger pool collection
  const handleTriggerCollection = async () => {
    try {
      showSnackbar('Triggering pool collection...', 'info');
      const result = await triggerPoolCollection();
      
      if (result.success) {
        showSnackbar('Pool collection triggered successfully');
      } else {
        showSnackbar(result.message, 'error');
      }
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to trigger collection', 'error');
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ mt: 2 }}>
          Loading pools configuration...
        </Typography>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error" action={
          <Button color="inherit" size="small" onClick={loadConfig}>
            Retry
          </Button>
        }>
          {error}
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          Pool Management
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleTriggerCollection}
            sx={{ mr: 1 }}
          >
            Collect Now
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadConfig}
            sx={{ mr: 1 }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowAddForm(true)}
          >
            Add Pool
          </Button>
        </Box>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="pools tabs">
          <Tab label={`Pools (${config?.pools.length || 0})`} />
          <Tab label="Configuration" />
        </Tabs>

        {/* Pools List Tab */}
        <TabPanel value={tabValue} index={0}>
          {config && (
            <PoolsList
              pools={config.pools}
              onEdit={(pool) => setEditingPool(pool)}
              onDelete={handleDeletePool}
              onTest={handleTestPool}
            />
          )}
        </TabPanel>

        {/* Configuration Tab */}
        <TabPanel value={tabValue} index={1}>
          {config && (
            <PoolConfigPanel
              config={config}
              onUpdate={handleUpdateConfig}
            />
          )}
        </TabPanel>
      </Paper>

      {/* Add Pool Dialog */}
      {showAddForm && (
        <PoolForm
          open={showAddForm}
          onClose={() => setShowAddForm(false)}
          onSubmit={handleAddPool}
          title="Add New Pool"
        />
      )}

      {/* Edit Pool Dialog */}
      {editingPool && (
        <PoolForm
          open={!!editingPool}
          onClose={() => setEditingPool(null)}
          onSubmit={(pool) => handleUpdatePool(editingPool.url, pool)}
          initialData={editingPool}
          title="Edit Pool"
        />
      )}

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default PoolsManagement;
