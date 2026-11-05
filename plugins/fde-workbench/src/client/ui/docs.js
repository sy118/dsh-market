/** Delivery documents: templates, version chain, statuses, restore, and AI drafting. */
import { useEffect, useState } from 'react'
import { DOC_STATUSES, DOC_TEMPLATES, STAGE_COUNT } from '../../shared/constants.js'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  Select,
  TextInput,
  h,
} from './common.js'
import { BodyEditor } from './body-editor.js'
import { AiDraftPanel } from './ai-panel.js'
import { EditIcon, PlusIcon, TrashIcon } from './icons.js'
import { filterDocs, projectName, stageTitle } from '../selectors.js'
import { errorText } from './error-text.js'

/** Create-document dialog. */
function DocForm(props) {
  const { open, t, state, initial, onClose, onSubmit, lang } = props
  const [title, setTitle] = useState(initial?.title ?? '')
  const [template, setTemplate] = useState(initial?.template ?? 'delivery')
  const [projectId, setProjectId] = useState(initial?.projectId ?? '')
  const [stage, setStage] = useState(initial?.stage === null || initial?.stage === undefined ? '' : String(initial.stage))
  return h(Modal, {
    open,
    title: t('doc.newTitle'),
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, t('common.cancel')),
      h(Button, { key: 'save', variant: 'primary', disabled: title.trim() === '', onClick: () => onSubmit({ title: title.trim(), template, projectId, stage }) }, t('common.save')),
    ],
  },
  h(Field, { label: t('doc.title'), required: true },
    h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('doc.title') })),
  h(Field, { label: t('doc.template'), hint: t('doc.templateHint') },
    h(Select, {
      value: template,
      onChange: setTemplate,
      'aria-label': t('doc.template'),
      options: DOC_TEMPLATES.map(value => ({ value, label: t(`doc.template.${value}`) })),
    })),
  h(Field, { label: t('common.project') },
    h(Select, {
      value: projectId,
      onChange: setProjectId,
      'aria-label': t('common.project'),
      options: [{ value: '', label: t('research.none') }, ...(state.projects ?? []).map(project => ({ value: project.id, label: project.name }))],
    })),
  h(Field, { label: t('common.stage') },
    h(Select, {
      value: stage,
      onChange: setStage,
      'aria-label': t('common.stage'),
      options: [{ value: '', label: t('common.none') }, ...Array.from({ length: STAGE_COUNT }, (_, index) => ({ value: String(index), label: stageTitle(lang, index) }))],
    })))
}

/** One document detail with its immutable version chain. */
function DocDetail(props) {
  const { store, t, snapshot, doc, lang } = props
  const state = snapshot.state
  const [title, setTitle] = useState(doc.title)
  const [template, setTemplate] = useState(doc.template)
  const [status, setStatus] = useState(doc.status)
  const [projectId, setProjectId] = useState(doc.projectId ?? '')
  const [stage, setStage] = useState(doc.stage === null ? '' : String(doc.stage))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const archived = doc.status === 'archived'
  const versions = Array.isArray(doc.versions) ? doc.versions : []

  const save = () => {
    void store.mutate({
      op: 'doc.update',
      docId: doc.id,
      title,
      template,
      status,
      projectId,
      stage: stage === '' ? null : Number(stage),
    }).catch(value => setError(value?.code ?? 'error.generic'))
  }

  async function applyMarkdown(markdown) {
    try {
      await store.saveDoc(doc.id, markdown)
    } catch (value) {
      setError(value?.code ?? 'error.generic')
    }
  }

  async function restore(version) {
    try {
      await store.restoreDoc(doc.id, version)
    } catch (value) {
      setError(value?.code ?? 'error.generic')
    }
  }

  return h('div', { className: 'fdw-section' },
    h('div', { className: 'fdw-detail-head' },
      h('div', { className: 'fdw-detail-heading' },
        h('button', { type: 'button', className: 'fdw-back', onClick: () => store.setView({ docId: undefined }) }, `← ${t('common.back')}`),
        h('div', { className: 'fdw-title-row' },
          h('h2', { className: 'fdw-detail-title' }, doc.title),
          h(Badge, { tone: doc.status === 'approved' ? 'ok' : 'muted' }, t(`doc.status.${doc.status}`))),
        h('p', { className: 'fdw-hint' }, `${projectName(state, doc.projectId) || t('research.unlinked')} · v${doc.currentVersion}`)),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', onClick: save, disabled: archived }, h(EditIcon), t('common.save')),
        h(Button, { size: 'sm', variant: 'danger', onClick: () => setDeleteOpen(true) }, h(TrashIcon), t('common.delete')))),
    error === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, error === 'doc/referenced' ? t('doc.referenced') : errorText(t, error)),
    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(Field, { label: t('doc.title') }, h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('doc.title'), disabled: archived })),
        h(Field, { label: t('doc.template') }, h(Select, {
          value: template,
          onChange: setTemplate,
          'aria-label': t('doc.template'),
          disabled: archived,
          options: DOC_TEMPLATES.map(value => ({ value, label: t(`doc.template.${value}`) })),
        })),
        h(Field, { label: t('doc.statusLabel') }, h(Select, {
          value: status,
          onChange: setStatus,
          'aria-label': t('doc.statusLabel'),
          disabled: archived,
          options: DOC_STATUSES.map(value => ({ value, label: t(`doc.status.${value}`) })),
        })),
        h(Field, { label: t('common.project') }, h(Select, {
          value: projectId,
          onChange: setProjectId,
          'aria-label': t('common.project'),
          disabled: archived,
          options: [{ value: '', label: t('research.none') }, ...(state.projects ?? []).map(project => ({ value: project.id, label: project.name }))],
        })),
        h(Field, { label: t('common.stage') }, h(Select, {
          value: stage,
          onChange: setStage,
          'aria-label': t('common.stage'),
          disabled: archived,
          options: [{ value: '', label: t('common.none') }, ...Array.from({ length: STAGE_COUNT }, (_, index) => ({ value: String(index), label: stageTitle(lang, index) }))],
        })),
        archived ? h('p', { className: 'fdw-hint' }, t('doc.archivedHint')) : null),
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('doc.body'), hint: `${t('doc.currentVersion')} v${doc.currentVersion}` }),
        h(AiDraftPanel, {
          store,
          t,
          task: 'doc.draft',
          payload: { docId: doc.id, projectId: doc.projectId, stage: doc.stage, title: doc.title, template: doc.template },
          runLabel: t('doc.draft'),
          applyLabel: t('common.apply'),
          onApply: applyMarkdown,
          disabled: snapshot.ai?.available !== true || archived,
        }),
        h(BodyEditor, {
          key: doc.file,
          store,
          t,
          path: doc.file,
          label: t('doc.body'),
          rows: 16,
          readOnly: archived,
          onSave: content => store.saveDoc(doc.id, content),
        }))),
    h('section', { className: 'fdw-card' },
      h(SectionHead, { title: t('doc.versions'), hint: t('doc.versionsHint') }),
      h('ul', { className: 'fdw-version-list' }, [...versions].reverse().map(version => h('li', {
        key: version.version,
        className: version.version === doc.currentVersion ? 'fdw-version-row fdw-version-row--current' : 'fdw-version-row',
      },
      h('span', { className: 'fdw-version-number' }, `v${version.version}`),
      h('span', { className: 'fdw-hint' }, `${version.createdAt.slice(0, 10)} · ${t(`doc.versionSource.${version.source}`)}`),
      version.version === doc.currentVersion ? h(Badge, { tone: 'info' }, t('doc.current')) : null,
      version.version === doc.currentVersion || archived
        ? null
        : h(Button, { size: 'sm', onClick: () => void restore(version.version) }, t('doc.restore')))))),
    h(ConfirmDialog, {
      open: deleteOpen,
      title: t('doc.deleteTitle'),
      body: t('doc.deleteBody'),
      confirmLabel: t('confirm.deleteDoc'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setDeleteOpen(false),
      onConfirm: () => {
        setDeleteOpen(false)
        void store.mutate({ op: 'doc.delete', docId: doc.id }).then(() => store.setView({ docId: undefined })).catch(value => {
          setError(value?.code === 'doc/referenced' ? 'doc.referenced' : (value?.code ?? 'error.generic'))
        })
      },
    }))
}

