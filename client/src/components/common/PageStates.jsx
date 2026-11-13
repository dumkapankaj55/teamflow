import { Inbox, LoaderCircle, TriangleAlert } from 'lucide-react';

export function LoadingState({ label = 'Loading…' }) {
  return <div className="state-card" role="status"><LoaderCircle className="spin" size={20} /> <span>{label}</span></div>;
}

export function ErrorState({ message = 'We couldn’t load this information.' }) {
  return <div className="state-card state-error" role="alert"><TriangleAlert size={20} /><span>{message}</span></div>;
}

export function EmptyState({ title = 'Nothing here yet', description = 'When there is something to show, it will appear here.', action }) {
  return <div className="empty-state"><div className="empty-icon"><Inbox size={22} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
