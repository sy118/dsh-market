/** Research notes: list, filters, editor, and AI synthesis. */
import { useEffect, useState } from 'react'
import { RESEARCH_STATUSES, STAGE_COUNT } from '../../shared/constants.js'
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
import { BodyEditor } from './body-editor.js'
import { AiDraftPanel } from './ai-panel.js'
import { EditIcon, PlusIcon, TrashIcon } from './icons.js'
import { filterResearch, projectName, stageTitle } from '../selectors.js'

/** Create-research dialog. */
function ResearchForm(props) {
  const { open, t, state, initial, onClose, onSubmit } = props
  const [title, setTitle] = useState(initial?.title ?? '')
  const [projectId, setProjectId] = useState(initial?.projectId ?? '')
  const [stage, setStage] = useState(initial?.stage === null || initial?.stage === undefined ? '' : String(initial.stage))
  const [status, setStatus] = useState(initial?.status ?? 'open')
  const [question, setQuestion] = useState(initial?.question ?? '')
  return h(Modal, {
    open,
    title: t('research.newTitle'),
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, t('common.cancel')),
      h(Button, { key: 'save', variant: 'primary', disabled: title.trim() === '', onClick: () => onSubmit({ title: title.trim(), projectId, stage, status, question }) }, t('common.save')),
    ],
  },
  h(Field, { label: t('research.title'), required: true },
    h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('research.title') })),
  h(Field, { label: t('research.project') },
    h(Select, {
      value: projectId,
      onChange: setProjectId,
      'aria-label': t('research.project'),
      options: [{ value: '', label: t('research.none') }, ...(state.projects ?? []).map(project => ({ value: project.id, label: project.name }))],
    })),
  h(Field, { label: t('research.stage') },
    h(Select, {
      value: stage,
      onChange: setStage,
      'aria-label': t('research.stage'),
      options: [{ value: '', label: t('common.none') }, ...Array.from({ length: STAGE_COUNT }, (_, index) => ({ value: String(index), label: t('units.stage', { number: index + 1 }) }))],
    })),
  h(Field, { label: t('research.statusLabel') },
    h(Select, {
      value: status,
      onChange: setStatus,
      'aria-label': t('research.statusLabel'),
      options: RESEARCH_STATUSES.map(value => ({ value, label: t(`research.status.${value}`) })),
    })),
  h(Field, { label: t('research.question') },
    h(TextArea, { value: question, onChange: setQuestion, rows: 4, 'aria-label': t('research.question') })))
}

/** One research detail. */
function ResearchDetail(props) {
  const { store, t, snapshot, research, lang } = props
  const state = snapshot.state
  const [title, setTitle] = useState(research.title)
  const [status, setStatus] = useState(research.status)
  const [projectId, setProjectId] = useState(research.projectId ?? '')
  const [stage, setStage] = useState(research.stage === null ? '' : String(research.stage))
  const [question, setQuestion] = useState(research.question)
  const [conclusion, setConclusion] = useState(research.conclusion)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const save = () => {
    void store.mutate({
      op: 'research.update',
      researchId: research.id,
      title,
      status,
      projectId,
      stage: stage === '' ? null : Number(stage),
      question,
      conclusion,
    }).catch(() => {})
  }

  async function applyMarkdown(markdown) {
    let hash = ''
    try {
      const current = await store.loadFile(research.file, { force: true })
      hash = current.hash
    } catch (error) {
      if (error?.code !== 'file/not-found') throw error
    }
    await store.saveFile(research.file, markdown, hash)
    await store.loadFile(research.file, { force: true })
  }

  return h('div', { className: 'fdw-section' },
    h('div', { className: 'fdw-detail-head' },
      h('div', { className: 'fdw-detail-heading' },
        h('button', { type: 'button', className: 'fdw-back', onClick: () => store.setView({ researchId: undefined }) }, `← ${t('common.back')}`),
        h('h2', { className: 'fdw-detail-title' }, t('research.title')),
        h('p', { className: 'fdw-hint' }, projectName(state, research.projectId) || t('research.unlinked'))),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', onClick: save }, h(EditIcon), t('common.save')),
        h(Button, { size: 'sm', variant: 'danger', onClick: () => setDeleteOpen(true) }, h(TrashIcon), t('common.delete')))),
    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(Field, { label: t('research.title') }, h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('research.title') })),
        h(Field, { label: t('research.statusLabel') }, h(Select, {
          value: status,
          onChange: setStatus,
          'aria-label': t('research.statusLabel'),
          options: RESEARCH_STATUSES.map(value => ({ value, label: t(`research.status.${value}`) })),
        })),
        h(Field, { label: t('research.project') }, h(Select, {
          value: projectId,
          onChange: setProjectId,
          'aria-label': t('research.project'),
          options: [{ value: '', label: t('research.none') }, ...(state.projects ?? []).map(project => ({ value: project.id, label: project.name }))],
        })),
        h(Field, { label: t('research.stage') }, h(Select, {
          value: stage,
          onChange: setStage,
          'aria-label': t('research.stage'),
          options: [{ value: '', label: t('common.none') }, ...Array.from({ length: STAGE_COUNT }, (_, index) => ({ value: String(index), label: stageTitle(lang, index) }))],
        })),
        h(Field, { label: t('research.question') }, h(TextArea, { value: question, onChange: setQuestion, rows: 3, 'aria-label': t('research.question') })),
        h(Field, { label: t('research.conclusion') }, h(TextArea, { value: conclusion, onChange: setConclusion, rows: 4, 'aria-label': t('research.conclusion') }))),
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('research.body') }),
        h(AiDraftPanel, {
          store,
          t,
          task: 'research.synthesize',
          payload: { researchId: research.id },
          runLabel: t('research.generate'),
          applyLabel: t('common.apply'),
          onApply: applyMarkdown,
          disabled: snapshot.ai?.available !== true,
        }),
        h(BodyEditor, { store, t, path: research.file, label: t('research.body'), rows: 14 }))),
    h(ConfirmDialog, {
      open: deleteOpen,
      title: t('research.deleteTitle'),
      body: t('research.deleteBody'),
      confirmLabel: t('confirm.deleteResearch'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setDeleteOpen(false),
      onConfirm: () => {
        setDeleteOpen(false)
        void store.mutate({ op: 'research.delete', researchId: research.id }).then(() => store.setView({ researchId: undefined })).catch(() => {})
      },
    }))
}

