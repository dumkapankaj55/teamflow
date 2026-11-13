import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import BillingPage from './pages/settings/BillingPage.jsx';
import { api } from './services/api.js';

vi.mock('./context/AuthContext.jsx', () => ({ useAuth: () => ({ activeOrganizationId: 'org-1' }) }));

const availablePlans = [
  { id: 'FREE', name: 'Free', limits: { members: 5, projects: 3 }, features: { auditHistory: true, advancedAnalytics: true } },
  { id: 'PRO', name: 'Pro', limits: { members: 25, projects: 50 }, features: { auditHistory: true, advancedAnalytics: true } },
  { id: 'ENTERPRISE', name: 'Enterprise', limits: { members: Infinity, projects: Infinity }, features: { auditHistory: true, advancedAnalytics: true } },
];

function billingSummary(planId = 'FREE') {
  const plan = availablePlans.find(({ id }) => id === planId);
  return {
    plan,
    subscription: { plan: planId, status: planId === 'FREE' ? 'free' : 'active', currentPeriodEnd: planId === 'FREE' ? null : '2027-01-01T00:00:00.000Z', cancelAtPeriodEnd: false },
    limits: plan.limits,
    usage: { members: 1, pendingInvitations: 0, projects: 0 },
    availablePlans,
    configuredPlans: [],
    checkoutAvailable: false,
    salesEnquiryAvailable: false,
    invoices: [],
  };
}

function renderBillingPage() {
  return render(<MemoryRouter><BillingPage /></MemoryRouter>);
}

describe('Billing & usage plan actions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows Free as the current plan and provides a working Enterprise contact form', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ data: { data: billingSummary() } });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { sent: true } } });
    renderBillingPage();

    expect(await screen.findByRole('button', { name: 'Current Plan' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Contact Sales' }));
    await user.type(screen.getByLabelText(/tell us about your team/i), 'We need centralized workspace administration.');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/billing/sales-enquiry', { message: 'We need centralized workspace administration.' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your Enterprise enquiry was sent to our sales team.');
  });

  it('confirms and schedules a Pro-to-Free downgrade at period end', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(api, 'get').mockResolvedValue({ data: { data: billingSummary('PRO') } });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { plan: 'PRO', cancelAtPeriodEnd: true } } });
    renderBillingPage();

    await user.click(await screen.findByRole('button', { name: 'Select Free' }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/billing/free'));
    expect(await screen.findByRole('status')).toHaveTextContent(/Free is scheduled for the end of the current billing period/i);
  });
});
