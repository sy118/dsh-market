/** Workbench shell: header, navigation, sections, assistant dock, and dialogs. */
import { useEffect, useRef, useState } from 'react'
import { useWorkbench } from './hooks.js'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Select,
  Spinner,
  h,
} from './common.js'
import {
  DocsIcon,
  HandoffIcon,
  MeetingIcon,
  OpportunityIcon,
  OverviewIcon,
  ProjectsIcon,
  RefreshIcon,
  ResearchIcon,
  SparkIcon,
} from './icons.js'
import { OverviewSection } from './overview.js'
import { ProjectsSection } from './projects.js'
import { ResearchSection } from './research.js'
import { DocsSection } from './docs.js'
import { OpportunitiesSection } from './opportunities.js'
import { MeetingsSection } from './meetings.js'
import { AssistantDock } from './assistant.js'
import { aiReasonText, warningText } from './error-text.js'
import { handoffScope } from '../selectors.js'

const NAV = [
  { section: 'overview', label: 'nav.overview', Icon: OverviewIcon },
  { section: 'projects', label: 'nav.projects', Icon: ProjectsIcon },
  { section: 'research', label: 'nav.research', Icon: ResearchIcon },
  { section: 'docs', label: 'nav.docs', Icon: DocsIcon },
  { section: 'opportunities', label: 'nav.opportunities', Icon: OpportunityIcon },
  { section: 'meetings', label: 'nav.meetings', Icon: MeetingIcon },
]

/** Scope options available from the current view. */
function scopeOptions(view, state, t) {
  const options = [{ value: 'workspace', label: t('handoff.scope.workspace'), scope: { kind: 'workspace' } }]
  if (view.projectId !== undefined) {
    const project = (state.projects ?? []).find(item => item.id === view.projectId)
    if (project !== undefined) {
      options.push({ value: 'project', label: `${t('handoff.scope.project')}: ${project.name}`, scope: { kind: 'project', id: project.id } })
      const stage = view.stage ?? project.currentStage
      options.push({ value: `stage:${stage}`, label: `${t('handoff.scope.stage')}: ${t('units.stage', { number: stage + 1 })}`, scope: { kind: 'stage', id: project.id, stage } })
    }
  }
  if (view.opportunityId !== undefined) {
    const item = (state.opportunities ?? []).find(entry => entry.id === view.opportunityId)
    if (item !== undefined) options.push({ value: 'opportunity', label: `${t('handoff.scope.opportunity')}: ${item.title}`, scope: { kind: 'opportunity', id: item.id } })
  }
  if (view.meetingId !== undefined) {
    const item = (state.meetings ?? []).find(entry => entry.id === view.meetingId)
    if (item !== undefined) options.push({ value: 'meeting', label: `${t('handoff.scope.meeting')}: ${item.title}`, scope: { kind: 'meeting', id: item.id } })
  }
  if (view.researchId !== undefined) {
    const item = (state.research ?? []).find(entry => entry.id === view.researchId)
    if (item !== undefined) options.push({ value: 'research', label: `${t('handoff.scope.research')}: ${item.title}`, scope: { kind: 'research', id: item.id } })
  }
  if (view.docId !== undefined) {
    const item = (state.docs ?? []).find(entry => entry.id === view.docId)
    if (item !== undefined) options.push({ value: 'doc', label: `${t('handoff.scope.doc')}: ${item.title}`, scope: { kind: 'doc', id: item.id } })
  }
  return options
}

/** Build the scope for a selected option value. */
function scopeOf(options, value) {
  return options.find(option => option.value === value)?.scope ?? { kind: 'workspace' }
}

