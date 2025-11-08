import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import TelegramIcon from '@mui/icons-material/Telegram';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [chatId, setChatId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  // Poll for verification status
  useEffect(() => {
    if (!verifying || !chatId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/auth/verify-status/${chatId}`);
        const data = await response.json();

        if (data.verified) {
          // Verification successful!
          clearInterval(pollInterval);
          login(chatId.trim()); // Use AuthContext login
          navigate('/');
        } else if (data.expired) {
          // Verification expired
          clearInterval(pollInterval);
          setError('Verification expired. Please try again.');
          setVerifying(false);
          setVerificationSent(false);
        }
      } catch (err) {
        console.error('Error checking verification status:', err);
      }
    }, 2000); // Poll every 2 seconds

    // Cleanup on unmount
    return () => clearInterval(pollInterval);
  }, [verifying, chatId, navigate]);

  const handleLogin = async () => {
    if (!chatId.trim()) {
      setError('Please enter your Telegram Chat ID');
      return;
    }

    // Validate it's a number
    if (!/^\d+$/.test(chatId.trim())) {
      setError('Chat ID must be a number');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Request verification
      const response = await fetch('/api/auth/verify-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chatId: chatId.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        setVerificationSent(true);
        setVerifying(true);
      } else {
        setError(data.error || 'Failed to send verification message');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      sx={{ bgcolor: 'background.default' }}
    >
      <Card sx={{ maxWidth: 400, width: '100%', m: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Box display="flex" flexDirection="column" alignItems="center" mb={3}>
            <LoginIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
            <Typography variant="h4" gutterBottom>
              Mining Dashboard
            </Typography>
            <Typography variant="body2" color="textSecondary" textAlign="center">
              Enter your Telegram Chat ID to access your miners
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {verificationSent && (
            <Alert severity="info" sx={{ mb: 2 }} icon={<TelegramIcon />}>
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Verification sent to Telegram!
              </Typography>
              <Typography variant="caption">
                Check your Telegram and click "Confirm Login"
              </Typography>
              {verifying && <LinearProgress sx={{ mt: 1 }} />}
            </Alert>
          )}

          <TextField
            fullWidth
            label="Telegram Chat ID"
            value={chatId}
            onChange={(e) => {
              setChatId(e.target.value);
              setError('');
            }}
            onKeyPress={handleKeyPress}
            placeholder="e.g., 246139233"
            helperText="Get your Chat ID from @userinfobot on Telegram"
            sx={{ mb: 3 }}
            autoFocus
            disabled={verifying}
          />

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleLogin}
            disabled={!chatId.trim() || loading || verifying}
            startIcon={loading ? <CircularProgress size={20} /> : <LoginIcon />}
          >
            {verifying ? 'Waiting for confirmation...' : 'Login'}
          </Button>

          <Box mt={3}>
            <Typography variant="caption" color="textSecondary" display="block" textAlign="center">
              Don't know your Chat ID?
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block" textAlign="center">
              1. Open Telegram
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block" textAlign="center">
              2. Search for @userinfobot
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block" textAlign="center">
              3. Send /start to get your ID
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Login;
