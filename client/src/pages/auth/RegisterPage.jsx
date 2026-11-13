import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage } from '../../utils/format.js';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('invitation');
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const onChange = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!/^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,72}$/.test(form.password)) {
      setError('Use at least 8 characters, including a number and a special character.');
      return;
    }
    setBusy(true);
    try {
      const result = await register({ ...form, ...(invitationToken ? { invitationToken } : {}) });
      if (result?.verificationRequired) {
        setVerificationSent(true);
        return;
      }
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError, 'We could not create your account.'));
    } finally {
      setBusy(false);
    }
  };

  const footer = verificationSent
    ? <>Already verified? <Link to="/login">Sign in</Link></>
    : <>Already have an account? <Link to={invitationToken ? `/login?redirect=${encodeURIComponent(`/accept-invitation?token=${invitationToken}`)}` : '/login'}>Sign in</Link></>;

  return (
    <AuthLayout
      title={verificationSent ? 'Check your inbox' : invitationToken ? 'Join your team' : 'Make room for good work'}
      description={verificationSent ? `We sent a verification link to ${form.email}. Open it to activate your account.` : invitationToken ? 'Create an account with the invited email to join this workspace.' : 'Create an account and set up your team workspace.'}
      footer={footer}
    >
      {verificationSent ? (
        <p className="form-success" role="status">The link expires in 24 hours. You can close this page after verifying.</p>
      ) : (
        <form className="form-stack" onSubmit={onSubmit}>
          <label className="field-label">Your name<input autoComplete="name" name="name" value={form.name} onChange={onChange} placeholder="Jamie Lee" required minLength="2" maxLength="80" /></label>
          <label className="field-label">Work email<input autoComplete="email" type="email" name="email" value={form.email} onChange={onChange} placeholder="you@company.com" required /></label>
          {!invitationToken && <label className="field-label">Workspace name<input name="organizationName" value={form.organizationName} onChange={onChange} placeholder="Acme Studio" required minLength="2" maxLength="80" /></label>}
          <label className="field-label">Password<input autoComplete="new-password" type="password" name="password" value={form.password} onChange={onChange} placeholder="8+ characters, number, special character" required minLength="8" maxLength="72" /></label>
          <p className="form-hint">Use at least 8 characters, including a number and a special character.</p>
          <p className="form-hint">By continuing, you agree to the TeamFlow terms and privacy policy.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? 'Creating account...' : invitationToken ? 'Join workspace' : 'Create your workspace'}</Button>
        </form>
      )}
    </AuthLayout>
  );
}
