import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/common/Button.jsx';
import TurnstileCaptcha from '../../components/common/TurnstileCaptcha.jsx';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/format.js';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams(); const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const captchaRef = useRef(null);
  const [otp, setOtp] = useState(''); const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [captchaToken, setCaptchaToken] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const passwordIsStrong = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,72}$/.test(password);
  const onSubmit = async (event) => {
    event.preventDefault(); setError('');
    if (!token) { setError('Open the reset link from your email, or request a new one.'); return; }
    if (!/^\d{6}$/.test(otp)) { setError('Enter the 6-digit code from your email.'); return; }
    if (!passwordIsStrong) { setError('Use at least 8 characters, including a number and a special character.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (!captchaToken) { setError('Complete the CAPTCHA check before continuing.'); return; }
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, otp, password, captchaToken });
      navigate('/login', { replace: true, state: { message: 'Your password was reset. Please sign in.' } });
    } catch (requestError) {
      setError(errorMessage(requestError));
      captchaRef.current?.reset();
    } finally { setBusy(false); }
  };
  return <AuthLayout title="Verify and reset password" description="Use the link and 6-digit code sent to your email, then choose a stronger password." footer={<>Need another reset email? <Link to="/forgot-password">Request one</Link></>}><form className="form-stack" onSubmit={onSubmit}><label className="field-label">Email verification code<input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" pattern="[0-9]{6}" maxLength="6" required /><small className="field-help">Enter the code from the same email as your reset link.</small></label><label className="field-label">New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="8" maxLength="72" aria-describedby="password-rules" required /></label><p id="password-rules" className={`form-hint ${password && !passwordIsStrong ? 'form-error-text' : ''}`}>At least 8 characters, with one number and one special character.</p><label className="field-label">Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength="8" maxLength="72" required /></label><TurnstileCaptcha ref={captchaRef} onToken={setCaptchaToken} />{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and reset password'}</Button></form></AuthLayout>;
}
