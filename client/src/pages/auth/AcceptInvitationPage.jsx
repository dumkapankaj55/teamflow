import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/format.js';

export default function AcceptInvitationPage() {
  const [params] = useSearchParams(); const token = params.get('token'); const { user, loading: authLoading, loadOrganizations, setActiveOrganizationId } = useAuth();
  const [state, setState] = useState('waiting'); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const attempted = useRef(false);
  const accept = async () => { if (!token) { setError('This invitation link is missing its token. Ask the workspace admin for a new link.'); setState('error'); return; } setState('accepting'); setError(''); try { const response = await api.post(`/invitations/${encodeURIComponent(token)}/accept`); const organization = response.data?.data?.organization; await loadOrganizations(); if (organization?._id) setActiveOrganizationId(organization._id); setMessage(`You’ve joined ${organization?.name || 'the workspace'}.`); setState('done'); } catch (requestError) { setError(errorMessage(requestError)); setState('error'); } };
  useEffect(() => { if (user && !authLoading && state === 'waiting' && !attempted.current) { attempted.current = true; accept(); } }, [user, authLoading, token]);
  const redirect = `/accept-invitation?token=${encodeURIComponent(token || '')}`;
  return <AuthLayout title={state === 'done' ? 'You’re in' : 'Join your team'} description={state === 'done' ? message : 'Accept the invitation to join your team’s TeamFlow workspace.'} footer={state === 'done' ? <Link to="/dashboard">Go to your workspace</Link> : <>Already have an account? <Link to={`/login?redirect=${encodeURIComponent(redirect)}`}>Sign in to accept</Link></>}>
    {!user && !authLoading && <div className="form-stack"><p className="form-hint">Sign in with the email address that received the invitation. If you’re new to TeamFlow, <Link to={`/register?invitation=${encodeURIComponent(token || '')}`}>create an account first</Link>, then open this invitation again.</p><Link className="button button-primary" to={`/login?redirect=${encodeURIComponent(redirect)}`}>Sign in and accept</Link></div>}
    {(authLoading || state === 'accepting') && <div className="state-card"><LoaderCircle className="spin" size={18} /> Checking your invitation…</div>}
    {state === 'error' && <div className="form-stack"><p className="form-error" role="alert">{error}</p>{user && <Button onClick={accept}>Try again</Button>}</div>}
    {state === 'done' && <div className="form-success"><CheckCircle2 size={16} /> {message}</div>}
  </AuthLayout>;
}
