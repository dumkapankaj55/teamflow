import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import BoardPage from './pages/tasks/BoardPage.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { api } from './services/api.js';

function renderBoard() {
  return render(<ToastProvider><MemoryRouter><BoardPage /></MemoryRouter></ToastProvider>);
}

describe('Kanban board loading', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requests valid paginated batches and displays tasks from each page', async () => {
    const tasks = [
      { _id: 'task-1', title: 'First page task', status: 'TODO', priority: 'MEDIUM' },
      { _id: 'task-2', title: 'Second page task', status: 'IN_PROGRESS', priority: 'HIGH' },
    ];
    const get = vi.spyOn(api, 'get').mockImplementation(async (path, config) => {
      if (path === '/projects') return { data: { data: { projects: [] } } };
      if (config.params.page === 1) return { data: { data: { tasks: [tasks[0]], pagination: { pages: 2 } } } };
      return { data: { data: { tasks: [tasks[1]], pagination: { pages: 2 } } } };
    });

    renderBoard();

    expect(await screen.findByText('First page task')).toBeInTheDocument();
    expect(screen.getByText('Second page task')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/tasks', { params: { limit: 100, page: 1 } });
    expect(get).toHaveBeenCalledWith('/tasks', { params: { limit: 100, page: 2 } });
  });

  it('shows the error without presenting a false empty-board state', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/projects') return { data: { data: { projects: [] } } };
      throw { response: { data: { message: 'Request validation failed.' } } };
    });

    renderBoard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Request validation failed.');
    await waitFor(() => expect(screen.queryByText('Your board is ready')).not.toBeInTheDocument());
  });
});
