import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Grid,
  Chip,
  IconButton,
  Tabs,
  Tab,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  getPoolApis,
  getPoolAccounts,
  createPoolAccount,
  updatePoolAccount,
  deletePoolAccount,
  getPoolUserInfo,
  getPoolRewards,
  getPoolPayouts,
  PoolApi,
  PoolAccount,
  PoolUserInfo,
  PoolReward,
  PoolPayout,
} from '../services/api';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const Pools: React.FC = () => {
  const [poolApis, setPoolApis] = useState<PoolApi[]>([]);
  const [poolAccounts, setPoolAccounts] = useState<PoolAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<PoolAccount | null>(null);
  const [userInfo, setUserInfo] = useState<PoolUserInfo | null>(null);
  const [rewards, setRewards] = useState<PoolReward[]>([]);
  const [payouts, setPayouts] = useState<PoolPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PoolAccount | null>(null);
  const [tabValue, setTabValue] = useState(0);

  // Form state
  const [formData, setFormData] = useState({
    pool_api_id: 1, // Default to EMCD
    account_name: '',
    api_key: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      loadPoolData(selectedAccount.id);
    }
  }, [selectedAccount]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [apis, accounts] = await Promise.all([getPoolApis(), getPoolAccounts()]);
      setPoolApis(apis);
      setPoolAccounts(accounts);
      if (accounts.length > 0 && !selectedAccount) {
        setSelectedAccount(accounts[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load pool data');
    } finally {
      setLoading(false);
    }
  };

  const loadPoolData = async (accountId: number) => {
    try {
      setDataLoading(true);
      const [info, rewardsData, payoutsData] = await Promise.all([
        getPoolUserInfo(accountId),
        getPoolRewards(accountId),
        getPoolPayouts(accountId),
      ]);
      setUserInfo(info);
      setRewards(rewardsData);
      setPayouts(payoutsData);
    } catch (err: any) {
      console.error('Error loading pool data:', err);
      setUserInfo(null);
      setRewards([]);
      setPayouts([]);
    } finally {
      setDataLoading(false);
    }
  };

  const handleOpenDialog = (account?: PoolAccount) => {
    if (account) {
      setEditingAccount(account);
      setFormData({
        pool_api_id: account.pool_api_id,
        account_name: account.account_name,
        api_key: '', // Don't show existing API key
      });
    } else {
      setEditingAccount(null);
      setFormData({
        pool_api_id: 1,
        account_name: '',
        api_key: '',
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingAccount(null);
    setFormData({
      pool_api_id: 1,
      account_name: '',
      api_key: '',
    });
  };

  const handleSave = async () => {
    try {
      if (editingAccount) {
        // Update existing account
        await updatePoolAccount(editingAccount.id, formData);
      } else {
        // Create new account
        await createPoolAccount(formData);
      }
      handleCloseDialog();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to save pool account');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this pool account?')) {
      return;
    }
    try {
      await deletePoolAccount(id);
      if (selectedAccount?.id === id) {
        setSelectedAccount(null);
      }
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete pool account');
    }
  };

  const handleRefresh = () => {
    if (selectedAccount) {
      loadPoolData(selectedAccount.id);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Pool Monitoring</Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={!selectedAccount || dataLoading}
            sx={{ mr: 1 }}
          >
            Refresh
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()}>
            Add Pool Account
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Pool Accounts List */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Pool Accounts
            </Typography>
            {poolAccounts.length === 0 ? (
              <Alert severity="info">
                No pool accounts configured. Click "Add Pool Account" to get started.
              </Alert>
            ) : (
              <Box>
                {poolAccounts.map((account) => (
                  <Card
                    key={account.id}
                    sx={{
                      mb: 1,
                      cursor: 'pointer',
                      border: selectedAccount?.id === account.id ? 2 : 0,
                      borderColor: 'primary.main',
                    }}
                    onClick={() => setSelectedAccount(account)}
                  >
                    <CardContent>
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="subtitle1">{account.account_name}</Typography>
                          <Chip label={account.pool_name} size="small" />
                        </Box>
                        <Box>
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDialog(account); }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(account.id); }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Pool Data Display */}
        <Grid item xs={12} md={8}>
          {!selectedAccount ? (
            <Paper sx={{ p: 3 }}>
              <Alert severity="info">Select a pool account to view its data</Alert>
            </Paper>
          ) : dataLoading ? (
            <Paper sx={{ p: 3 }}>
              <Box display="flex" justifyContent="center">
                <CircularProgress />
              </Box>
            </Paper>
          ) : (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                {selectedAccount.account_name}
              </Typography>

              <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
                <Tab label="Account Info" />
                <Tab label="Rewards" />
                <Tab label="Payouts" />
              </Tabs>

              {/* Account Info Tab */}
              <TabPanel value={tabValue} index={0}>
                {userInfo ? (
                  <Grid container spacing={2}>
                    {userInfo.username && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Username
                        </Typography>
                        <Typography variant="h6">{userInfo.username}</Typography>
                      </Grid>
                    )}
                    {userInfo.balance !== undefined && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Balance
                        </Typography>
                        <Typography variant="h6">{userInfo.balance.toFixed(8)} {userInfo.coin?.toUpperCase()}</Typography>
                      </Grid>
                    )}
                    {userInfo.totalPaid !== undefined && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Total Paid
                        </Typography>
                        <Typography variant="h6">{userInfo.totalPaid.toFixed(8)} {userInfo.coin?.toUpperCase()}</Typography>
                      </Grid>
                    )}
                    {userInfo.minPayout !== undefined && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Min Payout
                        </Typography>
                        <Typography variant="h6">{userInfo.minPayout.toFixed(8)} {userInfo.coin?.toUpperCase()}</Typography>
                      </Grid>
                    )}
                    {userInfo.payoutAddress && (
                      <Grid item xs={12}>
                        <Typography variant="body2" color="textSecondary">
                          Payout Address
                        </Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                          {userInfo.payoutAddress}
                        </Typography>
                      </Grid>
                    )}
                  </Grid>
                ) : (
                  <Alert severity="warning">No account data available</Alert>
                )}
              </TabPanel>

              {/* Rewards Tab */}
              <TabPanel value={tabValue} index={1}>
                {rewards.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell align="right">Income</TableCell>
                          <TableCell align="right">Hashrate</TableCell>
                          <TableCell>Type</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rewards.slice(0, 20).map((reward, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {reward.datetime || new Date(reward.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell align="right">{reward.income.toFixed(8)}</TableCell>
                            <TableCell align="right">
                              {reward.hashrate ? `${reward.hashrate.toFixed(2)} TH/s` : 'N/A'}
                            </TableCell>
                            <TableCell>{reward.rewardType || 'N/A'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No rewards data available</Alert>
                )}
              </TabPanel>

              {/* Payouts Tab */}
              <TabPanel value={tabValue} index={2}>
                {payouts.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell>Transaction ID</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {payouts.slice(0, 20).map((payout, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {payout.datetime || new Date(payout.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell align="right">{payout.amount.toFixed(8)}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                              {payout.txid ? payout.txid.substring(0, 16) + '...' : 'N/A'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No payouts data available</Alert>
                )}
              </TabPanel>
            </Paper>
          )}
        </Grid>
      </Grid>

      {/* Add/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingAccount ? 'Edit Pool Account' : 'Add Pool Account'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Pool</InputLabel>
              <Select
                value={formData.pool_api_id}
                label="Pool"
                onChange={(e) => setFormData({ ...formData, pool_api_id: e.target.value as number })}
              >
                {poolApis.map((api) => (
                  <MenuItem key={api.id} value={api.id}>
                    {api.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="Account Name"
              value={formData.account_name}
              onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
              sx={{ mb: 2 }}
            />

            <TextField
              fullWidth
              label="API Key"
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              helperText={editingAccount ? 'Leave blank to keep existing API key' : 'Required'}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!formData.account_name || (!editingAccount && !formData.api_key)}
          >
            {editingAccount ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Pools;
