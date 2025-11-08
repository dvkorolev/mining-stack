import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppBar, Toolbar, Typography, IconButton, Badge, Tooltip, Box } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import LogoutIcon from '@mui/icons-material/Logout';
import { styled } from '@mui/material/styles';

const StyledAppBar = styled(AppBar, {
  shouldForwardProp: (prop) => prop !== 'open',
})<{ open?: boolean }>(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  '&.MuiAppBar-root': {
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
}));

interface NavbarProps {
  open: boolean;
  toggleDrawer: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ open, toggleDrawer }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';
  
  const handleLogout = () => {
    localStorage.removeItem('userChatId');
    navigate('/login');
  };
  
  const userChatId = localStorage.getItem('userChatId');
  const adminChatId = localStorage.getItem('adminChatId');
  const chatId = userChatId || adminChatId;
  
  return (
    <StyledAppBar position="absolute" open={open}>
      <Toolbar>
        {!isLoginPage && (
          <IconButton
            edge="start"
            color="inherit"
            aria-label="open drawer"
            onClick={toggleDrawer}
            sx={{
              marginRight: '36px',
              ...(open && { display: 'none' }),
            }}
          >
            <MenuIcon />
          </IconButton>
        )}
        <Typography
          component="h1"
          variant="h6"
          color="inherit"
          noWrap
          sx={{ flexGrow: 1 }}
        >
          Mining Dashboard
        </Typography>
        {!isLoginPage && chatId && (
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="caption" color="textSecondary">
              ID: {chatId.substring(0, 4)}***
            </Typography>
            <IconButton color="inherit" aria-label="notifications">
              <Badge badgeContent={0} color="secondary">
                <NotificationsIcon />
              </Badge>
            </IconButton>
            <Tooltip title="Logout">
              <IconButton color="inherit" onClick={handleLogout}>
                <LogoutIcon />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Toolbar>
    </StyledAppBar>
  );
};

export default Navbar;
