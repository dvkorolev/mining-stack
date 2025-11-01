import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Alert,
  CircularProgress,
  Divider,
  Card,
  CardContent,
  Chip,
  IconButton,
  InputAdornment,
  Link,
} from '@mui/material';
import TelegramIcon from '@mui/icons-material/Telegram';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';

const Settings: React.FC = () => {
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [botStatus, setBotStatus] = useState<{ enabled: boolean; chatId: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load bot status on mount
  useEffect(() => {
    loadBotStatus();
  }, []);

  const loadBotStatus = async () => {
    try {
      const response = await fetch('/api/telegram/status');
      const data = await response.json();
      setBotStatus(data);
      if (data.chatId) {
        setChatId(data.chatId);
      }
    } catch (error) {
      console.error('Error loading bot status:', error);
    }
  };

  const handleSave = async () => {
    if (!botToken || !chatId) {
      setMessage({ type: 'error', text: 'Please provide both Bot Token and Chat ID' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/telegram/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: botToken, chatId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Telegram bot initialized successfully!' });
        await loadBotStatus();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to initialize bot' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error connecting to server' });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTestLoading(true);
    setTestMessage(null);

    try {
      const response = await fetch('/api/telegram/test', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setTestMessage({ type: 'success', text: `✅ ${data.message}` });
      } else {
        setTestMessage({ type: 'error', text: `❌ ${data.message}` });
      }
    } catch (error) {
      setTestMessage({ type: 'error', text: 'Error testing connection' });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      {/* Telegram Configuration Section */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box display="flex" alignItems="center" mb={3}>
          <TelegramIcon sx={{ fontSize: 32, mr: 2, color: 'primary.main' }} />
          <Typography variant="h5">
            Telegram Bot Configuration
          </Typography>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {/* Bot Status Card */}
        {botStatus && (
          <Card sx={{ mb: 3, bgcolor: botStatus.enabled ? 'success.dark' : 'grey.800' }}>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center">
                  {botStatus.enabled ? (
                    <CheckCircleIcon sx={{ mr: 2, color: 'success.light' }} />
                  ) : (
                    <ErrorIcon sx={{ mr: 2, color: 'error.light' }} />
                  )}
                  <Box>
                    <Typography variant="h6">
                      Bot Status: {botStatus.enabled ? 'Connected' : 'Disconnected'}
                    </Typography>
                    {botStatus.chatId && (
                      <Typography variant="body2" color="text.secondary">
                        Chat ID: {botStatus.chatId}
                      </Typography>
                    )}
                  </Box>
                </Box>
                <IconButton onClick={loadBotStatus} size="small">
                  <RefreshIcon />
                </IconButton>
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Configuration Form */}
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" gutterBottom>
                <strong>Setup Instructions:</strong>
              </Typography>
              <Typography variant="body2" component="div">
                1. Open Telegram and search for <strong>@BotFather</strong>
                <br />
                2. Send <code>/newbot</code> and follow the prompts
                <br />
                3. Copy the <strong>Bot Token</strong> you receive
                <br />
                4. Search for <strong>@userinfobot</strong> to get your <strong>Chat ID</strong>
                <br />
                5. Enter both values below and click Save
              </Typography>
            </Alert>
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Bot Token"
              type={showToken ? 'text' : 'password'}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              helperText="Your Telegram bot token from @BotFather"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowToken(!showToken)}
                      edge="end"
                    >
                      {showToken ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Chat ID"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="123456789"
              helperText="Your Telegram chat ID from @userinfobot"
            />
          </Grid>

          <Grid item xs={12}>
            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={loading || !botToken || !chatId}
                startIcon={loading ? <CircularProgress size={20} /> : <TelegramIcon />}
              >
                {loading ? 'Saving...' : 'Save Configuration'}
              </Button>

              <Button
                variant="outlined"
                onClick={handleTest}
                disabled={testLoading || !botStatus?.enabled}
                startIcon={testLoading ? <CircularProgress size={20} /> : <SendIcon />}
              >
                {testLoading ? 'Testing...' : 'Test Connection'}
              </Button>
            </Box>
          </Grid>

          {message && (
            <Grid item xs={12}>
              <Alert severity={message.type} onClose={() => setMessage(null)}>
                {message.text}
              </Alert>
            </Grid>
          )}

          {testMessage && (
            <Grid item xs={12}>
              <Alert severity={testMessage.type} onClose={() => setTestMessage(null)}>
                {testMessage.text}
              </Alert>
            </Grid>
          )}
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Available Commands */}
        <Box>
          <Typography variant="h6" gutterBottom>
            Available Bot Commands
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="primary" gutterBottom>
                    <code>/start</code>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Initialize bot and show help
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="primary" gutterBottom>
                    <code>/status</code>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    View farm statistics
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="primary" gutterBottom>
                    <code>/miners</code>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    List all miners
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="primary" gutterBottom>
                    <code>/miner &lt;name&gt;</code>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Get specific miner stats
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="primary" gutterBottom>
                    <code>/reboot &lt;name&gt;</code>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Reboot a miner
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="primary" gutterBottom>
                    <code>/alerts</code>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    View active alerts
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Documentation Links */}
        <Box>
          <Typography variant="h6" gutterBottom>
            Documentation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            For detailed setup instructions and troubleshooting, see:{' '}
            <Link href="/docs/TELEGRAM_BOT.md" target="_blank" rel="noopener">
              Telegram Bot Documentation
            </Link>
          </Typography>
        </Box>
      </Paper>

      {/* Future Settings Sections */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Additional Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          More configuration options coming soon...
        </Typography>
      </Paper>
    </Box>
  );
};

export default Settings;
