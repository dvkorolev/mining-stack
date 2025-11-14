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
  Tooltip,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import GroupIcon from '@mui/icons-material/Group';
import WarningIcon from '@mui/icons-material/Warning';
import {
  getPoolApis,
  getPoolAccounts,
  createPoolAccount,
  updatePoolAccount,
  deletePoolAccount,
  getPoolUserInfo,
  getPoolRewards,
  getPoolPayouts,
  fetchMiningStats,
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

interface MinerInfo {
  minerId: string;
  name: string;
  ip: string;
  algorithm?: string;
  pools?: Array<{
    url: string;
    user: string;
    priority: number;
  }>;
}

const PoolEarnings: React.FC = () => {
  const [poolApis, setPoolApis] = useState<PoolApi[]>([]);
  const [poolAccounts, setPoolAccounts] = useState<PoolAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<PoolAccount | null>(null);
  const [userInfo, setUserInfo] = useState<PoolUserInfo | null>(null);
  const [rewards, setRewards] = useState<PoolReward[]>([]);
  const [payouts, setPayouts] = useState<PoolPayout[]>([]);
  const [miners, setMiners] = useState<MinerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [openMinersDialog, setOpenMinersDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PoolAccount | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    pool_api_id: 1, // Default to EMCD
    account_name: '',
    usernames: '', // Comma-separated pool usernames
    api_key: '',
    coin: 'btc',
    notes: '',
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
      const [apis, accounts, miningStats] = await Promise.all([
        getPoolApis(),
        getPoolAccounts(),
        fetchMiningStats(),
      ]);
      setPoolApis(apis);
      setPoolAccounts(accounts);
      setMiners(miningStats.miners || []);
      
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
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error('Error loading pool data:', err);
      setUserInfo(null);
      setRewards([]);
      setPayouts([]);
    } finally {
      setDataLoading(false);
    }
  };

  // Get miners using a specific account (by matching usernames in worker names)
  const getMinersForAccount = (account: PoolAccount): MinerInfo[] => {
    if (!account.usernames) return [];
    
    const usernames = account.usernames.split(',').map(u => u.trim().toLowerCase());
    
    return miners.filter(miner => 
      miner.pools?.some(pool => {
        const workerName = pool.user?.toLowerCase() || '';
        return usernames.some(username => workerName.startsWith(username + '.'));
      })
    );
  };

  // Get miners that don't match any account
  const getUnmatchedMiners = (): MinerInfo[] => {
    return miners.filter(miner => {
      const minerUsername = miner.pools?.[0]?.user?.split('.')[0]?.toLowerCase();
      if (!minerUsername) return false;
      
      return !poolAccounts.some(account => {
        if (!account.usernames) return false;
        const usernames = account.usernames.split(',').map(u => u.trim().toLowerCase());
        return usernames.includes(minerUsername);
      });
    });
  };

  const handleOpenDialog = (account?: PoolAccount) => {
    if (account) {
      setEditingAccount(account);
      setFormData({
        pool_api_id: account.pool_api_id,
        account_name: account.account_name,
        usernames: account.usernames || '',
        api_key: '', // Don't show existing API key
        coin: account.coin || 'btc',
        notes: account.notes || '',
      });
    } else {
      setEditingAccount(null);
      setFormData({
        pool_api_id: 1,
        account_name: '',
        usernames: '',
        api_key: '',
        coin: 'btc',
        notes: '',
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingAccount(null);
  };

  const handleSave = async () => {
    try {
      const accountData: any = {
        ...formData,
        usernames: formData.usernames.trim() || undefined,
        notes: formData.notes.trim() || undefined,
      };

      if (editingAccount) {
        // Update existing account - only send fields that changed
        if (!accountData.api_key) {
          delete accountData.api_key; // Don't update if blank
        }
        await updatePoolAccount(editingAccount.id, accountData);
      } else {
        // Create new account
        if (!accountData.api_key) {
          throw new Error('API Key is required for new accounts');
        }
        await createPoolAccount(accountData);
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

  const handleRefresh = async () => {
    if (selectedAccount) {
      await loadPoolData(selectedAccount.id);
    }
    await loadData(); // Also refresh miners list
  };

  const unmatchedMiners = getUnmatchedMiners();

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
        <Box>
          <Typography variant="h4">Pool Earnings</Typography>
          {lastUpdated && (
            <Typography variant="caption" color="textSecondary">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </Typography>
          )}
        </Box>
        <Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={dataLoading}
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

      {/* Unmatched Miners Warning */}
      {unmatchedMiners.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <WarningIcon sx={{ mr: 1 }} />
              <Typography>
                {unmatchedMiners.length} miner(s) don't match any pool account
              </Typography>
            </Box>
            <Button size="small" onClick={() => setOpenMinersDialog(true)}>
              View Details
            </Button>
          </Box>
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
                {poolAccounts.map((account) => {
                  const minerCount = getMinersForAccount(account).length;
                  return (
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
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                          <Box flex={1}>
                            <Typography variant="subtitle1">{account.account_name}</Typography>
                            <Chip label={account.pool_name} size="small" sx={{ mr: 0.5 }} />
                            {account.coin && (
                              <Chip label={account.coin.toUpperCase()} size="small" variant="outlined" />
                            )}
                            {account.usernames && (
                              <Box mt={0.5}>
                                <Typography variant="caption" color="textSecondary">
                                  Usernames: {account.usernames}
                                </Typography>
                              </Box>
                            )}
                            <Box display="flex" alignItems="center" mt={0.5}>
                              <GroupIcon fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />
                              <Typography variant="caption" color="textSecondary">
                                {minerCount} miner(s)
                              </Typography>
                            </Box>
                          </Box>
                          <Box>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDialog(account);
                              }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(account.id);
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  );
                })}
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Pool Data Display */}
        <Grid item xs={12} md={8}>
          {!selectedAccount ? (
            <Paper sx={{ p: 3 }}>
              <Alert severity="info">Select a pool account to view its earnings data</Alert>
            </Paper>
          ) : dataLoading ? (
            <Paper sx={{ p: 3 }}>
              <Box display="flex" justifyContent="center">
                <CircularProgress />
              </Box>
            </Paper>
          ) : (
            <Paper sx={{ p: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">
                  {selectedAccount.account_name}
                </Typography>
                <Tooltip title="View miners using this account">
                  <Chip
                    icon={<GroupIcon />}
                    label={`${getMinersForAccount(selectedAccount).length} miners`}
                    onClick={() => setOpenMinersDialog(true)}
                    clickable
                  />
                </Tooltip>
              </Box>

              <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
                <Tab label="Account Info" />
                <Tab label="Rewards" />
                <Tab label="Payouts" />
                <Tab label="Miners" />
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
                        <Typography variant="h6">
                          {userInfo.balance.toFixed(8)} {userInfo.coin?.toUpperCase() || selectedAccount.coin?.toUpperCase()}
                        </Typography>
                      </Grid>
                    )}
                    {userInfo.totalPaid !== undefined && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Total Paid
                        </Typography>
                        <Typography variant="h6">
                          {userInfo.totalPaid.toFixed(8)} {userInfo.coin?.toUpperCase() || selectedAccount.coin?.toUpperCase()}
                        </Typography>
                      </Grid>
                    )}
                    {userInfo.minPayout !== undefined && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Min Payout
                        </Typography>
                        <Typography variant="h6">
                          {userInfo.minPayout.toFixed(8)} {userInfo.coin?.toUpperCase() || selectedAccount.coin?.toUpperCase()}
                        </Typography>
                      </Grid>
                    )}
                    {userInfo.payoutAddress && (
                      <Grid item xs={12}>
                        <Typography variant="body2" color="textSecondary">
                          Payout Address
                        </Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
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

              {/* Miners Tab */}
              <TabPanel value={tabValue} index={3}>
                {(() => {
                  const accountMiners = getMinersForAccount(selectedAccount);
                  return accountMiners.length > 0 ? (
                    <List>
                      {accountMiners.map((miner) => (
                        <ListItem key={miner.minerId} divider>
                          <ListItemText
                            primary={miner.name}
                            secondary={
                              <>
                                <Typography component="span" variant="body2">
                                  IP: {miner.ip}
                                </Typography>
                                {miner.pools && miner.pools[0] && (
                                  <>
                                    <br />
                                    <Typography component="span" variant="body2" color="textSecondary">
                                      Worker: {miner.pools[0].user}
                                    </Typography>
                                    <br />
                                    <Typography component="span" variant="body2" color="textSecondary">
                                      Pool: {miner.pools[0].url}
                                    </Typography>
                                  </>
                                )}
                              </>
                            }
                          />
                          {miner.algorithm && (
                            <Chip label={miner.algorithm.toUpperCase()} size="small" />
                          )}
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Alert severity="info">
                      No miners match this account's usernames. Add usernames to see miners.
                    </Alert>
                  );
                })()}
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
              helperText="Descriptive name for this account"
            />

            <TextField
              fullWidth
              label="Pool Usernames"
              value={formData.usernames}
              onChange={(e) => setFormData({ ...formData, usernames: e.target.value })}
              sx={{ mb: 2 }}
              helperText="Comma-separated list (e.g., myuser,scryptuser) for matching miners"
              placeholder="myuser,altuser"
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Coin</InputLabel>
              <Select
                value={formData.coin}
                label="Coin"
                onChange={(e) => setFormData({ ...formData, coin: e.target.value })}
              >
                <MenuItem value="btc">BTC</MenuItem>
                <MenuItem value="ltc">LTC</MenuItem>
                <MenuItem value="bch">BCH</MenuItem>
                <MenuItem value="bsv">BSV</MenuItem>
                <MenuItem value="etc">ETC</MenuItem>
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="API Key"
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              sx={{ mb: 2 }}
              helperText={editingAccount ? 'Leave blank to keep existing API key' : 'Required'}
            />

            <TextField
              fullWidth
              label="Notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              multiline
              rows={2}
              helperText="Optional notes about this account"
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

      {/* Unmatched Miners Dialog */}
      <Dialog open={openMinersDialog} onClose={() => setOpenMinersDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {selectedAccount ? `Miners Using ${selectedAccount.account_name}` : 'Unmatched Miners'}
        </DialogTitle>
        <DialogContent>
          {selectedAccount ? (
            (() => {
              const accountMiners = getMinersForAccount(selectedAccount);
              return accountMiners.length > 0 ? (
                <List>
                  {accountMiners.map((miner) => (
                    <ListItem key={miner.minerId} divider>
                      <ListItemText
                        primary={miner.name}
                        secondary={
                          <>
                            IP: {miner.ip}
                            {miner.pools && miner.pools[0] && (
                              <>
                                {' | '}Worker: {miner.pools[0].user}
                                {' | '}Pool: {miner.pools[0].url}
                              </>
                            )}
                          </>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Alert severity="info">No miners match this account</Alert>
              );
            })()
          ) : (
            <>
              {unmatchedMiners.length > 0 ? (
                <>
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    These miners have pool configurations that don't match any pool account username.
                    Add their usernames to an existing account or create a new account.
                  </Alert>
                  <List>
                    {unmatchedMiners.map((miner) => (
                      <ListItem key={miner.minerId} divider>
                        <ListItemText
                          primary={miner.name}
                          secondary={
                            <>
                              IP: {miner.ip}
                              {miner.pools && miner.pools[0] && (
                                <>
                                  {' | '}Worker: {miner.pools[0].user}
                                  {' | '}Username: <strong>{miner.pools[0].user.split('.')[0]}</strong>
                                </>
                              )}
                            </>
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              ) : (
                <Alert severity="success">All miners are matched to pool accounts!</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenMinersDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PoolEarnings;
