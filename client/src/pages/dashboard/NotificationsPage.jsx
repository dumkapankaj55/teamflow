import { useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, MessageSquare, UserPlus, CircleCheck, CalendarClock, AtSign } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader.jsx';
import Button from '../../components/common/Button.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/PageStates.jsx';
import { api } from '../../services/api.js';
import { errorMessage, formatDate, unwrap } from '../../utils/format.js';

const icons = { TASK_ASSIGNED: UserPlus, DEADLINE_CHANGED: CalendarClock, COMMENT_ADDED: MessageSquare, INVITATION_RECEIVED: Bell, TASK_COMPLETED: CircleCheck, MENTIONED: AtSign };

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = async () => { setLoading(true); try { const response = await api.get('/notifications', { params: { limit: 100 } }); setNotifications(unwrap(response, 'notifications') || []); setError(''); } catch (requestError) { setError(errorMessage(requestError)); } finally { setLoading(false); } };
  useEffect(() => {
    load();
    const onNotification = (event) => {
      const notification = event.detail;
      if (!notification?._id) return;
      setNotifications((items) => items.some((item) => item._id === notification._id) ? items : [notification, ...items].slice(0, 100));
    };
    window.addEventListener('teamflow:notification', onNotification);
    return () => window.removeEventListener('teamflow:notification', onNotification);
  }, []);
  const markRead = async (notification) => { if (notification.readAt || notification.isRead) return; setNotifications((items) => items.map((item) => item._id === notification._id ? { ...item, isRead: true } : item)); try { await api.patch(`/notifications/${notification._id}/read`); } catch (requestError) { setError(errorMessage(requestError)); await load(); } };
  const markAllRead = async () => { const previous = notifications; setNotifications((items) => items.map((item) => ({ ...item, isRead: true, readAt: item.readAt || new Date().toISOString() }))); try { await api.patch('/notifications/read-all'); } catch (requestError) { setNotifications(previous); setError(errorMessage(requestError)); } };
  const unread = notifications.filter((item) => !(item.readAt || item.isRead)).length;
  return <div className="page-stack"><PageHeader eyebrow="STAY IN THE LOOP" title="Notifications" description="A thoughtful stream of the updates that need your attention." actions={<><Button variant="secondary" onClick={load}><Bell size={15} /> Refresh</Button><Button variant="ghost" onClick={markAllRead} disabled={!unread}><CheckCheck size={16} /> Mark all read</Button></>} />{error && <ErrorState message={error} />}{loading ? <LoadingState label="Loading notifications…" /> : notifications.length ? <section className="panel notifications-panel"><div className="notification-summary">{unread ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'You’re all caught up'}</div><div className="notification-list">{notifications.map((notification) => { const Icon = icons[notification.type] || Bell; const read = notification.readAt || notification.isRead; const link = notification.task?._id ? `/tasks?taskId=${notification.task._id}` : notification.project?._id ? `/projects/${notification.project._id}` : null; return <article className={`notification-row ${read ? '' : 'notification-unread'}`} key={notification._id} onClick={() => markRead(notification)}><span className="notification-icon"><Icon size={17} /></span><div className="notification-content"><p><strong>{notification.title || notification.type?.toLowerCase().replaceAll('_', ' ')}</strong></p><span>{notification.message}</span><time>{formatDate(notification.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>{link && <Link to={link} onClick={(event) => event.stopPropagation()}>Open update</Link>}</div>{!read && <span className="unread-dot" aria-label="Unread" />}</article>; })}</div></section> : <div className="panel"><EmptyState title="No notifications yet" description="When your team assigns work, comments, or invites you, you’ll see it here." action={<Button variant="secondary" onClick={load}><Check size={15} /> Refresh</Button>} /></div>}</div>;
}
