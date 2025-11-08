import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Box, CircularProgress, Alert } from '@mui/material';

interface AdminRouteProps {
  children: React.ReactNode;
}

const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { user, loading, isAdmin } = useAuth();

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  // Not authenticated - redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Authenticated but not admin - show access denied
  if (!isAdmin) {
    return (
      <Box p={3}>
        <Alert severity="error">
          <strong>Access Denied</strong>
          <br />
          This page is only accessible to administrators.
        </Alert>
      </Box>
    );
  }

  // Admin user - render the protected content
  return <>{children}</>;
};

export default AdminRoute;
