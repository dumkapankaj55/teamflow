import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/format.js';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState('');

  const onChange = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setResendNotice('');
    setNeedsVerification(false);
    setBusy(true);
    try {
      await login(form);
      const redirect = searchParams.get('redirect');
      navigate(redirect?.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard', { replace: true });
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setNeedsVerification(code === 'EMAIL_NOT_VERIFIED');
      setError(errorMessage(requestError, 'We could not sign you in.'));
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    setResendBusy(true);
    setResendNotice('');
    try {
      const response = await api.post('/auth/resend-verification', { email: form.email });
      setResendNotice(response.data?.message || 'If an unverified account exists, a verification link was sent.');
    } catch (requestError) {
      setResendNotice(errorMessage(requestError, 'Could not send a verification link. Try again later.'));
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" description="Sign in to pick up where your team left off." footer={<>New to TeamFlow? <Link to="/register">Create an account</Link></>}>
      <form className="form-stack" onSubmit={onSubmit}>
        <label className="field-label">Work email<input autoComplete="email" type="email" name="email" value={form.email} onChange={onChange} placeholder="you@company.com" required /></label>
        <label className="field-label">Password<input autoComplete="current-password" type="password" name="password" value={form.password} onChange={onChange} placeholder="Enter your password" required minLength="8" /></label>
        <div className="form-row"><span /> <Link to="/forgot-password">Forgot password?</Link></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {needsVerification && <div className="form-stack"><p className="form-hint">Verify your email address before signing in.</p><Button type="button" variant="ghost" disabled={resendBusy || !form.email} onClick={resendVerification}>{resendBusy ? 'Sending...' : 'Resend verification link'}</Button>{resendNotice && <p className="form-success" role="status">{resendNotice}</p>}</div>}
        <Button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in to TeamFlow'}</Button>
      </form>
    </AuthLayout>
  );
}
