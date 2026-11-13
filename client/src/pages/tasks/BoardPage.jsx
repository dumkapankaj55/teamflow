import { useEffect, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, Plus } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import Button from '../../components/common/Button.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/PageStates.jsx';
import { api } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { errorMessage, formatDate, initials, titleCase, unwrap } from '../../utils/format.js';
import { Link, useSearchParams } from 'react-router-dom';

const columns = [
  { id: 'TODO', label: 'To do', tone: 'todo' },
  { id: 'IN_PROGRESS', label: 'In progress', tone: 'progress' },
  { id: 'REVIEW', label: 'In review', tone: 'review' },
  { id: 'DONE', label: 'Done', tone: 'done' },
];

async function loadBoardTasks(projectId) {
  const params = { limit: 100, ...(projectId ? { projectId } : {}) };
  const firstResponse = await api.get('/tasks', { params: { ...params, page: 1 } });
  const firstPage = firstResponse.data?.data || {};
  const tasks = firstPage.tasks || [];
  const pageCount = firstPage.pagination?.pages || 1;
  for (let page = 2; page <= pageCount; page += 1) {
    const response = await api.get('/tasks', { params: { ...params, page } });
    tasks.push(...(response.data?.data?.tasks || []));
  }
  return tasks;
}

function BoardCard({ task, overlay = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task._id, disabled: overlay });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1 };
  return <article ref={setNodeRef} style={style} className={`board-card ${overlay ? 'board-card-overlay' : ''}`} {...attributes} {...listeners}><div className="board-card-heading"><span className={`priority-dot priority-dot-${task.priority?.toLowerCase() || 'medium'}`} /><span className={`priority-label priority-${task.priority?.toLowerCase()}`}>{titleCase(task.priority || 'MEDIUM')}</span></div><Link className="board-card-title" to={`/projects/${task.project?._id || ''}`}>{task.title}</Link><p>{task.description || 'No extra details.'}</p><div className="board-card-footer"><span className="date-cell"><CalendarDays size={13} />{formatDate(task.dueDate, { month: 'short', day: 'numeric' })}</span>{task.assignee && <span className="avatar avatar-tiny" title={task.assignee.name}>{initials(task.assignee.name)}</span>}</div></article>;
}

function BoardColumn({ column, tasks }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return <section ref={setNodeRef} className={`board-column ${isOver ? 'board-column-over' : ''}`}><div className="board-column-heading"><span className={`column-dot column-${column.tone}`} /><h2>{column.label}</h2><span className="column-count">{tasks.length}</span></div><div className="board-column-cards">{tasks.map((task) => <BoardCard key={task._id} task={task} />)}{!tasks.length && <div className="board-drop-hint">Drop tasks here</div>}</div></section>;
}

export default function BoardPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams(); const [tasks, setTasks] = useState([]); const [projects, setProjects] = useState([]); const [projectId, setProjectId] = useState(searchParams.get('projectId') || ''); const [activeTask, setActiveTask] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const load = async () => { setLoading(true); setError(''); try { const [boardTasks, projectResponse] = await Promise.all([loadBoardTasks(projectId), api.get('/projects', { params: { limit: 100 } })]); setTasks(boardTasks); setProjects(unwrap(projectResponse, 'projects') || []); } catch (requestError) { setError(errorMessage(requestError)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [projectId]);
  const endDrag = async ({ active, over }) => { setActiveTask(null); if (!over || !columns.some((column) => column.id === over.id)) return; const task = tasks.find((item) => item._id === active.id); if (!task || task.status === over.id) return; setTasks((items) => items.map((item) => item._id === task._id ? { ...item, status: over.id } : item)); try { await api.patch(`/tasks/${task._id}`, { status: over.id }); toast(`Moved to ${columns.find((column) => column.id === over.id)?.label}`); } catch (requestError) { setError(errorMessage(requestError)); await load(); } };
  return <div className="page-stack"><PageHeader eyebrow="MOVE WORK FORWARD" title="Board" description="Drag a task into its next column to update its status." actions={<label className="select-field board-filter"><span>Project</span><select aria-label="Filter board by project" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSearchParams(event.target.value ? { projectId: event.target.value } : {}, { replace: true }); }}><option value="">All projects</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}</select></label>} />{loading ? <LoadingState label="Loading board…" /> : error ? <ErrorState message={error} /> : tasks.length ? <DndContext sensors={sensors} onDragStart={({ active }) => setActiveTask(tasks.find((task) => task._id === active.id))} onDragCancel={() => setActiveTask(null)} onDragEnd={endDrag}><div className="kanban-board">{columns.map((column) => <BoardColumn key={column.id} column={column} tasks={tasks.filter((task) => (task.status || 'TODO') === column.id)} />)}</div><DragOverlay>{activeTask ? <BoardCard task={activeTask} overlay /> : null}</DragOverlay></DndContext> : <div className="panel"><EmptyState title="Your board is ready" description="Add a task to a project and it will appear here." action={<Link to="/projects" className="button button-primary"><Plus size={15} /> Browse projects</Link>} /></div>}</div>;
}
