/** Context assistant: read-only answers plus confirmed project creation. */
import { useEffect, useRef, useState } from 'react'
import { Button, SectionHead, Spinner, TextArea, h } from './common.js'
import { PlusIcon, SendIcon, StopIcon, TrashIcon } from './icons.js'
import { aiReasonText, errorText } from './error-text.js'
import { handoffScope } from '../selectors.js'
import { ProjectForm } from './project-form.js'

/** Human-readable label for the current context. */
function contextLabel(view, state, t) {
  const scope = handoffScope(view)
  if (scope.kind === 'workspace') return t('assistant.context.workspace')
  const suffix = scope.stage === undefined ? '' : ` · ${t('units.stage', { number: scope.stage + 1 })}`
  if (scope.kind === 'project') {
    const project = (state.projects ?? []).find(item => item.id === scope.id)
    return `${t('assistant.context.project')}: ${project?.name ?? ''}${suffix}`
  }
  if (scope.kind === 'opportunity') {
    const item = (state.opportunities ?? []).find(entry => entry.id === scope.id)
    return `${t('assistant.context.opportunity')}: ${item?.title ?? ''}`
  }
  if (scope.kind === 'meeting') {
    const item = (state.meetings ?? []).find(entry => entry.id === scope.id)
    return `${t('assistant.context.meeting')}: ${item?.title ?? ''}`
  }
  if (scope.kind === 'research') {
    const item = (state.research ?? []).find(entry => entry.id === scope.id)
    return `${t('assistant.context.research')}: ${item?.title ?? ''}`
  }
  if (scope.kind === 'doc') {
    const item = (state.docs ?? []).find(entry => entry.id === scope.id)
    return `${t('assistant.context.doc')}: ${item?.title ?? ''}`
  }
  return t('assistant.context.workspace')
}

/** One project creation proposal, pending explicit confirmation. */
function ProjectAction(props) {
  const { store, t, project, status, error, busy, onConfirm, onDismiss } = props
  return h('div', { className: 'fdw-action-card' },
    h(SectionHead, { title: t('assistant.action.createTitle'), hint: project.name }),
    h('dl', { className: 'fdw-facts' },
      project.customer === '' ? null : h('div', null, h('dt', null, t('project.customer')), h('dd', null, project.customer)),
      project.owner === '' ? null : h('div', null, h('dt', null, t('project.owner')), h('dd', null, project.owner)),
      project.startDate === '' && project.endDate === ''
        ? null
        : h('div', null, h('dt', null, t('project.period')), h('dd', null, `${project.startDate || '—'} → ${project.endDate || '—'}`)),
      project.successCriteria === '' ? null : h('div', null, h('dt', null, t('project.successCriteria')), h('dd', null, project.successCriteria)),
      project.stakeholders === '' ? null : h('div', null, h('dt', null, t('project.stakeholders')), h('dd', null, project.stakeholders))),
    error === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, errorText(t, error)),
    status === 'created'
      ? h('p', { className: 'fdw-notice fdw-notice--ok' }, t('assistant.action.created'))
      : h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', variant: 'primary', disabled: busy, onClick: onConfirm }, busy ? t('common.saving') : t('assistant.action.confirm')),
        h(Button, { size: 'sm', onClick: onDismiss, disabled: busy }, t('common.cancel'))))
}

