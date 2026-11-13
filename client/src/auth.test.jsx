import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import App from './App.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';
import ProjectsPage from './pages/projects/ProjectsPage.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { api } from './services/api.js';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  authState: { user: null, loading: false, membership: { role: 'ADMIN' } },
}));

vi.mock('./context/AuthContext.jsx', () => ({ useAuth: () => ({
  organizations: [],
  activeOrganizationId: '',
  setActiveOrganizationId: vi.fn(),
  logout: vi.fn(),
  ...mocks.authState,
  login: mocks.login,
  register: mocks.register,
}) }));

function renderInRouter(ui, initialEntry = '/') {
  return render(<ToastProvider><MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter></ToastProvider>);
}

function CurrentPath() {
  return <output>{useLocation().pathname}</output>;
}

describe('authentication forms', () => {
  beforeEach(() => { mocks.login.mockReset(); mocks.register.mockReset(); });

  it('shows a useful login error when the API rejects credentials', async () => {
    const user = userEvent.setup();
    mocks.login.mockRejectedValueOnce({ response: { data: { message: 'Email or password is incorrect.' } } });
    renderInRouter(<LoginPage />);
    await user.type(screen.getByLabelText(/work email/i), 'person@example.com');
    await user.type(screen.getByLabelText(/password/i), 'incorrect-pass');
    await user.click(screen.getByRole('button', { name: /sign in to teamflow/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('submits registration fields through the auth context', async () => {
    const user = userEvent.setup();
    mocks.register.mockRejectedValueOnce({ response: { data: { message: 'Email already used.' } } });
    renderInRouter(<RegisterPage />);
    await user.type(screen.getByLabelText(/your name/i), 'Jamie Lee');
    await user.type(screen.getByLabelText(/work email/i), 'jamie@example.com');
    await user.type(screen.getByLabelText(/workspace name/i), 'Northstar Studio');
    await user.type(screen.getByLabelText(/password/i), 'secure-password9!');
    await user.click(screen.getByRole('button', { name: /create your workspace/i }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jamie Lee', email: 'jamie@example.com', organizationName: 'Northstar Studio' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already used.');
  });

  it('asks the new user to verify their email before signing in when required', async () => {
    const user = userEvent.setup();
    mocks.register.mockResolvedValueOnce({ verificationRequired: true });
    renderInRouter(<RegisterPage />);
    await user.type(screen.getByLabelText(/your name/i), 'Jamie Lee');
    await user.type(screen.getByLabelText(/work email/i), 'jamie@example.com');
    await user.type(screen.getByLabelText(/workspace name/i), 'Northstar Studio');
    await user.type(screen.getByLabelText(/password/i), 'secure-password9!');
    await user.click(screen.getByRole('button', { name: /create your workspace/i }));
    expect(await screen.findByRole('heading', { name: /check your inbox/i })).toBeInTheDocument();
    expect(screen.getByText(/we sent a verification link to jamie@example\.com/i)).toBeInTheDocument();
  });
});

describe('protected routes and project actions', () => {
  beforeEach(() => { mocks.authState = { user: null, loading: false, membership: { role: 'ADMIN' } }; });

  it('redirects signed-out visitors to sign-in', () => {
    render(<MemoryRouter initialEntries={['/dashboard']}><Routes><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<p>Private dashboard</p>} /></Route><Route path="/login" element={<p>Sign in to continue</p>} /></Routes></MemoryRouter>);
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
  });

  it('opens and submits the create-project form', async () => {
    const user = userEvent.setup(); mocks.authState = { user: { _id: 'u1' }, loading: false, membership: { role: 'ADMIN' } };
    vi.spyOn(api, 'get').mockResolvedValue({ data: { data: { projects: [] } } });
    vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { project: { _id: 'p1', name: 'Website launch', status: 'ACTIVE' } } } });
    renderInRouter(<ProjectsPage />);
    await user.click(await screen.findByRole('button', { name: /new project/i }));
    await user.type(screen.getByLabelText(/project name/i), 'Website launch');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/projects', expect.objectContaining({ name: 'Website launch' })));
    api.get.mockRestore(); api.post.mockRestore();
  });
});

describe('Free plan analytics navigation', () => {
  beforeEach(() => {
    mocks.authState = { user: { _id: 'free-admin' }, loading: false, membership: { role: 'ADMIN', plan: { id: 'FREE' } } };
  });

  it('opens the Analytics dashboard from the sidebar without visiting Billing', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockImplementation((path) => Promise.resolve({ data: { data: path === '/analytics/overview' ? { stats: {} } : {} } }));
    renderInRouter(<><Sidebar /><CurrentPath /></>);
    await user.click(screen.getByRole('link', { name: /analytics/i }));
    expect(screen.getByText('/analytics')).toBeInTheDocument();
    expect(screen.queryByText('/billing')).not.toBeInTheDocument();
    api.get.mockRestore();
  });

  it('loads analytics through the protected application routes for a Free plan admin', async () => {
    vi.spyOn(api, 'get').mockImplementation((path) => Promise.resolve({
      data: { data: path === '/analytics/tasks' ? { tasksByStatus: [], tasksByPriority: [], completionTrend: [] } : path === '/analytics/projects' ? { projectProgress: [] } : { teamWorkload: [] } },
    }));
    renderInRouter(<App />, '/analytics');
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(await screen.findByText('Analytics will grow with your team')).toBeInTheDocument();
    expect(screen.queryByText(/view plans/i)).not.toBeInTheDocument();
    api.get.mockRestore();
  });
});
