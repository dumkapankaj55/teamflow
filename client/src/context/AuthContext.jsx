import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessToken } from '../services/api.js';

const AuthContext = createContext(null);
const storedOrganizationId = () => window.localStorage.getItem('teamflow.activeOrganization');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [activeOrganizationId, setActiveOrganizationIdState] = useState(storedOrganizationId);
  const [loading, setLoading] = useState(true);

  const loadOrganizations = async () => {
    const response = await api.get('/organizations');
    const items = response.data?.data?.organizations || [];
    setOrganizations(items);
    const preferred = items.find((item) => item.organization?._id === activeOrganizationId);
    const selected = preferred?.organization?._id || items[0]?.organization?._id || '';
    setActiveOrganizationIdState(selected);
    if (selected) window.localStorage.setItem('teamflow.activeOrganization', selected);
    else window.localStorage.removeItem('teamflow.activeOrganization');
    return items;
  };

  const loadCurrentUser = async () => {
    const response = await api.get('/auth/me');
    const currentUser = response.data?.data?.user || null;
    setUser(currentUser);
    if (currentUser) await loadOrganizations();
    return currentUser;
  };

  const finishSignIn = async (response) => {
    const token = response.data?.data?.accessToken;
    if (token) setAccessToken(token);
    try {
      await loadCurrentUser();
      return response.data?.data;
    } catch (error) {
      setAccessToken(null);
      setUser(null);
      setOrganizations([]);
      throw error;
    }
  };

  useEffect(() => {
    let mounted = true;
    api.post('/auth/refresh')
      .then((response) => {
        if (!mounted) return;
        setAccessToken(response.data?.data?.accessToken);
        return loadCurrentUser();
      })
      .catch(() => { setAccessToken(null); setUser(null); setOrganizations([]); })
      .finally(() => { if (mounted) setLoading(false); });
    const onExpired = () => {
      setAccessToken(null);
      setUser(null);
      setOrganizations([]);
    };
    window.addEventListener('teamflow:session-expired', onExpired);
    return () => {
      mounted = false;
      window.removeEventListener('teamflow:session-expired', onExpired);
    };
  }, []);

  const login = async (credentials) => finishSignIn(await api.post('/auth/login', credentials));
  const register = async (details) => finishSignIn(await api.post('/auth/register', details));
  const logout = async () => {
    try { await api.post('/auth/logout'); } catch (_error) { /* Local sign-out still clears the in-memory session. */ } finally {
      setAccessToken(null);
      setUser(null);
      setOrganizations([]);
      setActiveOrganizationId('');
    }
  };
  const setActiveOrganizationId = (id) => {
    setActiveOrganizationIdState(id);
    if (id) window.localStorage.setItem('teamflow.activeOrganization', id);
    else window.localStorage.removeItem('teamflow.activeOrganization');
  };

  const activeMembership = organizations.find((item) => item.organization?._id === activeOrganizationId);
  const value = useMemo(() => ({
    user, setUser, organizations, setOrganizations, activeOrganizationId, setActiveOrganizationId,
    activeOrganization: activeMembership?.organization || null,
    membership: activeMembership || null,
    loading, login, register, logout, loadOrganizations,
  }), [user, organizations, activeOrganizationId, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
