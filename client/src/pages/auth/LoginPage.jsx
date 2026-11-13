import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage } from '../../utils/format.js';

export default function LoginPage() {
  const { login } = useAuth(); const navigate = useNavigate(); const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const onChange = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const onSubmit = async (event) => { event.preventDefault(); setError(''); setBusy(true); try { await login(form); const redirect = searchParams.get('redirect'); navigate(redirect?.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard', { replace: true }); } catch (requestError) { setError(errorMessage(requestError, 'We couldn’t sign you in.')); } finally { setBusy(false); } };
  return <AuthLayout title="Welcome back" description="Sign in to pick up where your team left off." footer={<>New to TeamFlow? <Link to="/register">Create an account</Link></>}><form className="form-stack" onSubmit={onSubmit}><label className="field-label">Work email<input autoComplete="email" type="email" name="email" value={form.email} onChange={onChange} placeholder="you@company.com" required /></label><label className="field-label">Password<input autoComplete="current-password" type="password" name="password" value={form.password} onChange={onChange} placeholder="Enter your password" required minLength="8" /></label><div className="form-row"><span /> <Link to="/forgot-password">Forgot password?</Link></div>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to TeamFlow'}</Button></form></AuthLayout>;
}
