import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [chatId, setChatId] = useState('');
  const [error, setError] = useState('');

  const handleLogin = () => {
    if (!chatId.trim()) {
      setError('Please enter your Telegram Chat ID');
      return;
    }

    // Validate it's a number
    if (!/^\d+$/.test(chatId.trim())) {
      setError('Chat ID must be a number');
      return;
    }

    // Store in localStorage
    localStorage.setItem('userChatId', chatId.trim());
    
    // Redirect to dashboard
    navigate('/');
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
          />

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleLogin}
            disabled={!chatId.trim()}
          >
            Login
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
