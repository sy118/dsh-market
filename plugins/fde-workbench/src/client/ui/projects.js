/** Projects: portfolio center, filters, task center, and one project workspace. */
import { useEffect, useState } from 'react'
import { PROJECT_STATUSES } from '../../shared/constants.js'
import {
  Badge,
  Button,
  EmptyState,
  SectionHead,
  Select,
  TextInput,
  h,
} from './common.js'
import { PlusIcon } from './icons.js'
import { ProjectForm } from './project-form.js'
import { ProjectHome, nextActionText, projectTone } from './project-home.js'
import { TaskCenter } from './tasks.js'
import {
  filterProjects,
  isDelivered,
  openBlockers,
  projectNextAction,
  stageTitle,
} from '../selectors.js'

/** One project card in the portfolio. */
function ProjectCard(props) {
  const { t, project, lang, onOpen } = props
  const next = projectNextAction(project)
  const blocked = openBlockers(project)
  return h('button', { type: 'button', className: 'fdw-project-card', onClick: onOpen },
    h('div', { className: 'fdw-project-card-head' },
      h('span', { className: 'fdw-project-name' }, project.name),
      h(Badge, { tone: projectTone(project) }, t(`project.status.${project.status}`))),
    h('p', { className: 'fdw-project-meta' },
      [project.customer, project.owner].filter(Boolean).join(' · ') || t('common.notSet')),
    h('p', { className: 'fdw-project-period' },
      project.startDate === '' && project.endDate === ''
        ? t('project.periodMissing')
        : `${project.startDate || '—'} → ${project.endDate || '—'}`),
    h('div', { className: 'fdw-project-progress' },
      h('span', { className: 'fdw-hint' }, t('project.stageProgress', { current: project.currentStage + 1, total: 8 })),
      h('span', { className: blocked > 0 ? 'fdw-blocker-count fdw-blocker-count--open' : 'fdw-blocker-count' },
        `${blocked} ${t('overview.metrics.blockers')}`)),
    h('p', { className: 'fdw-project-next' }, `${t('project.nextAction')}: ${nextActionText(t, next)}`),
    h('p', { className: 'fdw-hint' }, stageTitle(lang, project.currentStage)))
}

/** Portfolio center. */
export function ProjectsSection(props) {
  const { store, t, snapshot, lang } = props
  const state = snapshot.state
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [stage, setStage] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  useEffect(() => {
    if (snapshot.view.newProject === true) {
      setFormOpen(true)
      store.setView({ newProject: undefined })
    }
  }, [snapshot.view.newProject, store])

  if (snapshot.view.projectId !== undefined) {
    const project = (state.projects ?? []).find(item => item.id === snapshot.view.projectId)
    if (project === undefined) return h(EmptyState, { title: t('project.empty'), body: t('project.emptyBody') })
    return h(ProjectHome, { store, t, snapshot, project, lang })
  }

  if (snapshot.view.taskCenter === true) {
    return h('div', { className: 'fdw-section' },
      h('button', { type: 'button', className: 'fdw-back', onClick: () => store.setView({ taskCenter: undefined }) }, `← ${t('project.center')}`),
      h(TaskCenter, { store, t, state }))
  }

  const items = filterProjects(state.projects ?? [], { query, status, stage })
  const total = (state.projects ?? []).length
  return h('div', { className: 'fdw-section' },
    h(SectionHead, {
      title: t('project.center'),
      hint: total === 0 ? t('project.centerEmptyHint') : t('project.count', { count: items.length }),
      action: h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', onClick: () => store.setView({ taskCenter: true }) }, t('task.center')),
        h(Button, { variant: 'primary', size: 'sm', onClick: () => setFormOpen(true) }, h(PlusIcon), t('project.new'))),
    }),
    total === 0
      ? h(EmptyState, {
        title: t('project.empty'),
        body: t('project.emptyBody'),
        action: h(Button, { variant: 'primary', onClick: () => setFormOpen(true) }, h(PlusIcon), t('project.new')),
      })
      : h('div', null,
        h('div', { className: 'fdw-filters fdw-filters--projects' },
          h(TextInput, { value: query, onChange: setQuery, placeholder: t('project.search'), 'aria-label': t('project.search') }),
          h(Select, {
            value: status,
            onChange: setStatus,
            'aria-label': t('project.statusLabel'),
            options: [{ value: '', label: t('common.all') }, ...PROJECT_STATUSES.map(value => ({ value, label: t(`project.status.${value}`) }))],
          }),
          h(Select, {
            value: stage,
            onChange: setStage,
            'aria-label': t('common.stage'),
            options: [{ value: '', label: t('common.all') }, ...Array.from({ length: 8 }, (_, index) => ({ value: String(index), label: stageTitle(lang, index) }))],
          })),
        items.length === 0
          ? h(EmptyState, { title: t('project.noMatches'), body: t('project.noMatchesBody') })
          : h('div', { className: 'fdw-card-grid' }, items.map(project => h(ProjectCard, {
            key: project.id,
            t,
            lang,
            project,
            onOpen: () => store.setView({ section: 'projects', projectId: project.id, tab: 'overview', stage: project.currentStage }),
          })))),
    h(ProjectForm, {
      open: formOpen,
      t,
      initial: undefined,
      onClose: () => setFormOpen(false),
      onSubmit: values => {
        setFormOpen(false)
        void store.mutate({ op: 'project.create', ...values }).then(data => {
          const id = data?.result?.projectId
          if (typeof id === 'string') store.setView({ section: 'projects', projectId: id, tab: 'overview', stage: 0 })
        }).catch(() => {})
      },
    }))
}
