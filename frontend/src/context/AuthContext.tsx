import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../services/api';

interface User {
  chatId: string;
  role: 'admin' | 'user';
  isSystem: boolean;
  isAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (chatId: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch user info from backend
  const fetchUser = async () => {
    const chatId = localStorage.getItem('userChatId');
    
    if (!chatId) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/auth/me');
      setUser(response.data);
    } catch (err: any) {
      console.error('Failed to fetch user info:', err);
      setError(err.response?.data?.message || 'Failed to fetch user info');
      
      // If unauthorized, clear stored chat ID
      if (err.response?.status === 401) {
        localStorage.removeItem('userChatId');
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  // Load user on mount
  useEffect(() => {
    fetchUser();
  }, []);

  // Login: store chat ID and fetch user info
  const login = (chatId: string) => {
    localStorage.setItem('userChatId', chatId);
    fetchUser();
  };

  // Logout: clear everything
  const logout = () => {
    localStorage.removeItem('userChatId');
    localStorage.removeItem('adminChatId'); // Also clear admin chat ID
    setUser(null);
  };

  // Refresh user info (useful after role changes)
  const refreshUser = async () => {
    await fetchUser();
  };

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