/** Assistant dock. */
export function AssistantDock(props) {
  const { store, t, snapshot, open, onClose } = props
  const state = snapshot.state
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const controller = useRef(null)
  const listRef = useRef(null)
  const scope = handoffScope(snapshot.view)
  const scopeKey = JSON.stringify(scope)
  const available = snapshot.ai?.available === true

  useEffect(() => {
    setMessages([])
    setError(null)
    setInput('')
    setActionError('')
  }, [scopeKey])

  useEffect(() => {
    const node = listRef.current
    if (node !== null && typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight })
  }, [messages, running])

  if (!open) return null

  function openProject(id) {
    store.setView({ section: 'projects', projectId: id, tab: 'overview', stage: 0 })
  }

  function createProject(values) {
    return store.mutate({ op: 'project.create', ...values }).then(data => {
      const id = data?.result?.projectId
      setFormOpen(false)
      store.notify('toast.projectCreated')
      if (typeof id === 'string') openProject(id)
      return data
    })
  }

  async function send() {
    const text = input.trim()
    if (text === '' || running || !available) return
    setInput('')
    setError(null)
    setActionError('')
    const history = [...messages.map(message => ({ role: message.role, text: message.text })), { role: 'user', text }]
    setMessages([...history, { role: 'assistant', text: '' }])
    setRunning(true)
    controller.current = new AbortController()
    try {
      const final = await store.runAi('assistant.command', { scope, messages: history }, {
        signal: controller.current.signal,
        // The command is JSON, so deltas would flash raw syntax; wait for the
        // parsed result and show a clean answer plus its confirmation card.
        onDelta: () => {},
      })
      const command = final?.result
      if (command === null || command === undefined) {
        setError({ code: 'ai/unstructured' })
        setMessages(current => {
          const next = [...current]
          next[next.length - 1] = { role: 'assistant', text: '' }
          return next
        })
        return
      }
      setMessages(current => {
        const next = [...current]
        next[next.length - 1] = {
          role: 'assistant',
          text: typeof command.reply === 'string' && command.reply !== '' ? command.reply : t('assistant.action.prepared'),
          action: command.action === 'project.create' ? { ...command.project, status: 'pending' } : null,
          error: '',
        }
        return next
      })
    } catch (value) {
      if (value?.name !== 'AbortError' && value?.code !== 'ai/cancelled') {
        setError(value)
        if (value?.details?.cause === 'MISSING_CREDENTIAL') void store.refresh()
      }
    } finally {
      setRunning(false)
      controller.current = null
    }
  }

  function confirmAction(index) {
    const message = messages[index]
    if (message?.action === undefined || message.action === null) return
    setActionBusy(true)
    setActionError('')
    const project = message.action
    store.mutate({
      op: 'project.create',
      name: project.name,
      customer: project.customer,
      owner: project.owner,
      startDate: project.startDate,
      endDate: project.endDate,
      successCriteria: project.successCriteria,
      stakeholders: project.stakeholders,
    }).then(data => {
      const id = data?.result?.projectId
      setMessages(current => {
        const next = [...current]
        next[index] = { ...next[index], action: { ...next[index].action, status: 'created' } }
        return next
      })
      store.notify('toast.projectCreated')
      if (typeof id === 'string') openProject(id)
    }).catch(value => setActionError(value?.code ?? 'error.generic')).finally(() => setActionBusy(false))
  }

  function stop() {
    controller.current?.abort()
    setRunning(false)
  }

  return h('aside', { className: 'fdw-assistant', 'aria-label': t('a11y.assistant') },
    h('div', { className: 'fdw-assistant-head' },
      h('div', null,
        h('h3', { className: 'fdw-assistant-title' }, t('assistant.title')),
        h('p', { className: 'fdw-hint' }, contextLabel(snapshot.view, state, t))),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', variant: 'ghost', onClick: () => setFormOpen(true) }, h(PlusIcon), t('assistant.newProject')),
        h(Button, { size: 'sm', variant: 'ghost', onClick: onClose }, t('common.close')))),
    available ? null : h('p', { className: 'fdw-notice' }, aiReasonText(t, snapshot.ai?.reason)),
    h('div', { className: 'fdw-messages', ref: listRef },
      messages.length === 0
        ? h('div', { className: 'fdw-assistant-empty' },
          h('p', { className: 'fdw-hint' }, t('assistant.empty')),
          h(Button, { size: 'sm', onClick: () => setFormOpen(true) }, h(PlusIcon), t('assistant.newProject')))
        : messages.map((message, index) => h('div', {
          key: index,
          className: message.role === 'user' ? 'fdw-message fdw-message--user' : 'fdw-message',
        },
        message.text === '' && running && index === messages.length - 1
          ? h(Spinner, { label: t('assistant.thinking') })
          : message.text,
        message.action === null || message.action === undefined
          ? null
          : h(ProjectAction, {
            store,
            t,
            project: message.action,
            status: message.action.status,
            error: actionError,
            busy: actionBusy,
            onConfirm: () => confirmAction(index),
            onDismiss: () => setMessages(current => {
              const next = [...current]
              next[index] = { ...next[index], action: null }
              return next
            }),
          }))),
      error === null ? null : h('p', { className: 'fdw-error', role: 'alert' }, errorText(t, error?.code, error?.details?.cause))),
    h('div', { className: 'fdw-assistant-input' },
      h(TextArea, {
        value: input,
        onChange: setInput,
        rows: 3,
        placeholder: t('assistant.placeholder'),
        'aria-label': t('assistant.placeholder'),
      }),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { variant: 'primary', size: 'sm', onClick: send, disabled: !available || running || input.trim() === '' }, h(SendIcon), t('assistant.send')),
        running ? h(Button, { size: 'sm', onClick: stop }, h(StopIcon), t('assistant.stop')) : null,
        h(Button, { size: 'sm', variant: 'ghost', onClick: () => setMessages([]) }, h(TrashIcon), t('assistant.clear')))),
    h('p', { className: 'fdw-hint fdw-assistant-note' }, t('assistant.readOnly')),
    h(ProjectForm, {
      open: formOpen,
      t,
      initial: undefined,
      onClose: () => setFormOpen(false),
      onSubmit: values => { void createProject(values).catch(() => {}) },
    }))
}
