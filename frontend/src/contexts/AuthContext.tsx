import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, setAccessToken, getAccessToken } from '../services/api';

interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.data.user);
    } catch (error) {
      setUser(null);
      setAccessToken(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check if we already have an access token (e.g. page reload)
    // Actually, on reload, the token is in memory and lost.
    // We should attempt to refresh silently on mount.
    const attemptSilentRefresh = async () => {
      try {
        const res = await api.post('/auth/refresh');
        if (res.data?.data?.accessToken) {
          setAccessToken(res.data.data.accessToken);
          await fetchUser();
        } else {
          setLoading(false);
        }
      } catch (err) {
        setLoading(false);
      }
    };

    if (!getAccessToken()) {
      attemptSilentRefresh();
    } else {
      fetchUser();
    }

    // Listen for unauthorized events to clear state
    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const login = async (token: string) => {
    setLoading(true);
    setAccessToken(token);
    await fetchUser();
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout failed', error);
    } finally {
      setUser(null);
      setAccessToken(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
