import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';

describe('TeamFlow landing page', () => {
  it('shows the product promise and working account links', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: /good work happensin sync/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /get started|start your free workspace/i }).length).toBeGreaterThan(0);
  });
});