/** Research list or detail. */
export function ResearchSection(props) {
  const { store, t, snapshot, lang } = props
  const state = snapshot.state
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [prefill, setPrefill] = useState(undefined)

  useEffect(() => {
    if (snapshot.view.newResearch !== undefined) {
      setPrefill(snapshot.view.newResearch)
      setFormOpen(true)
      store.setView({ newResearch: undefined })
    }
  }, [snapshot.view.newResearch])

  if (snapshot.view.researchId !== undefined) {
    const research = (state.research ?? []).find(item => item.id === snapshot.view.researchId)
    if (research === undefined) return h(EmptyState, { title: t('research.empty') })
    return h(ResearchDetail, { key: research.id, store, t, snapshot, research, lang })
  }

  const items = filterResearch(state, { projectId: projectFilter, status: statusFilter })
  return h('div', { className: 'fdw-section' },
    h(SectionHead, {
      title: t('research.list'),
      hint: t('research.count', { count: items.length }),
      action: h(Button, { variant: 'primary', size: 'sm', onClick: () => { setPrefill(undefined); setFormOpen(true) } }, h(PlusIcon), t('research.new')),
    }),
    h('div', { className: 'fdw-filters' },
      h(Select, {
        value: projectFilter,
        onChange: setProjectFilter,
        'aria-label': t('research.filterProject'),
        options: [{ value: '', label: t('common.all') }, ...(state.projects ?? []).map(project => ({ value: project.id, label: project.name }))],
      }),
      h(Select, {
        value: statusFilter,
        onChange: setStatusFilter,
        'aria-label': t('research.filterStatus'),
        options: [{ value: '', label: t('common.all') }, ...RESEARCH_STATUSES.map(value => ({ value, label: t(`research.status.${value}`) }))],
      })),
    items.length === 0
      ? h(EmptyState, {
        title: t('research.empty'),
        body: t('research.emptyBody'),
        action: h(Button, { variant: 'primary', onClick: () => setFormOpen(true) }, h(PlusIcon), t('research.new')),
      })
      : h('div', { className: 'fdw-card-grid' }, items.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'fdw-record-card',
        onClick: () => store.setView({ section: 'research', researchId: item.id }),
      },
      h('div', { className: 'fdw-record-head' },
        h('span', { className: 'fdw-record-title' }, item.title),
        h(Badge, { tone: item.status === 'closed' ? 'ok' : item.status === 'finding' ? 'info' : 'muted' }, t(`research.status.${item.status}`))),
      h('p', { className: 'fdw-record-sub' }, projectName(state, item.projectId) || t('research.unlinked')),
      h('p', { className: 'fdw-record-sub' }, item.question || t('common.empty'))))),
    h(ResearchForm, {
      open: formOpen,
      t,
      state,
      initial: prefill,
      onClose: () => setFormOpen(false),
      onSubmit: values => {
        setFormOpen(false)
        void store.mutate({
          op: 'research.create',
          title: values.title,
          projectId: values.projectId,
          stage: values.stage === '' ? null : Number(values.stage),
          status: values.status,
          question: values.question,
        }).then(data => {
          if (typeof data?.result?.researchId === 'string') store.setView({ section: 'research', researchId: data.result.researchId })
        }).catch(() => {})
      },
    }))
}
