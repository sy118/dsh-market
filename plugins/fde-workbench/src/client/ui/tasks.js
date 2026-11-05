/** Project tasks: list, board, dependency-aware editor, and a read-only gantt. */
import { useState } from 'react'
import { TASK_PRIORITIES, TASK_STATUSES } from '../../shared/constants.js'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  Select,
  TextArea,
  TextInput,
  h,
} from './common.js'
import { PlusIcon, TrashIcon } from './icons.js'
import { ganttRange, ganttRow, taskCenter } from '../selectors.js'
import { errorText } from './error-text.js'

/** One task status badge. */
function taskTone(status) {
  if (status === 'done') return 'ok'
  if (status === 'blocked') return 'bad'
  if (status === 'in_progress') return 'info'
  return 'muted'
}

/** Create/edit dialog for one task. */
function TaskForm(props) {
  const { open, t, project, initial, onClose, onSubmit } = props
  const [title, setTitle] = useState(initial?.title ?? '')
  const [status, setStatus] = useState(initial?.status ?? 'todo')
  const [priority, setPriority] = useState(initial?.priority ?? 'medium')
  const [owner, setOwner] = useState(initial?.owner ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [progress, setProgress] = useState(initial?.progress ?? 0)
  const [blockedReason, setBlockedReason] = useState(initial?.blockedReason ?? '')
  const [dependencies, setDependencies] = useState(initial?.dependencyIds ?? [])
  const [error, setError] = useState('')

  const others = (project.tasks ?? []).filter(task => task.id !== initial?.id)

  function toggleDependency(id) {
    setDependencies(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]))
  }

  function submit() {
    if (title.trim() === '') return
    if (status === 'blocked' && blockedReason.trim() === '') {
      setError(t('task.blockedRequired'))
      return
    }
    setError('')
    Promise.resolve(onSubmit({
      title: title.trim(),
      status,
      priority,
      owner,
      startDate,
      dueDate,
      progress,
      blockedReason,
      dependencyIds: dependencies,
    })).catch(value => {
      const code = value?.code
      setError(code === 'task/dependency-cycle'
        ? t('task.cycleError')
        : code === 'task/dependency-open'
          ? t('task.depOpenError')
          : errorText(t, code))
    })
  }

  return h(Modal, {
    open,
    title: initial === undefined ? t('task.newTitle') : t('task.editTitle'),
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, t('common.cancel')),
      h(Button, { key: 'save', variant: 'primary', disabled: title.trim() === '', onClick: submit }, t('common.save')),
    ],
  },
  h(Field, { label: t('task.title'), required: true },
    h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('task.title') })),
  h(Field, { label: t('task.status') },
    h(Select, {
      value: status,
      onChange: setStatus,
      'aria-label': t('task.status'),
      options: TASK_STATUSES.map(value => ({ value, label: t(`task.status.${value}`) })),
    })),
  h(Field, { label: t('task.priority') },
    h(Select, {
      value: priority,
      onChange: setPriority,
      'aria-label': t('task.priority'),
      options: TASK_PRIORITIES.map(value => ({ value, label: t(`task.priority.${value}`) })),
    })),
  h(Field, { label: t('task.owner') },
    h(TextInput, { value: owner, onChange: setOwner, 'aria-label': t('task.owner') })),
  h('div', { className: 'fdw-columns' },
    h(Field, { label: t('task.startDate') },
      h(TextInput, { type: 'date', value: startDate, onChange: setStartDate, 'aria-label': t('task.startDate') })),
    h(Field, { label: t('task.dueDate') },
      h(TextInput, { type: 'date', value: dueDate, onChange: setDueDate, 'aria-label': t('task.dueDate') }))),
  h(Field, { label: t('task.progress') },
    h(TextInput, { type: 'number', value: String(progress), onChange: value => setProgress(Number(value)), 'aria-label': t('task.progress') })),
  status === 'blocked'
    ? h(Field, { label: t('task.blockedReason'), required: true },
      h(TextArea, { value: blockedReason, onChange: setBlockedReason, rows: 2, 'aria-label': t('task.blockedReason') }))
    : null,
  h(Field, { label: t('task.dependencies'), hint: t('task.dependenciesHint') },
    others.length === 0
      ? h('p', { className: 'fdw-hint' }, t('task.noDependencies'))
      : h('div', { className: 'fdw-check-list' }, others.map(task => h('label', { key: task.id, className: 'fdw-check-row' },
        h('input', {
          type: 'checkbox',
          checked: dependencies.includes(task.id),
          onChange: () => toggleDependency(task.id),
        }),
        h('span', { className: 'fdw-check-text' }, task.title))))),
  error === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, error))
}

/** Read-only gantt for one project. */
function Gantt(props) {
  const { t, project } = props
  const range = ganttRange(project)
  const rows = (project.tasks ?? []).map(task => ({ task, bar: range === null ? null : ganttRow(task, range) })).filter(row => row.bar !== null)
  return h('section', { className: 'fdw-card' },
    h(SectionHead, { title: t('task.gantt'), hint: t('task.ganttHint') }),
    rows.length === 0
      ? h('p', { className: 'fdw-hint' }, t('task.ganttEmpty'))
      : h('div', { className: 'fdw-gantt', role: 'img', 'aria-label': t('task.gantt') },
        rows.map(row => h('div', { key: row.task.id, className: 'fdw-gantt-row' },
          h('span', { className: 'fdw-gantt-label' }, row.task.title),
          h('div', { className: 'fdw-gantt-track' },
            h('span', {
              className: `fdw-gantt-bar fdw-gantt-bar--${row.task.status}`,
              style: { left: `${row.bar.left}%`, width: `${row.bar.width}%` },
            }, row.task.progress > 0 ? `${row.task.progress}%` : '')),
          h('span', { className: 'fdw-gantt-deps' }, row.bar.dependencyIds.length === 0 ? '' : `↳ ${row.bar.dependencyIds.length}`)))))
}

