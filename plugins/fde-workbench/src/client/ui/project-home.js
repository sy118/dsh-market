/** Project workspace: home overview, tabs, status actions, and stage path. */
import { useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  SectionHead,
  TextArea,
  TextInput,
  h,
} from './common.js'
import { BodyEditor } from './body-editor.js'
import { ProjectForm } from './project-form.js'
import { StagePanel } from './stage-panel.js'
import { TasksPanel } from './tasks.js'
import { SourcesPanel } from './sources.js'
import { EditIcon, PlusIcon, TrashIcon } from './icons.js'
import {
  isDelivered,
  openBlockers,
  projectEvidence,
  projectNextAction,
  stageState,
  stageTitle,
} from '../selectors.js'

const TABS = ['overview', 'stage', 'tasks', 'research', 'docs', 'sources', 'activity']

/** Human-readable next action. */
export function nextActionText(t, action) {
  if (action === null) return ''
  if (action.code === 'completed') return t('project.next.completed')
  if (action.code === 'stopped') return t('project.next.stopped')
  if (action.code === 'resume') return t('project.next.resume')
  if (action.code === 'blocked') return t('project.next.blocked', { count: action.count })
  if (action.code === 'decide') return t('project.next.decide')
  if (action.code === 'artifact') return t('project.next.artifact', { count: action.count })
  if (action.code === 'work') return t('project.next.work', { count: action.count })
  return t('project.next.stage')
}

/** Status badge tone. */
export function projectTone(project) {
  if (isDelivered(project)) return 'ok'
  if (project.status === 'stopped') return 'bad'
  if (project.status === 'paused') return 'muted'
  return 'info'
}

/** Effective project status, treating legacy records as active. */
export function projectStatus(project) {
  return project.status ?? 'active'
}

/** Project overview tab. */
function ProjectOverview(props) {
  const { store, t, project, lang, onStage, onOpenSource } = props
  const risks = []
  for (let index = 0; index < project.stages.length; index += 1) {
    for (const blocker of project.stages[index].blockers ?? []) {
      if (!blocker.resolved) risks.push({ ...blocker, stage: index })
    }
  }
  const evidence = projectEvidence(project, 6)
  const next = projectNextAction(project)
  return h('div', { className: 'fdw-project-tab' },
    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('project.context'), hint: t('project.contextHint') }),
        h(BodyEditor, {
          store,
          t,
          path: project.file,
          label: t('project.context'),
          rows: 8,
          readOnly: project.status === 'completed' || project.status === 'stopped',
        })),
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('project.nextAction') }),
        h('p', { className: 'fdw-next-action' }, nextActionText(t, next)),
        h('dl', { className: 'fdw-facts' },
          h('div', null, h('dt', null, t('project.period')), h('dd', null,
            project.startDate === '' && project.endDate === '' ? t('common.notSet') : `${project.startDate || '—'} → ${project.endDate || '—'}`)),
          h('div', null, h('dt', null, t('project.owner')), h('dd', null, project.owner || t('common.notSet'))),
          h('div', null, h('dt', null, t('project.openBlockers')), h('dd', null, String(openBlockers(project)))),
          h('div', null, h('dt', null, t('project.statusLabel')), h('dd', null, t(`project.status.${project.status}`)))))),

    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('project.successCriteria') }),
        h('p', { className: 'fdw-prose' }, project.successCriteria || t('common.notSet')),
        h(SectionHead, { title: t('project.stakeholders') }),
        h('p', { className: 'fdw-prose' }, project.stakeholders || t('common.notSet'))),
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('project.risks'), hint: t('project.risksHint') }),
        risks.length === 0
          ? h('p', { className: 'fdw-hint' }, t('project.noRisks'))
          : h('ul', { className: 'fdw-rows' }, risks.map(risk => h('li', { key: risk.id, className: 'fdw-row' },
            h('span', { className: 'fdw-row-title' }, risk.text),
            h('span', { className: 'fdw-hint' }, `${stageTitle(lang, risk.stage)} · ${t(`severity.${risk.severity}`)}`)))))),

    h('section', { className: 'fdw-card' },
      h(SectionHead, { title: t('project.recentEvidence'), hint: t('project.recentEvidenceHint') }),
      evidence.length === 0
        ? h('p', { className: 'fdw-hint' }, t('project.noEvidence'))
        : h('ul', { className: 'fdw-rows' }, evidence.map(item => h('li', { key: `${item.kind}-${item.id}`, className: 'fdw-row' },
          h('button', {
            type: 'button',
            className: 'fdw-link-button',
            onClick: () => onStage(item.stage),
          }, item.title),
          h('span', { className: 'fdw-hint' }, `${stageTitle(lang, item.stage)} · ${t(item.kind === 'deliverable' ? `artifact.status.${item.status}` : `status.${item.status}`)}`))))),
    next?.code === 'artifact' || next?.code === 'work' || next?.code === 'decide'
      ? h('div', { className: 'fdw-inline-actions' },
        h(Button, { variant: 'primary', onClick: () => onStage(project.currentStage) }, t('project.openStage')))
      : null)
}