/** Documents list or detail. */
export function DocsSection(props) {
  const { store, t, snapshot, lang } = props
  const state = snapshot.state
  const [statusFilter, setStatusFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [prefill, setPrefill] = useState(undefined)

  useEffect(() => {
    if (snapshot.view.newDoc !== undefined) {
      setPrefill(snapshot.view.newDoc)
      setFormOpen(true)
      store.setView({ newDoc: undefined })
    }
  }, [snapshot.view.newDoc, store])

  if (snapshot.view.docId !== undefined) {
    const doc = (state.docs ?? []).find(item => item.id === snapshot.view.docId)
    if (doc === undefined) return h(EmptyState, { title: t('doc.empty') })
    return h(DocDetail, { key: doc.id, store, t, snapshot, doc, lang })
  }

  const items = filterDocs(state, { status: statusFilter })
  return h('div', { className: 'fdw-section' },
    h(SectionHead, {
      title: t('doc.list'),
      hint: t('doc.count', { count: items.length }),
      action: h(Button, { variant: 'primary', size: 'sm', onClick: () => { setPrefill(undefined); setFormOpen(true) } }, h(PlusIcon), t('doc.new')),
    }),
    h('div', { className: 'fdw-filters' },
      h(Select, {
        value: statusFilter,
        onChange: setStatusFilter,
        'aria-label': t('doc.statusLabel'),
        options: [{ value: '', label: t('common.all') }, ...DOC_STATUSES.map(value => ({ value, label: t(`doc.status.${value}`) }))],
      })),
    items.length === 0
      ? h(EmptyState, {
        title: t('doc.empty'),
        body: t('doc.emptyBody'),
        action: h(Button, { variant: 'primary', onClick: () => setFormOpen(true) }, h(PlusIcon), t('doc.new')),
      })
      : h('div', { className: 'fdw-card-grid' }, items.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'fdw-record-card',
        onClick: () => store.setView({ section: 'docs', docId: item.id }),
      },
      h('div', { className: 'fdw-record-head' },
        h('span', { className: 'fdw-record-title' }, item.title),
        h(Badge, { tone: item.status === 'approved' ? 'ok' : 'muted' }, t(`doc.status.${item.status}`))),
      h('p', { className: 'fdw-record-sub' }, `${t(`doc.template.${item.template}`)} · ${projectName(state, item.projectId) || t('research.unlinked')} · v${item.currentVersion}`)))),
    h(DocForm, {
      key: `${formOpen ? 'open' : 'closed'}-${prefill?.projectId ?? ''}-${prefill?.stage ?? ''}`,
      open: formOpen,
      t,
      state,
      lang,
      initial: prefill,
      onClose: () => setFormOpen(false),
      onSubmit: values => {
        setFormOpen(false)
        void store.mutate({
          op: 'doc.create',
          title: values.title,
          template: values.template,
          projectId: values.projectId,
          stage: values.stage === '' ? null : Number(values.stage),
        }).then(data => {
          if (typeof data?.result?.docId === 'string') store.setView({ section: 'docs', docId: data.result.docId })
        }).catch(() => {})
      },
    }))
}