/** Project task tab. */
export function TasksPanel(props) {
  const { store, t, project, lang } = props
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(undefined)
  const [deleting, setDeleting] = useState(null)
  const [filter, setFilter] = useState('')
  const tasks = (project.tasks ?? []).filter(task => filter === '' || task.status === filter)

  function save(values) {
    const mutation = editing === undefined
      ? { op: 'task.create', projectId: project.id, ...values }
      : { op: 'task.update', projectId: project.id, taskId: editing.id, ...values }
    return store.mutate(mutation).then(() => {
      setFormOpen(false)
      setEditing(undefined)
    })
  }

  return h('div', { className: 'fdw-project-tab' },
    h(SectionHead, {
      title: t('task.title'),
      hint: t('task.count', { count: project.tasks?.length ?? 0 }),
      action: h(Button, { variant: 'primary', size: 'sm', onClick: () => { setEditing(undefined); setFormOpen(true) } }, h(PlusIcon), t('task.new')),
    }),
    h('div', { className: 'fdw-filters' },
      h(Select, {
        value: filter,
        onChange: setFilter,
        'aria-label': t('task.status'),
        options: [{ value: '', label: t('common.all') }, ...TASK_STATUSES.map(value => ({ value, label: t(`task.status.${value}`) }))],
      })),
    tasks.length === 0
      ? h(EmptyState, { title: t('task.empty'), body: t('task.emptyBody') })
      : h('div', { className: 'fdw-task-list' }, tasks.map(task => h('article', { key: task.id, className: `fdw-task-card fdw-task-card--${task.status}` },
        h('div', { className: 'fdw-task-card-head' },
          h('h4', null, task.title),
          h(Badge, { tone: taskTone(task.status) }, t(`task.status.${task.status}`))),
        h('p', { className: 'fdw-task-meta' },
          [task.owner || t('task.unassigned'), task.startDate, task.dueDate].filter(Boolean).join(' · ')),
        task.blockedReason === '' ? null : h('p', { className: 'fdw-hint' }, task.blockedReason),
        h('div', { className: 'fdw-task-actions' },
          h(Select, {
            value: task.status,
            onChange: value => void store.mutate({ op: 'task.update', projectId: project.id, taskId: task.id, status: value }).catch(() => {}),
            'aria-label': `${task.title}: ${t('task.status')}`,
            options: TASK_STATUSES.map(value => ({ value, label: t(`task.status.${value}`) })),
          }),
          h(Button, { size: 'sm', onClick: () => { setEditing(task); setFormOpen(true) } }, t('common.edit')),
          h(Button, { size: 'sm', variant: 'danger', onClick: () => setDeleting(task) }, h(TrashIcon), t('common.delete')))))),
    h(Gantt, { t, project, lang }),
    h(TaskForm, {
      open: formOpen,
      t,
      project,
      initial: editing,
      onClose: () => { setFormOpen(false); setEditing(undefined) },
      onSubmit: save,
    }),
    h(ConfirmDialog, {
      open: deleting !== null,
      title: t('task.deleteTitle'),
      body: t('task.deleteBody', { title: deleting?.title ?? '' }),
      confirmLabel: t('task.delete'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setDeleting(null),
      onConfirm: () => {
        const task = deleting
        setDeleting(null)
        if (task !== null) void store.mutate({ op: 'task.delete', projectId: project.id, taskId: task.id }).catch(() => {})
      },
    }))
}

/** Cross-project task center, used from the project center. */
export function TaskCenter(props) {
  const { store, t, state } = props
  const rows = taskCenter(state)
  return h('div', { className: 'fdw-project-tab' },
    h(SectionHead, { title: t('task.center'), hint: t('task.centerHint') }),
    rows.length === 0
      ? h(EmptyState, { title: t('task.centerEmpty'), body: t('task.centerEmptyBody') })
      : h('div', { className: 'fdw-table-wrap' },
        h('table', { className: 'fdw-table' },
          h('thead', null, h('tr', null,
            h('th', null, t('task.title')),
            h('th', null, t('common.project')),
            h('th', null, t('task.owner')),
            h('th', null, t('task.dueDate')),
            h('th', null, t('task.status')))),
          h('tbody', null, rows.map(task => h('tr', { key: task.id },
            h('td', null, task.title),
            h('td', null, h('button', {
              type: 'button',
              className: 'fdw-link-button',
              onClick: () => store.setView({ section: 'projects', projectId: task.projectId, tab: 'tasks' }),
            }, task.projectName)),
            h('td', null, task.owner || t('task.unassigned')),
            h('td', null, task.dueDate || t('common.notSet')),
            h('td', null, h(Badge, { tone: taskTone(task.status) }, t(`task.status.${task.status}`)))))))))
}
