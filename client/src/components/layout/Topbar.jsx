import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Menu, Search } from 'lucide-react';

export default function Topbar({ onMenu }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const onSearch = (event) => {
    event.preventDefault();
    if (query.trim()) navigate(`/tasks?q=${encodeURIComponent(query.trim())}`);
  };
  return <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={onMenu}><Menu size={20} /></button><form className="global-search" role="search" onSubmit={onSearch}><Search size={17} /><input aria-label="Search tasks" placeholder="Search tasks…" value={query} onChange={(event) => setQuery(event.target.value)} /></form><div className="topbar-actions"><button className="icon-button top-notification" aria-label="View notifications" onClick={() => navigate('/notifications')}><Bell size={19} /></button><span className="topbar-divider" /><button className="help-button" onClick={() => navigate('/settings')}>Help & feedback</button></div></header>;
}
