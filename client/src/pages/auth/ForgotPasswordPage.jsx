import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/common/Button.jsx';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/format.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [debugUrl, setDebugUrl] = useState(''); const [debugOtp, setDebugOtp] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const onSubmit = async (event) => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); setDebugUrl(''); setDebugOtp(''); try { const response = await api.post('/auth/forgot-password', { email }); setMessage(response.data?.message || 'If an account exists for this email, you’ll receive a reset link and one-time code shortly.'); setDebugUrl(response.data?.data?.debugResetUrl || ''); setDebugOtp(response.data?.data?.debugOtp || ''); } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); } };
  return <AuthLayout title="Reset your password" description="Enter your work email. We’ll email a secure reset link and a one-time verification code." footer={<>Remembered your password? <Link to="/login">Back to sign in</Link></>}><form className="form-stack" onSubmit={onSubmit}><label className="field-label">Work email<input type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>{message && <div className="form-success" role="status"><p>{message}</p>{debugUrl && <p><Link to={debugUrl}>Open the development reset link</Link></p>}{debugOtp && <p>Development verification code: <strong>{debugOtp}</strong></p>}</div>}{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link and code'}</Button></form></AuthLayout>;
}
