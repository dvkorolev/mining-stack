import React from 'react';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const userChatId = localStorage.getItem('userChatId');
  const adminChatId = localStorage.getItem('adminChatId');
  
  // If no Chat ID is set, redirect to login
  if (!userChatId && !adminChatId) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
