import { useEffect, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import Button from '../../components/common/Button.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/PageStates.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';
import { errorMessage, formatDate, unwrap } from '../../utils/format.js';
import '../../billing-audit.css';

export default function AuditHistoryPage() {
  const { activeOrganizationId } = useAuth();
  const [filters, setFilters] = useState({ action: '', targetType: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { page, limit: 25, ...(applied.action ? { action: applied.action } : {}), ...(applied.targetType ? { targetType: applied.targetType } : {}), ...(applied.from ? { from: new Date(applied.from).toISOString() } : {}), ...(applied.to ? { to: new Date(`${applied.to}T23:59:59.999`).toISOString() } : {}) };
    api.get(`/organizations/${activeOrganizationId}/audit-logs`, { params })
      .then((response) => {
        if (!active) return;
        const data = unwrap(response, 'auditLogs') || [];
        setLogs(data);
        setPagination(response.data?.data?.pagination || { page, pages: 1, total: data.length });
        setError('');
      })
      .catch((requestError) => { if (active) setError(errorMessage(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeOrganizationId, applied, page]);

  const applyFilters = (event) => { event.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const clearFilters = () => { const empty = { action: '', targetType: '', from: '', to: '' }; setFilters(empty); setApplied(empty); setPage(1); };

  return <div className="page-stack">
    <PageHeader eyebrow="WORKSPACE SECURITY" title="Audit history" description="Review sign-ins, access changes, and work updates across this workspace." />
    <section className="panel">
      <form className="audit-filters" onSubmit={applyFilters}>
        <label className="field-label">Action<input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} placeholder="For example, TASK_UPDATED" maxLength="80" /></label>
        <label className="field-label">Resource<select value={filters.targetType} onChange={(event) => setFilters({ ...filters, targetType: event.target.value })}><option value="">All resources</option><option value="ORGANIZATION">Workspace</option><option value="PROJECT">Project</option><option value="TASK">Task</option><option value="COMMENT">Comment</option><option value="MEMBERSHIP">Member</option></select></label>
        <label className="field-label">From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label className="field-label">Through<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <div className="audit-filter-actions"><Button type="submit"><Search size={15} />Apply</Button><Button type="button" variant="ghost" onClick={clearFilters}>Clear</Button></div>
      </form>
    </section>
    {error && <ErrorState message={error} />}
    {loading ? <LoadingState label="Loading audit history…" /> : logs.length ? <section className="panel audit-list-panel">
      <div className="panel-heading"><div><h2>Workspace events</h2><p>{pagination.total} recorded event{pagination.total === 1 ? '' : 's'}</p></div><ClipboardList size={18} className="muted-icon" /></div>
      <div className="activity-list">{logs.map((entry) => <article className="activity-row" key={entry._id}><span className="avatar avatar-small">{(entry.actor?.name || '?').slice(0, 1).toUpperCase()}</span><div className="activity-copy"><p><strong>{entry.actor?.name || 'Former member'}</strong> {entry.message}</p><span>{entry.action.replaceAll('_', ' ')} · {entry.targetType.toLowerCase()}</span><time>{formatDate(entry.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div></article>)}</div>
      {pagination.pages > 1 && <div className="audit-pagination"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pagination.pages}</span><Button variant="secondary" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div>}
    </section> : <div className="panel"><EmptyState title="No audit events match" description="Workspace access and project changes will appear here as they happen." /></div>}
  </div>;
}
