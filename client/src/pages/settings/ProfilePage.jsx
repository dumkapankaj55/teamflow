import { useState } from 'react';
import { LogOut, Save, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';
import { errorMessage, initials } from '../../utils/format.js';

export default function ProfilePage() {
  const { user, setUser, logout } = useAuth(); const navigate = useNavigate(); const [name, setName] = useState(user?.name || ''); const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (event) => { event.preventDefault(); setBusy(true); setError(''); setNotice(''); try { const response = await api.patch('/auth/me', { name }); const updated = response.data?.data?.user; if (updated) setUser(updated); setNotice('Your profile has been updated.'); } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); } };
  const signOut = async () => { await logout(); navigate('/login', { replace: true }); };
  return <div className="page-stack"><PageHeader eyebrow="YOUR ACCOUNT" title="Profile" description="Update the details your teammates see." /><div className="settings-layout"><section className="panel profile-panel"><div className="profile-cover"><span className="profile-avatar">{initials(user?.name)}</span></div><div className="profile-summary"><div><h2>{user?.name}</h2><p>{user?.email}</p></div><span className="role-pill"><UserRound size={13} /> TeamFlow account</span></div><form className="form-stack profile-form" onSubmit={save}><label className="field-label">Full name<input value={name} onChange={(event) => setName(event.target.value)} minLength="2" maxLength="80" required /></label><label className="field-label">Email address<input value={user?.email || ''} disabled /><small className="field-help">Email changes require account verification.</small></label>{notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}<div><Button type="submit" disabled={busy || name === user?.name}><Save size={15} />{busy ? 'Saving…' : 'Save profile'}</Button></div></form></section><section className="panel security-panel"><div className="settings-section-icon"><ShieldCheck size={19} /></div><h2>Account security</h2><p>Your session is protected by a secure sign-in cookie. Password reset links are sent to your account email.</p><Button variant="secondary" onClick={() => navigate('/forgot-password')}>Reset your password</Button><div className="panel-divider" /><Button variant="danger" onClick={signOut}><LogOut size={15} /> Sign out</Button></section></div></div>;
}