/** Activity tab: decisions, returns, and completed artifacts in time order. */
function ProjectActivity(props) {
  const { t, project, lang } = props
  const rows = []
  for (let index = 0; index < project.stages.length; index += 1) {
    for (const decision of project.stages[index].decisions ?? []) {
      rows.push({
        id: decision.id,
        at: decision.decidedAt ?? decision.at,
        text: `${stageTitle(lang, index)} · ${t(`stage.outcome.${decision.outcome ?? 'go'}`)}: ${decision.rationale ?? decision.decision}`,
      })
    }
    for (const deliverable of project.stages[index].deliverables ?? []) {
      if (deliverable.status !== 'present') continue
      rows.push({
        id: `d-${index}-${deliverable.id}`,
        at: deliverable.updatedAt ?? project.updatedAt,
        text: `${stageTitle(lang, index)} · ${t('activity.artifact')}: ${deliverable.title}`,
      })
    }
  }
  for (const ret of project.returns ?? []) {
    rows.push({
      id: ret.id,
      at: ret.at,
      text: `${t('activity.return')}: ${stageTitle(lang, ret.from)} → ${stageTitle(lang, ret.to)} · ${ret.reason}`,
    })
  }
  rows.sort((left, right) => String(right.at).localeCompare(String(left.at)))
  return h('div', { className: 'fdw-project-tab' },
    h(SectionHead, { title: t('project.activity'), hint: t('project.activityHint') }),
    rows.length === 0
      ? h(EmptyState, { title: t('project.noActivity') })
      : h('ul', { className: 'fdw-activity-list' }, rows.slice(0, 50).map(row => h('li', { key: row.id, className: 'fdw-activity-row' },
        h('span', { className: 'fdw-activity-date' }, String(row.at).slice(0, 10)),
        h('span', { className: 'fdw-activity-text' }, row.text)))))
}

/** Project research tab, linking to the existing research section. */
function ProjectResearch(props) {
  const { store, t, snapshot, project, lang } = props
  const items = (snapshot.state.research ?? []).filter(item => item.projectId === project.id)
  return h('div', { className: 'fdw-project-tab' },
    h(SectionHead, {
      title: t('nav.research'),
      hint: t('project.researchCount', { count: items.length }),
      action: h(Button, {
        variant: 'primary',
        size: 'sm',
        onClick: () => store.setView({ section: 'research', newResearch: { projectId: project.id, stage: project.currentStage } }),
      }, h(PlusIcon), t('research.new')),
    }),
    items.length === 0
      ? h(EmptyState, { title: t('research.empty'), body: t('research.emptyBody') })
      : h('div', { className: 'fdw-card-grid' }, items.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'fdw-record-card',
        onClick: () => store.setView({ section: 'research', researchId: item.id }),
      },
      h('div', { className: 'fdw-record-head' },
        h('span', { className: 'fdw-record-title' }, item.title),
        h(Badge, { tone: item.status === 'closed' ? 'ok' : 'muted' }, t(`research.status.${item.status}`))),
      h('p', { className: 'fdw-record-sub' }, stageTitle(lang, item.stage ?? 0))))))
}

/** Project documents tab, reusing the document section. */
function ProjectDocs(props) {
  const { store, t, snapshot, project, lang } = props
  const items = (snapshot.state.docs ?? []).filter(item => item.projectId === project.id)
  return h('div', { className: 'fdw-project-tab' },
    h(SectionHead, {
      title: t('nav.docs'),
      hint: t('project.docCount', { count: items.length }),
      action: h(Button, {
        variant: 'primary',
        size: 'sm',
        onClick: () => store.setView({ section: 'docs', newDoc: { projectId: project.id, stage: project.currentStage } }),
      }, h(PlusIcon), t('doc.new')),
    }),
    items.length === 0
      ? h(EmptyState, { title: t('doc.empty'), body: t('doc.emptyBody') })
      : h('div', { className: 'fdw-card-grid' }, items.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'fdw-record-card',
        onClick: () => store.setView({ section: 'docs', docId: item.id }),
      },
      h('div', { className: 'fdw-record-head' },
        h('span', { className: 'fdw-record-title' }, item.title),
        h(Badge, { tone: item.status === 'approved' ? 'ok' : 'muted' }, t(`doc.status.${item.status}`))),
      h('p', { className: 'fdw-record-sub' }, `${t(`doc.template.${item.template}`)}${item.stage === null ? '' : ` · ${stageTitle(lang, item.stage)}`}`)))))
}

