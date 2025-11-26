import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import api from '../services/api';

interface User {
  id?: number;
  chatId: string;
  displayName?: string;
  role: 'admin' | 'user';
  status?: 'active' | 'suspended';
  isSystem?: boolean;
  isAdmin: boolean;
  lastLoginAt?: number | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (user: User) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch user info from backend using JWT cookie
  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/auth/me');
      setUser(response.data);
    } catch (err: any) {
      // 401 is expected if not logged in - not an error state
      if (err.response?.status !== 401) {
        console.error('Failed to fetch user info:', err);
        setError(err.response?.data?.message || 'Failed to fetch user info');
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load user on mount (cookie will be sent automatically)
  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Listen for session expiry events from api interceptor
  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
      setError('Session expired. Please log in again.');
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, []);

  // Login: set user from verification response (cookies are already set by backend)
  const login = useCallback((userData: User) => {
    setUser(userData);
    setError(null);
  }, []);

  // Logout: call backend to clear cookies
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.error('Logout request failed:', err);
    } finally {
      setUser(null);
      setError(null);
    }
  }, []);

  // Refresh user info (useful after role changes)
  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  const value: AuthContextType = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin || false,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