/** Handoff dialog with a copyable prompt on failure. */
function HandoffDialog(props) {
  const { store, t, snapshot, open, onClose } = props
  const state = snapshot.state
  const options = scopeOptions(snapshot.view, state, t)
  const defaultValue = (() => {
    const scope = handoffScope(snapshot.view)
    if (scope.kind === 'stage') return `stage:${scope.stage}`
    const found = options.find(option => option.value === scope.kind)
    return found?.value ?? 'workspace'
  })()
  const [value, setValue] = useState(defaultValue)
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setStatus('idle')
      setResult(null)
      setError(null)
    }
  }, [open])

  async function submit() {
    setStatus('sending')
    setError(null)
    try {
      const created = await store.handoff(scopeOf(options, value))
      setResult(created)
      setStatus('done')
    } catch (valueError) {
      setError(valueError?.code ?? 'handoff/failed')
      setStatus('error')
    }
  }

  async function copyPrompt() {
    const prompt = result?.prompt ?? ''
    try {
      await navigator.clipboard.writeText(prompt)
      store.notify('toast.copied')
    } catch {
      store.notify('error.generic', { tone: 'error' })
    }
  }

  return h(Modal, {
    open,
    title: t('handoff.title'),
    onClose,
    footer: [
      h(Button, { key: 'close', onClick: onClose }, t('common.close')),
      h(Button, {
        key: 'send',
        variant: 'primary',
        disabled: status === 'sending' || status === 'done' || snapshot.handoffBusy,
        onClick: submit,
      }, status === 'sending' ? t('handoff.sending') : t('handoff.button')),
    ],
  },
  h('p', { className: 'fdw-dialog-text' }, t('handoff.body')),
  h(Field, { label: t('handoff.title') },
    h(Select, {
      value,
      onChange: setValue,
      'aria-label': t('handoff.title'),
      options: options.map(option => ({ value: option.value, label: option.label })),
    })),
  status === 'done' && result !== null
    ? h('div', { className: 'fdw-notice fdw-notice--ok' },
      h('p', null, t('handoff.success')),
      result.workspaceFallback === true ? h('p', { className: 'fdw-hint' }, t('handoff.fallback')) : null,
      h(Button, { size: 'sm', onClick: copyPrompt }, t('handoff.copyPrompt')))
    : null,
  status === 'error' ? h('p', { className: 'fdw-error', role: 'alert' }, t('handoff.failure')) : null)
}

