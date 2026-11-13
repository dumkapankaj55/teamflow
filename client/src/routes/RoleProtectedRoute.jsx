import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function RoleProtectedRoute({ roles }) {
  const { membership, loading } = useAuth();
  if (loading) return <div className="full-loading" role="status">Checking workspace access…</div>;
  return roles.includes(membership?.role) ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
