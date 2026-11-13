import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import LoginPage from './pages/auth/LoginPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';
import ProjectsPage from './pages/projects/ProjectsPage.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { api } from './services/api.js';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  authState: { user: null, loading: false, membership: { role: 'ADMIN' } },
}));

vi.mock('./context/AuthContext.jsx', () => ({ useAuth: () => ({ ...mocks.authState, login: mocks.login, register: mocks.register }) }));

function renderInRouter(ui, initialEntry = '/') {
  return render(<ToastProvider><MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter></ToastProvider>);
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