/** One project workspace. */
export function ProjectHome(props) {
  const { store, t, snapshot, project, lang } = props
  const [formOpen, setFormOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const tab = TABS.includes(snapshot.view.tab) ? snapshot.view.tab : 'overview'
  const stageIndex = Math.min(7, Math.max(0, Number(snapshot.view.stage ?? project.currentStage)))
  const next = projectNextAction(project)
  const status = projectStatus(project)
  const back = () => store.setView({ projectId: undefined, stage: undefined, tab: undefined, taskCenter: undefined })
  const openStage = index => store.setView({ section: 'projects', projectId: project.id, tab: 'stage', stage: index })

  function setStatus(status) {
    setPauseOpen(false)
    void store.mutate({ op: 'project.status.set', projectId: project.id, status }).catch(() => {})
  }

  return h('div', { className: 'fdw-section fdw-project-view' },
    h('div', { className: 'fdw-detail-head' },
      h('div', { className: 'fdw-detail-heading' },
        h('button', { type: 'button', className: 'fdw-back', onClick: back }, `← ${t('project.center')}`),
        h('div', { className: 'fdw-title-row' },
          h('h2', { className: 'fdw-detail-title' }, project.name),
          h(Badge, { tone: projectTone(project) }, t(`project.status.${status}`))),
        h('p', { className: 'fdw-project-meta' },
          [project.customer, project.owner, project.startDate === '' ? '' : `${project.startDate} → ${project.endDate}`].filter(Boolean).join(' · ') || t('common.notSet')),
        h('p', { className: 'fdw-next-line' }, `${t('project.nextAction')}: ${nextActionText(t, next)}`)),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', onClick: () => setFormOpen(true) }, h(EditIcon), t('common.edit')),
        project.status === 'active' || project.status === 'paused' || project.status === undefined
          ? h(Button, { size: 'sm', onClick: () => setPauseOpen(true) }, t(project.status === 'paused' ? 'project.resume' : 'project.pause'))
          : null,
        h(Button, { size: 'sm', variant: 'danger', onClick: () => setDeleteOpen(true) }, h(TrashIcon), t('common.delete')))),

    h('div', { className: 'fdw-stage-path', 'aria-label': t('a11y.stagePath') },
      project.stages.map((stage, index) => h('button', {
        key: index,
        type: 'button',
        className: `fdw-stage-step fdw-stage-step--${stageState(project, index)}${index === stageIndex && tab === 'stage' ? ' fdw-stage-step--selected' : ''}`,
        onClick: () => openStage(index),
        'aria-pressed': index === stageIndex && tab === 'stage',
      },
      h('span', { className: 'fdw-stage-step-index' }, String(index + 1).padStart(2, '0')),
      h('span', { className: 'fdw-stage-step-title' }, stageTitle(lang, index))))),

    h('nav', { className: 'fdw-project-tabs', role: 'tablist', 'aria-label': t('project.tabs') },
      TABS.map(item => h('button', {
        key: item,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === item,
        className: tab === item ? 'fdw-project-tab-button fdw-project-tab-button--active' : 'fdw-project-tab-button',
        onClick: () => store.setView({ tab: item, stage: project.currentStage }),
      }, t(`project.tab.${item}`)))),

    tab === 'overview' ? h(ProjectOverview, { store, t, project, lang, onStage: openStage }) : null,
    tab === 'stage' ? h(StagePanel, {
      store,
      t,
      state: snapshot.state,
      project,
      stageIndex,
      lang,
      onStageChanged: index => openStage(index),
      onOpenResearch: id => store.setView({ section: 'research', researchId: id }),
      onOpenDoc: id => store.setView({ section: 'docs', docId: id }),
      onAddResearch: () => store.setView({ section: 'research', newResearch: { projectId: project.id, stage: stageIndex } }),
      onAddDoc: () => store.setView({ section: 'docs', newDoc: { projectId: project.id, stage: stageIndex } }),
      onOpenSource: id => store.setView({ tab: 'sources', focusSourceId: id }),
    }) : null,
    tab === 'tasks' ? h(TasksPanel, { store, t, project, lang }) : null,
    tab === 'research' ? h(ProjectResearch, { store, t, snapshot, project, lang }) : null,
    tab === 'docs' ? h(ProjectDocs, { store, t, snapshot, project, lang }) : null,
    tab === 'sources' ? h(SourcesPanel, { store, t, project, focusSourceId: snapshot.view.focusSourceId }) : null,
    tab === 'activity' ? h(ProjectActivity, { t, project, lang }) : null,

    h(ProjectForm, {
      open: formOpen,
      t,
      initial: project,
      onClose: () => setFormOpen(false),
      onSubmit: values => {
        setFormOpen(false)
        void store.mutate({ op: 'project.update', projectId: project.id, ...values }).catch(() => {})
      },
    }),
    h(ConfirmDialog, {
      open: deleteOpen,
      title: t('project.deleteTitle'),
      body: t('project.deleteBody'),
      confirmLabel: t('confirm.deleteProject'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setDeleteOpen(false),
      onConfirm: () => {
        setDeleteOpen(false)
        void store.mutate({ op: 'project.delete', projectId: project.id }).then(() => back()).catch(() => {})
      },
    }),
    h(ConfirmDialog, {
      open: pauseOpen,
      tone: project.status === 'paused' ? 'primary' : 'default',
      title: t(project.status === 'paused' ? 'project.resumeTitle' : 'project.pauseTitle'),
      body: t(project.status === 'paused' ? 'project.resumeBody' : 'project.pauseBody'),
      confirmLabel: t(project.status === 'paused' ? 'project.resume' : 'project.pause'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setPauseOpen(false),
      onConfirm: () => setStatus(project.status === 'paused' ? 'active' : 'paused'),
    }))
}
