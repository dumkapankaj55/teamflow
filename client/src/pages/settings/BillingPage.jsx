import { useEffect, useState } from 'react';
import { ArrowUpRight, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader.jsx';
import Button from '../../components/common/Button.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/PageStates.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';
import { errorMessage, formatDate } from '../../utils/format.js';
import '../../billing-audit.css';

const prettyCount = (value) => value == null || value === Infinity ? 'Unlimited' : new Intl.NumberFormat().format(value);
const prettyBytes = (value) => value == null || value === Infinity ? 'Unlimited' : `${(value / (1024 ** 3)).toFixed(value < 1024 ** 3 ? 2 : 1)} GB`;

export default function BillingPage() {
  const { activeOrganizationId } = useAuth();
  const [searchParams] = useSearchParams();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(searchParams.get('checkout') === 'success'
    ? 'Checkout returned successfully. Your plan changes only after Stripe confirms the subscription.'
    : searchParams.get('checkout') === 'cancelled' ? 'Checkout was cancelled. Your workspace plan was not changed.' : '');
  const [salesMessage, setSalesMessage] = useState('');
  const [salesFormOpen, setSalesFormOpen] = useState(false);
  const [salesBusy, setSalesBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const response = await api.get('/billing'); setBilling(response.data?.data || null); setError(''); }
    catch (requestError) { setError(errorMessage(requestError)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [activeOrganizationId]);

  const checkout = async (plan) => {
    setBusy(plan); setError('');
    try { const response = await api.post('/billing/checkout', { plan }); window.location.assign(response.data?.data?.url); }
    catch (requestError) { setError(errorMessage(requestError)); setBusy(''); }
  };
  const openPortal = async () => {
    setBusy('portal'); setError('');
    try { const response = await api.post('/billing/portal'); window.location.assign(response.data?.data?.url); }
    catch (requestError) { setError(errorMessage(requestError)); setBusy(''); }
  };
  const cancel = async () => {
    if (!window.confirm('Cancel this subscription at the end of the current billing period?')) return;
    setBusy('cancel'); setError(''); setNotice('');
    try { await api.post('/billing/cancel'); setNotice('Cancellation is scheduled for the end of the current billing period.'); await load(); }
    catch (requestError) { setError(errorMessage(requestError)); }
    finally { setBusy(''); }
  };

  const selectFree = async () => {
    if (paid && !subscription.cancelAtPeriodEnd && !window.confirm('Switch this workspace to Free at the end of the current billing period?')) return;
    setBusy('FREE'); setError(''); setNotice('');
    try {
      const response = await api.post('/billing/free');
      const result = response.data?.data;
      setNotice(result?.cancelAtPeriodEnd
        ? 'Free is scheduled for the end of the current billing period. Paid access remains active until then.'
        : 'The Free plan is now active for this workspace.');
      await load();
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setBusy(''); }
  };

  const sendEnterpriseEnquiry = async (event) => {
    event.preventDefault();
    setSalesBusy(true); setError(''); setNotice('');
    try {
      await api.post('/billing/sales-enquiry', { message: salesMessage });
      setNotice('Your Enterprise enquiry was sent to our sales team.');
      setSalesMessage('');
      setSalesFormOpen(false);
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setSalesBusy(false); }
  };

  const currentPlan = billing?.plan;
  const limits = billing?.limits || {};
  const usage = billing?.usage || {};
  const subscription = billing?.subscription || {};
  const paid = currentPlan?.id && currentPlan.id !== 'FREE';
  return <div className="page-stack">
    <PageHeader eyebrow="WORKSPACE PLAN" title="Billing & usage" description="Manage your TeamFlow plan, seats, projects, and payment history." actions={<Button variant="secondary" onClick={load} disabled={loading}><RefreshCw size={15} />Refresh</Button>} />
    {error && <ErrorState message={error} />}{notice && <p className="form-success" role="status">{notice}</p>}
    {loading ? <LoadingState label="Loading billing details…" /> : billing && <>
      <section className="panel billing-current-panel">
        <div className="panel-heading"><div><p className="eyebrow">CURRENT PLAN</p><h2>{currentPlan?.name || 'Free'} <span className="billing-status">{subscription.status || 'free'}</span></h2><p>{subscription.currentPeriodEnd ? `${subscription.cancelAtPeriodEnd ? 'Access ends' : 'Renews on'} ${formatDate(subscription.currentPeriodEnd)}` : 'Your workspace is on the free plan.'}{subscription.cancelAtPeriodEnd ? ' · Cancellation scheduled' : ''}</p></div><CreditCard size={20} className="muted-icon" /></div>
        <div className="billing-usage-grid">
          <Usage label="Members" used={usage.members + usage.pendingInvitations} limit={limits.members} />
          <Usage label="Projects" used={usage.projects} limit={limits.projects} />
          <Usage label="Storage" unavailable />
        </div>
        {paid && <div className="billing-actions"><Button variant="secondary" onClick={openPortal} disabled={Boolean(busy)}><CreditCard size={15} />{busy === 'portal' ? 'Opening…' : 'Manage payment method'}</Button>{!subscription.cancelAtPeriodEnd && <Button variant="ghost" onClick={cancel} disabled={Boolean(busy)}>{busy === 'cancel' ? 'Scheduling…' : 'Cancel at period end'}</Button>}</div>}
      </section>
      <section className="billing-plan-grid">
        {(billing.availablePlans || []).map((plan) => {
          const isCurrent = plan.id === currentPlan?.id;
          const configured = (billing.configuredPlans || []).includes(plan.id);
          return <article className={`panel billing-plan-card ${isCurrent ? 'billing-plan-current' : ''}`} key={plan.id}>
            <p className="eyebrow">{isCurrent ? 'YOUR PLAN' : 'TEAMFLOW PLAN'}</p>
            <h2>{plan.name}</h2>
            <p>{plan.id === 'FREE' ? 'For small teams getting organized.' : plan.id === 'PRO' ? 'More room for growing teams.' : 'Flexible capacity for larger organizations.'}</p>
            <ul>
              <li>{prettyCount(plan.limits.members)} members</li>
              <li>{prettyCount(plan.limits.projects)} projects</li>
              <li><ShieldCheck size={15} /> {plan.features?.auditHistory ? 'Audit history' : 'Core collaboration'}</li>
              <li><ShieldCheck size={15} /> {plan.features?.advancedAnalytics ? 'Analytics' : 'Basic analytics'}</li>
            </ul>
            {isCurrent ? <Button variant="secondary" disabled>Current Plan</Button>
              : plan.id === 'FREE' ? <Button variant="secondary" onClick={selectFree} disabled={Boolean(busy) || Boolean(paid && subscription.cancelAtPeriodEnd)}>
                {subscription.cancelAtPeriodEnd ? 'Free Plan Scheduled' : busy === 'FREE' ? 'Updating…' : 'Select Free'}
              </Button>
                : configured ? <Button disabled={Boolean(busy)} onClick={() => checkout(plan.id)}>
                  {busy === plan.id ? 'Opening checkout…' : `Upgrade to ${plan.name}`}<ArrowUpRight size={15} />
                </Button>
                  : plan.id === 'ENTERPRISE' ? <>
                    <Button variant="secondary" onClick={() => setSalesFormOpen((open) => !open)}>Contact Sales</Button>
                    {salesFormOpen && <form className="sales-enquiry-form" onSubmit={sendEnterpriseEnquiry}>
                      <label className="field-label">Tell us about your team
                        <textarea value={salesMessage} onChange={(event) => setSalesMessage(event.target.value)} minLength="10" maxLength="2000" rows="4" required />
                      </label>
                      {!billing.salesEnquiryAvailable && <small className="field-help">Sales email is not configured. Set SALES_EMAIL, RESEND_API_KEY, and RESEND_FROM_EMAIL on the server to send enquiries.</small>}
                      <Button type="submit" disabled={salesBusy || salesMessage.trim().length < 10}>{salesBusy ? 'Sending…' : 'Send enquiry'}</Button>
                    </form>}
                  </> : <Button disabled>Configure Stripe billing</Button>}
            {plan.id === 'PRO' && !configured && <small className="field-help">Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRICE_PRO on the server to enable checkout.</small>}
            {plan.id === 'ENTERPRISE' && !configured && !salesFormOpen && <small className="field-help">No Enterprise price is configured. Contact Sales to discuss your needs.</small>}
          </article>;
        })}
      </section>
      <section className="panel billing-invoices"><div className="panel-heading"><div><h2>Billing history</h2><p>Invoices recorded from verified Stripe webhooks.</p></div><CreditCard size={18} className="muted-icon" /></div>{billing.invoices?.length ? billing.invoices.map((invoice) => {
        const invoiceAmount = invoice.status === 'payment_failed' ? invoice.amountDue : invoice.amountPaid;
        return <div className="billing-invoice-row" key={invoice.id}><span><strong>{invoice.number || invoice.id}</strong><small>{formatDate(invoice.createdAt)}</small></span><span>{invoice.status === 'payment_failed' ? 'Payment failed' : invoice.status} · {(invoiceAmount / 100).toFixed(2)} {invoice.currency?.toUpperCase()}</span>{invoice.hostedInvoiceUrl && <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">View invoice</a>}</div>;
      }) : <EmptyState title="No invoices yet" description="Completed payments will appear here after Stripe sends a verified webhook." />}</section>
    </>}
  </div>;
}

function Usage({ label, used, limit, storage = false, unavailable = false }) {
  if (unavailable) return <div className="billing-usage"><div><strong>{label}</strong><span>Not tracked yet</span></div><small>File storage tracking is not available yet.</small></div>;
  const unlimited = limit == null || limit === Infinity;
  const percentage = unlimited || !limit ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const value = storage ? `${prettyBytes(used)} used` : `${prettyCount(used)} used`;
  const maximum = storage ? prettyBytes(limit) : prettyCount(limit);
  return <div className="billing-usage"><div><strong>{label}</strong><span>{value} / {maximum}</span></div><progress value={unlimited ? 0 : percentage} max="100" aria-label={`${label} usage`} /><small>{unlimited ? 'No plan cap' : `${percentage}% of plan`}</small></div>;
}
