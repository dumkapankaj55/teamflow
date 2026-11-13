import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import RoleProtectedRoute from './routes/RoleProtectedRoute.jsx';
import LandingPage from './pages/LandingPage.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/auth/ResetPasswordPage.jsx';
import AcceptInvitationPage from './pages/auth/AcceptInvitationPage.jsx';
import DashboardPage from './pages/dashboard/DashboardPage.jsx';
import ProjectsPage from './pages/projects/ProjectsPage.jsx';
import ProjectDetailsPage from './pages/projects/ProjectDetailsPage.jsx';
import TasksPage from './pages/tasks/TasksPage.jsx';
import TeamPage from './pages/team/TeamPage.jsx';
import NotificationsPage from './pages/dashboard/NotificationsPage.jsx';
import ProfilePage from './pages/settings/ProfilePage.jsx';
import SettingsPage from './pages/settings/SettingsPage.jsx';
import OrganizationSettingsPage from './pages/settings/OrganizationSettingsPage.jsx';

const BoardPage = lazy(() => import('./pages/tasks/BoardPage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/dashboard/AnalyticsPage.jsx'));

function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-loading" role="status">Loading TeamFlow…</div>;
  return user ? <Navigate to="/dashboard" replace /> : <LandingPage />;
}

function NotFoundPage() {
  return <main className="not-found"><p className="eyebrow">404 · PAGE NOT FOUND</p><h1>That page isn’t here.</h1><a className="button button-primary" href="/">Back to home</a></main>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailsPage />} />
          <Route path="/board" element={<Suspense fallback={<div className="full-loading" role="status">Loading board…</div>}><BoardPage /></Suspense>} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route element={<RoleProtectedRoute roles={['ADMIN', 'MANAGER']} />}>
            <Route path="/analytics" element={<Suspense fallback={<div className="full-loading" role="status">Loading analytics…</div>}><AnalyticsPage /></Suspense>} />
          </Route>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/organization" element={<OrganizationSettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