/** The panel root. */
export function WorkbenchApp(props) {
  const { store, t, getLang, locale } = props
  const snapshot = useWorkbench(store)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [pendingSection, setPendingSection] = useState(null)
  const [dismissed, setDismissed] = useState([])
  const [, force] = useState(0)
  const loaded = useRef(false)

  // Re-render when the interface language changes; `t` itself always reads the
  // current dictionary.
  useEffect(() => {
    if (typeof locale?.subscribe !== 'function') return undefined
    const off = locale.subscribe(() => force(value => value + 1))
    return typeof off === 'function' ? off : undefined
  }, [locale])

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    void store.load()
  }, [store])

  useEffect(() => {
    const onFocus = () => {
      if (store.getSnapshot().status === 'ready') void store.refresh()
    }
    window.addEventListener('focus', onFocus)
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [store])

  const lang = typeof getLang === 'function' ? getLang() : 'zh'
  const state = snapshot.state
  const warnings = [...new Set((snapshot.warnings ?? []).map(code => warningText(t, code)).filter(Boolean))]
    .filter(text => !dismissed.includes(text))

  function navigate(section) {
    if (section === snapshot.view.section) return
    if (snapshot.dirtyPaths.length > 0) {
      setPendingSection(section)
      return
    }
    store.setView({ section })
  }

  const sectionProps = { store, t, snapshot, lang }
  const content = (() => {
    if (state === null) return null
    if (snapshot.view.section === 'projects') return h(ProjectsSection, sectionProps)
    if (snapshot.view.section === 'research') return h(ResearchSection, sectionProps)
    if (snapshot.view.section === 'docs') return h(DocsSection, sectionProps)
    if (snapshot.view.section === 'opportunities') return h(OpportunitiesSection, sectionProps)
    if (snapshot.view.section === 'meetings') return h(MeetingsSection, sectionProps)
    return h(OverviewSection, {
      ...sectionProps,
      onCreate: () => store.setView({ section: 'projects', newProject: true }),
      onOpenProject: (id, stage) => store.setView({ section: 'projects', projectId: id, stage, tab: stage === undefined ? 'overview' : 'stage' }),
      onNavigate: section => store.setView({ section }),
    })
  })()

  const aiLabel = snapshot.ai?.available === true
    ? `${t('header.aiOn')} · ${snapshot.ai.modelName ?? snapshot.ai.model}`
    : t('header.aiOff')

  return h('div', { className: 'fdw-page', 'data-lang': lang },
    h('header', { className: 'fdw-header' },
      h('div', { className: 'fdw-title-block' },
        h('h1', { className: 'fdw-title' }, t('title')),
        h('p', { className: 'fdw-subtitle' }, t('subtitle'))),
      h('div', { className: 'fdw-header-tools' },
        h('span', {
          className: 'fdw-root',
          title: snapshot.root === '' ? undefined : snapshot.root,
          'aria-label': `${t('a11y.rootPath')}: ${snapshot.root}`,
        }, snapshot.root === '' ? t('loading') : snapshot.root),
        h('span', { title: snapshot.ai?.available === true ? undefined : aiReasonText(t, snapshot.ai?.reason) },
          h(Badge, { tone: snapshot.ai?.available === true ? 'ok' : 'muted' }, aiLabel)),
        h(Button, {
          size: 'sm',
          onClick: () => setHandoffOpen(true),
          disabled: state === null || snapshot.readOnly,
        }, h(HandoffIcon), t('header.handoff')),
        h(IconButton, { label: t('header.refresh'), onClick: () => void store.refresh() }, h(RefreshIcon)),
        h(Button, {
          size: 'sm',
          variant: assistantOpen ? 'primary' : 'ghost',
          onClick: () => setAssistantOpen(open => !open),
        }, h(SparkIcon), t('assistant.title')))),
    warnings.length === 0 ? null : h('div', { className: 'fdw-banner', role: 'status' },
      h('div', null,
        h('strong', null, t('warnings.title')),
        h('ul', { className: 'fdw-banner-list' }, warnings.map(text => h('li', { key: text }, text)))),
      h(Button, { size: 'sm', variant: 'ghost', onClick: () => setDismissed(warnings) }, t('common.close'))),
    snapshot.rootError === null
      ? null
      : h('div', { className: 'fdw-banner fdw-banner--bad', role: 'alert' },
        h('strong', null, t('error.root')),
        h('p', { className: 'fdw-hint' }, snapshot.rootError.message)),
    h('div', { className: assistantOpen ? 'fdw-body fdw-body--assistant' : 'fdw-body' },
      h('nav', { className: 'fdw-nav', 'aria-label': t('a11y.nav') },
        NAV.map(item => h('button', {
          key: item.section,
          type: 'button',
          className: snapshot.view.section === item.section ? 'fdw-nav-item fdw-nav-item--active' : 'fdw-nav-item',
          'aria-current': snapshot.view.section === item.section ? 'page' : undefined,
          onClick: () => navigate(item.section),
        }, h(item.Icon), h('span', null, t(item.label))))),
      h('main', { className: 'fdw-main' },
        snapshot.status === 'loading' && state === null
          ? h('div', { className: 'fdw-loading' }, h(Spinner, { label: t('loading') }))
          : null,
        snapshot.status === 'error' && state === null
          ? h(EmptyState, {
            title: t('error.generic'),
            body: t('error.network'),
            action: h(Button, { variant: 'primary', onClick: () => void store.load() }, t('common.retry')),
          })
          : content),
      h(AssistantDock, {
        store,
        t,
        snapshot,
        open: assistantOpen,
        onClose: () => setAssistantOpen(false),
      })),
    snapshot.toast === null
      ? null
      : h('div', { className: `fdw-toast fdw-toast--${snapshot.toast.tone}`, role: 'status' },
        h('span', null, t(snapshot.toast.code, snapshot.toast.params)),
        h('button', { type: 'button', className: 'fdw-row-action', 'aria-label': t('common.close'), onClick: () => store.dismissToast() }, '×')),
    h(HandoffDialog, { store, t, snapshot, open: handoffOpen, onClose: () => setHandoffOpen(false) }),
    h(ConfirmDialog, {
      open: pendingSection !== null,
      title: t('nav.unsavedTitle'),
      body: t('nav.unsavedBody'),
      confirmLabel: t('nav.leave'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setPendingSection(null),
      onConfirm: () => {
        const target = pendingSection
        setPendingSection(null)
        if (target !== null) store.setView({ section: target })
      },
    }))
}
