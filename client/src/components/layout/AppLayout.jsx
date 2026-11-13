import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { io } from 'socket.io-client';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api, getAccessToken, setAccessToken } from '../../services/api.js';

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, activeOrganizationId } = useAuth();

  useEffect(() => {
    const token = getAccessToken();
    if (!user || !activeOrganizationId || !token) return undefined;
    const apiUrl = import.meta.env.VITE_API_URL;
    const socketUrl = import.meta.env.VITE_SOCKET_URL || (apiUrl ? apiUrl.replace(/\/api\/v1\/?$/, '') : window.location.origin);
    const socket = io(socketUrl, { auth: { token, organizationId: activeOrganizationId }, withCredentials: true });
    const onNotification = (notification) => window.dispatchEvent(new CustomEvent('teamflow:notification', { detail: notification }));
    const onActivity = (activity) => window.dispatchEvent(new CustomEvent('teamflow:activity', { detail: activity }));
    const refreshAuthentication = () => {
      const updatedToken = getAccessToken();
      if (!updatedToken) { socket.disconnect(); return; }
      socket.auth = { token: updatedToken, organizationId: activeOrganizationId };
      socket.disconnect().connect();
    };
    const refreshSession = async () => {
      try {
        const response = await api.post('/auth/refresh');
        const updatedToken = response.data?.data?.accessToken;
        if (updatedToken) setAccessToken(updatedToken);
      } catch (_error) {
        window.dispatchEvent(new Event('teamflow:session-expired'));
      }
    };
    socket.on('notification:new', onNotification);
    socket.on('organization:activity', onActivity);
    socket.on('session:refresh-required', refreshSession);
    window.addEventListener('teamflow:access-token-updated', refreshAuthentication);
    return () => {
      window.removeEventListener('teamflow:access-token-updated', refreshAuthentication);
      socket.disconnect();
    };
  }, [user?._id, activeOrganizationId]);

  return (
    <div className="app-frame flex min-h-screen">
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className="app-main"><Topbar onMenu={() => setMobileOpen(true)} /><main className="page-content"><Outlet /></main></div>
    </div>
  );
}
