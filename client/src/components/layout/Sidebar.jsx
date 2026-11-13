import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Activity, Bell, CheckSquare, ChevronDown, ClipboardList, CreditCard, FolderKanban, LayoutDashboard, ListTodo, LogOut, Settings2, UserRound, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { initials } from '../../utils/format.js';

const items = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/board', label: 'Board', icon: CheckSquare },
  { to: '/tasks', label: 'My tasks', icon: ListTodo },
  { to: '/team', label: 'Team', icon: Users },
];
const manageItems = [
  { to: '/analytics', label: 'Analytics', icon: Activity },
  { to: '/audit', label: 'Audit history', icon: ClipboardList },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

export default function Sidebar({ mobileOpen, onNavigate = () => {} }) {
  const { user, organizations, activeOrganizationId, setActiveOrganizationId, membership, logout } = useAuth();
  const navigate = useNavigate();
  const activeOrganization = organizations.find((item) => item.organization?._id === activeOrganizationId)?.organization;
  const signOut = async () => { await logout(); navigate('/login', { replace: true }); };
  return (
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Link to="/dashboard" onClick={onNavigate} className="sidebar-brand"><span className="brand-symbol">T</span><span>teamflow</span></Link><button className="icon-button sidebar-close" aria-label="Close navigation" onClick={onNavigate}><X size={18} /></button></div>
      <label className="workspace-switcher"><span className="workspace-avatar">{initials(activeOrganization?.name || 'Workspace')}</span><span className="workspace-text"><strong>{activeOrganization?.name || 'Your workspace'}</strong><small>Workspace</small></span><ChevronDown size={15} /><select aria-label="Switch workspace" value={activeOrganizationId} onChange={(event) => setActiveOrganizationId(event.target.value)}><option value="">Select workspace</option>{organizations.map((item) => <option key={item.organization?._id} value={item.organization?._id}>{item.organization?.name}</option>)}</select></label>
      <nav className="side-nav" aria-label="Main navigation"><p className="nav-caption">WORKSPACE</p>{items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Icon size={18} strokeWidth={1.9} /><span>{label}</span></NavLink>)}{membership?.role !== 'MEMBER' && <><p className="nav-caption nav-caption-spaced">INSIGHTS</p>{manageItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Icon size={18} strokeWidth={1.9} /><span>{label}</span></NavLink>)}</>}</nav>
      <div className="sidebar-bottom">{membership?.role === 'ADMIN' && <NavLink to="/billing" onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><CreditCard size={18} /><span>Billing</span></NavLink>}<NavLink to="/settings" onClick={onNavigate} className="nav-link"><Settings2 size={18} /><span>Settings</span></NavLink><details className="profile-dropdown"><summary className="sidebar-user"><span className="avatar avatar-small">{initials(user?.name)}</span><span className="user-lines"><strong>{user?.name || 'Account'}</strong><small>{user?.email || ''}</small></span><ChevronDown size={15} /></summary><div className="profile-dropdown-menu"><Link to="/profile" onClick={(event) => { onNavigate(); event.currentTarget.closest('details')?.removeAttribute('open'); }}><UserRound size={15} /> Profile</Link><Link to="/settings" onClick={(event) => { onNavigate(); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Settings2 size={15} /> Settings</Link><button onClick={signOut}><LogOut size={15} /> Sign out</button></div></details></div>
    </aside>
  );
}
