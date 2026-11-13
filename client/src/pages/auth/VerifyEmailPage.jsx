import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/format.js';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('Verifying your email address...');

  useEffect(() => {
    let active = true;
    if (!token) {
      setStatus('error');
      setMessage('This verification link is missing its token. Request a new link and try again.');
      return () => { active = false; };
    }
    api.post('/auth/verify-email', { token })
      .then(() => {
        if (active) {
          setStatus('success');
          setMessage('Your email is verified. You can sign in to TeamFlow now.');
        }
      })
      .catch((error) => {
        if (active) {
          setStatus('error');
          setMessage(errorMessage(error, 'This verification link is invalid or expired.'));
        }
      });
    return () => { active = false; };
  }, [token]);

  return (
    <AuthLayout title={status === 'success' ? 'Email verified' : status === 'error' ? 'Link unavailable' : 'Verifying email'} description={message} footer={<><Link to="/login">Sign in</Link> or <Link to="/register">create an account</Link></>}>
      <p className={status === 'error' ? 'form-error' : 'form-success'} role={status === 'error' ? 'alert' : 'status'}>{message}</p>
    </AuthLayout>
  );
}
