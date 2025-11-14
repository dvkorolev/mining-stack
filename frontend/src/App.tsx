import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box, CircularProgress } from '@mui/material';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { Provider } from 'react-redux';
import { store } from './store';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { setupGlobalErrorHandlers } from './utils/logger';

import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';

// Lazy load pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Miners = lazy(() => import('./pages/Miners'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Alerts = lazy(() => import('./pages/Alerts'));
const AlertRulesManagement = lazy(() => import('./pages/AlertRulesManagement'));
const Settings = lazy(() => import('./pages/Settings'));
const PoolsManagement = lazy(() => import('./pages/PoolsManagement'));
const Pools = lazy(() => import('./pages/Pools'));
const Login = lazy(() => import('./pages/Login'));

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
  breakpoints: {
    values: {
      xs: 0,
      sm: 600,
      md: 960,
      lg: 1280,
      xl: 1920,
    },
  },
  components: {
    MuiContainer: {
      styleOverrides: {
        root: {
          '@media (max-width: 600px)': {
            paddingLeft: '8px',
            paddingRight: '8px',
          },
        },
      },
    },
  },
});

const App: React.FC = () => {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Setup global error handlers on mount
  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);

  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <NotificationProvider>
            <ErrorBoundary>
              <Router>
              <Box sx={{ display: 'flex' }}>
                <Navbar open={drawerOpen} toggleDrawer={toggleDrawer} />
                <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
                <Box 
                  component="main" 
                  sx={{ 
                    flexGrow: 1, 
                    p: { xs: 1, sm: 2, md: 3 }, 
                    marginTop: '64px',
                    marginLeft: { xs: 0, md: drawerOpen ? `${240}px` : 0 },
                    transition: 'margin 225ms cubic-bezier(0, 0, 0.2, 1) 0ms',
                    width: { xs: '100%', md: 'auto' },
                    maxWidth: '100vw',
                    overflowX: 'hidden',
                  }}
                >
                  <Suspense fallback={
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                      <CircularProgress />
                    </Box>
                  }>
                    <Routes>
                      <Route path="/login" element={<Login />} />
                      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                      <Route path="/miners" element={<ProtectedRoute><Miners /></ProtectedRoute>} />
                      <Route path="/pools" element={<ProtectedRoute><AdminRoute><PoolsManagement /></AdminRoute></ProtectedRoute>} />
                      <Route path="/pool-monitoring" element={<ProtectedRoute><Pools /></ProtectedRoute>} />
                      <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
                      <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
                      <Route path="/alert-rules" element={<ProtectedRoute><AdminRoute><AlertRulesManagement /></AdminRoute></ProtectedRoute>} />
                      <Route path="/settings" element={<ProtectedRoute><AdminRoute><Settings /></AdminRoute></ProtectedRoute>} />
                    </Routes>
                  </Suspense>
                </Box>
              </Box>
            </Router>
          </ErrorBoundary>
        </NotificationProvider>
      </AuthProvider>
      </ThemeProvider>
    </Provider>
  );
};

export default App;
