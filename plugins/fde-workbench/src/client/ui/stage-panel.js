/** One stage: fixed work, deliverables, evidence, blockers, review, and decision. */
import { useEffect, useState } from 'react'
import {
  ARTIFACT_KINDS,
  SEVERITIES,
} from '../../shared/constants.js'
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Modal,
  SectionHead,
  Select,
  TextArea,
  TextInput,
  h,
} from './common.js'
import { BodyEditor } from './body-editor.js'
import { CheckIcon, PlusIcon, TrashIcon } from './icons.js'
import { errorText } from './error-text.js'
import { stageReview, stageQuestion, stageTitle, workProgress } from '../selectors.js'

/** Optimistically flip one work item. */
function optimisticWork(state, projectId, stageIndex, workId) {
  return {
    ...state,
    projects: state.projects.map(project => (project.id !== projectId ? project : {
      ...project,
      stages: project.stages.map((stage, index) => (index !== stageIndex ? stage : {
        ...stage,
        work: stage.work.map(item => (item.id !== workId ? item : { ...item, done: !item.done })),
      })),
    })),
  }
}

/** Optimistically flip one blocker. */
function optimisticBlocker(state, projectId, stageIndex, blockerId) {
  return {
    ...state,
    projects: state.projects.map(project => (project.id !== projectId ? project : {
      ...project,
      stages: project.stages.map((stage, index) => (index !== stageIndex ? stage : {
        ...stage,
        blockers: stage.blockers.map(item => (item.id !== blockerId ? item : { ...item, resolved: !item.resolved })),
      })),
    })),
  }
}

/** Human-readable review blocker. */
export function reviewBlockerText(t, blocker) {
  if (blocker.code === 'stage.review.work') return t('stage.review.work', { count: blocker.count, total: blocker.total })
  if (blocker.code === 'stage.review.artifactMissing') {
    return t('stage.review.artifactMissing', { title: blocker.title, path: blocker.path })
  }
  if (blocker.code === 'stage.review.artifactError') {
    return t('stage.review.artifactError', { title: blocker.title, message: blocker.message })
  }
  if (blocker.code === 'stage.review.blocker') {
    return t('stage.review.blocker', { text: blocker.text, severity: t(`severity.${blocker.severity}`) })
  }
  return String(blocker.code ?? '')
}

/** Status badge tone. */
function stageTone(status) {
  if (status === 'review-ready') return 'ok'
  if (status === 'blocked') return 'bad'
  return 'info'
}

/** Editor for one fixed deliverable. */
function DeliverableEditor(props) {
  const { store, t, project, stageIndex, deliverable, onClose } = props
  const [text, setText] = useState('')
  const [hash, setHash] = useState('')
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    store.readArtifact(project.id, stageIndex, deliverable.id).then(value => {
      if (!alive) return
      setText(value.text)
      setHash(value.hash)
      setStatus(value.status)
      setError('')
    }).catch(value => {
      if (!alive) return
      setStatus('error')
      setError(value?.code ?? 'error.generic')
    })
    return () => { alive = false }
  }, [store, project.id, stageIndex, deliverable.id])

  async function save() {
    setSaving(true)
    setError('')
    try {
      await store.mutate({
        op: 'stage.deliverable.write',
        projectId: project.id,
        stage: stageIndex,
        artifactId: deliverable.id,
        content: text,
        baseHash: hash,
      })
      onClose()
    } catch (value) {
      setError(value?.code ?? 'error.generic')
    } finally {
      setSaving(false)
    }
  }

  return h(Modal, {
    open: true,
    title: `${deliverable.title}${deliverable.required === false ? ` · ${t('stage.optional')}` : ''}`,
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, t('common.cancel')),
      h(Button, { key: 'save', variant: 'primary', onClick: save, disabled: saving || status === 'loading' },
        saving ? t('file.saving') : t('common.save')),
    ],
  },
  h('p', { className: 'fdw-hint' }, deliverable.path),
  status === 'loading' ? h('p', { role: 'status' }, t('file.loading')) : null,
  status === 'error' || error !== ''
    ? h('p', { className: 'fdw-error', role: 'alert' }, error === '' ? t('error.generic') : errorText(t, error))
    : null,
  h(TextArea, {
    value: text,
    onChange: setText,
    rows: 16,
    disabled: status === 'loading',
    placeholder: t('stage.artifactPlaceholder'),
    'aria-label': deliverable.title,
  }))
}

/** One stage workbench. */
export function StagePanel(props) {
  const { store, t, state, project, stageIndex, lang, onOpenResearch, onOpenDoc, onAddResearch, onAddDoc, onOpenSource, onStageChanged } = props
  const stage = project.stages[stageIndex]
  const projectStatus = project.status ?? 'active'
  const editable = projectStatus === 'active' && stageIndex === project.currentStage
  const completed = projectStatus === 'completed'
  const stopped = projectStatus === 'stopped'
  const paused = projectStatus === 'paused'
  const derived = stage.status === undefined ? stageReview(stage) : { status: stage.status, blockers: stage.reviewBlockers ?? stageReview(stage).blockers }
  const canDecide = stageIndex === project.currentStage && (projectStatus === 'active' || completed)
  const canGo = derived.status === 'review-ready'
  const progress = workProgress(stage)
  const [blockerText, setBlockerText] = useState('')
  const [blockerSeverity, setBlockerSeverity] = useState('medium')
  const [evidenceName, setEvidenceName] = useState('')
  const [evidenceKind, setEvidenceKind] = useState('doc')
  const [evidenceSource, setEvidenceSource] = useState('')
  const [artifactEditor, setArtifactEditor] = useState(null)
  const [outcome, setOutcome] = useState('go')
  const [rationale, setRationale] = useState('')
  const [decidedBy, setDecidedBy] = useState(project.owner ?? '')
  const [decisionError, setDecisionError] = useState('')
  const [confirmDecision, setConfirmDecision] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [returnError, setReturnError] = useState('')

  const run = (mutation, optimistic) => store.mutate(mutation, { optimistic }).catch(() => {})
  const attachments = {
    research: (state.research ?? []).filter(item => item.projectId === project.id && item.stage === stageIndex),
    docs: (state.docs ?? []).filter(item => item.projectId === project.id && item.stage === stageIndex),
  }
  const sources = project.sources ?? []

  function addBlocker() {
    const text = blockerText.trim()
    if (text === '') return
    setBlockerText('')
    void run({ op: 'stage.blocker.add', projectId: project.id, stage: stageIndex, text, severity: blockerSeverity })
  }

  function addEvidence() {
    const name = evidenceName.trim()
    if (name === '') return
    setEvidenceName('')
    void run({
      op: 'stage.artifact.add',
      projectId: project.id,
      stage: stageIndex,
      name,
      kind: evidenceKind,
      sourceId: evidenceSource,
    }).then(() => setEvidenceSource('')).catch(() => {})
  }

  function submitDecision() {
    if (rationale.trim() === '') {
      setDecisionError(t('stage.decideRequired'))
      return
    }
    if (outcome === 'go' && !canGo) {
      setDecisionError(t('stage.notReady'))
      return
    }
    setDecisionError('')
    setConfirmDecision(true)
  }

  function confirmDecisionAction() {
    setConfirmDecision(false)
    void store.mutate({
      op: 'stage.decide',
      projectId: project.id,
      stage: stageIndex,
      outcome,
      rationale,
      decidedBy,
    }).then(() => {
      setRationale('')
      if (outcome === 'go' && project.currentStage < 7) onStageChanged?.(Math.min(7, stageIndex + 1))
    }).catch(() => {})
  }

  function submitReturn() {
    if (returnReason.trim() === '') {
      setReturnError(t('stage.returnReasonRequired'))
      return
    }
    setReturnError('')
    void store.mutate({
      op: 'stage.return',
      projectId: project.id,
      reason: returnReason,
    }).then(() => {
      setReturnOpen(false)
      setReturnReason('')
      onStageChanged?.(Math.max(0, stageIndex - 1))
    }).catch(() => {})
  }

  return h('div', { className: 'fdw-stage-panel' },
    h('div', { className: 'fdw-stage-head' },
      h('div', null,
        h('h2', { className: 'fdw-stage-title' }, `${String(stageIndex + 1).padStart(2, '0')} · ${stageTitle(lang, stageIndex)}`),
        h('p', { className: 'fdw-stage-question' }, stageQuestion(lang, stageIndex))),
      h('div', { className: 'fdw-stage-meta' },
        h(Badge, { tone: stageTone(derived.status) }, t(`stage.status.${derived.status}`)),
        h('span', { className: 'fdw-hint' }, t('stage.workDone', progress)))),
    project.reconfirmThrough !== null && stageIndex <= project.reconfirmThrough
      ? h('p', { className: 'fdw-notice fdw-notice--warning' }, t('stage.reconfirm', { through: project.reconfirmThrough + 1 }))
      : null,
    editable ? null : h('p', { className: 'fdw-notice' },
      completed ? t('stage.delivered') : stopped ? t('stage.stopped') : paused ? t('stage.paused') : stageIndex < project.currentStage ? t('stage.historyOnly') : t('stage.futureOnly')),
    stage.status === 'review-ready' ? h('p', { className: 'fdw-notice fdw-notice--ok' }, t('stage.reviewReady')) : null,
    derived.blockers.length > 0
      ? h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('stage.reviewBlockers'), hint: t('stage.reviewHint') }),
        h('ul', { className: 'fdw-rows' }, derived.blockers.map((blocker, index) => h('li', { key: `${blocker.code}-${index}`, className: 'fdw-row' },
          h('span', { className: 'fdw-row-title' }, reviewBlockerText(t, blocker))))))
      : null,

    h('div', { className: 'fdw-columns fdw-columns--stage' },
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('stage.work'), hint: t('stage.workDone', progress) }),
        h('ul', { className: 'fdw-check-list' }, stage.work.map(item => h('li', { key: item.id, className: item.done ? 'fdw-check-row fdw-check-row--done' : 'fdw-check-row' },
          h('input', {
            type: 'checkbox',
            checked: item.done,
            disabled: !editable,
            'aria-label': item.text,
            onChange: () => {
              if (editable) void run({ op: 'stage.work.toggle', projectId: project.id, stage: stageIndex, workId: item.id },
                stateValue => optimisticWork(stateValue, project.id, stageIndex, item.id))
            },
          }),
          h('span', { className: 'fdw-check-text' }, item.text))))),

      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('stage.deliverables'), hint: t('stage.deliverablesHint') }),
        h('ul', { className: 'fdw-rows' }, (stage.deliverables ?? []).map(item => h('li', { key: item.id, className: 'fdw-row' },
          h('div', { className: 'fdw-row-main' },
            h('span', { className: 'fdw-row-title' }, item.title),
            h('span', { className: 'fdw-row-sub' }, `${item.required === false ? t('stage.optional') : t('stage.required')} · ${item.path}`)),
          h('span', { className: `fdw-status fdw-status--${item.status}` }, t(`artifact.status.${item.status}`)),
          h(Button, {
            size: 'sm',
            disabled: !editable,
            onClick: () => setArtifactEditor(item),
          }, t(item.status === 'present' ? 'common.edit' : 'stage.createArtifact')))))),

      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('stage.evidence') }),
        stage.artifacts.length === 0 ? h('p', { className: 'fdw-hint' }, t('stage.noEvidence')) : null,
        h('ul', { className: 'fdw-rows' }, stage.artifacts.map(item => h('li', { key: item.id, className: 'fdw-row' },
          h('div', { className: 'fdw-row-main' },
            h('span', { className: 'fdw-row-title' }, item.name),
            h('span', { className: 'fdw-row-sub' },
              `${t(`kind.${item.kind}`)}${item.sourceId === '' ? '' : ` · ${t('stage.linkedSource')}`}${item.docId === '' ? '' : ` · ${t('stage.linkedDoc')}`}`)),
          h('button', {
            type: 'button',
            className: `fdw-status fdw-status--${item.status}`,
            disabled: !editable,
            'aria-label': `${item.name}: ${t(`status.${item.status}`)}`,
            onClick: () => {
              if (editable) void run({ op: 'stage.artifact.cycle', projectId: project.id, stage: stageIndex, artifactId: item.id })
            },
          }, t(`status.${item.status}`)),
          item.sourceId === '' ? null : h('button', {
            type: 'button',
            className: 'fdw-link-button',
            onClick: () => onOpenSource?.(item.sourceId),
          }, t('stage.openSource')),
          editable
            ? h('button', { type: 'button', className: 'fdw-row-action', 'aria-label': t('common.delete'), onClick: () => void run({ op: 'stage.artifact.remove', projectId: project.id, stage: stageIndex, artifactId: item.id }) }, h(TrashIcon))
            : null))),
        editable
          ? h('div', { className: 'fdw-inline-form fdw-inline-form--wrap' },
            h(TextInput, { value: evidenceName, placeholder: t('stage.artifactName'), onChange: setEvidenceName, 'aria-label': t('stage.artifactName') }),
            h(Select, {
              value: evidenceKind,
              onChange: setEvidenceKind,
              'aria-label': t('stage.artifactKind'),
              options: ARTIFACT_KINDS.map(value => ({ value, label: t(`kind.${value}`) })),
            }),
            sources.length === 0 ? null : h(Select, {
              value: evidenceSource,
              onChange: setEvidenceSource,
              'aria-label': t('stage.sourcePick'),
              options: [{ value: '', label: t('stage.noSource') }, ...sources.map(source => ({ value: source.id, label: source.name }))],
            }),
            h(Button, { size: 'sm', onClick: addEvidence, disabled: evidenceName.trim() === '' }, h(PlusIcon), t('common.add')))
          : null),

      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('stage.blockers') }),
        stage.blockers.length === 0 ? h('p', { className: 'fdw-hint' }, t('stage.noBlockers')) : null,
        h('ul', { className: 'fdw-rows' }, stage.blockers.map(item => h('li', { key: item.id, className: item.resolved ? 'fdw-row fdw-row--done' : 'fdw-row' },
          h('div', { className: 'fdw-row-main' },
            h('span', { className: 'fdw-row-title' }, item.text),
            h('span', { className: 'fdw-row-sub' }, t(`severity.${item.severity}`))),
          h('button', {
            type: 'button',
            className: item.resolved ? 'fdw-btn fdw-btn--sm fdw-btn--ghost' : 'fdw-btn fdw-btn--sm',
            disabled: !editable,
            onClick: () => {
              if (editable) void run({ op: 'stage.blocker.resolve', projectId: project.id, stage: stageIndex, blockerId: item.id },
                stateValue => optimisticBlocker(stateValue, project.id, stageIndex, item.id))
            },
          }, item.resolved ? t('status.verified') : t('common.apply')),
          editable
            ? h('button', { type: 'button', className: 'fdw-row-action', 'aria-label': t('common.delete'), onClick: () => void run({ op: 'stage.blocker.remove', projectId: project.id, stage: stageIndex, blockerId: item.id }) }, h(TrashIcon))
            : null))),
        editable
          ? h('div', { className: 'fdw-inline-form' },
            h(TextInput, { value: blockerText, placeholder: t('stage.blockerText'), onChange: setBlockerText, 'aria-label': t('stage.blockerText') }),
            h(Select, {
              value: blockerSeverity,
              onChange: setBlockerSeverity,
              'aria-label': t('stage.blockerSeverity'),
              options: SEVERITIES.map(value => ({ value, label: t(`severity.${value}`) })),
            }),
            h(Button, { size: 'sm', onClick: addBlocker, disabled: blockerText.trim() === '' }, h(PlusIcon), t('common.add')))
          : null)),

    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('stage.note') }),
        h(BodyEditor, { store, t, path: stage.noteFile, label: t('stage.note'), placeholder: t('stage.notePlaceholder'), rows: 8, readOnly: !editable })),

      h('section', { className: 'fdw-card' },
        h(SectionHead, { title: t('stage.decision') }),
        canDecide
          ? h('div', { className: 'fdw-decision-form' },
            h(Field, { label: t('stage.outcome') },
              h(Select, {
                value: outcome,
                onChange: setOutcome,
                'aria-label': t('stage.outcome'),
                options: [
                  { value: 'go', label: t('stage.outcome.go') },
                  { value: 'revise', label: t('stage.outcome.revise') },
                  { value: 'narrow', label: t('stage.outcome.narrow') },
                  { value: 'stop', label: t('stage.outcome.stop') },
                ],
              })),
            h(Field, { label: t('stage.rationale'), required: true },
              h(TextArea, { value: rationale, onChange: setRationale, rows: 4, placeholder: t('stage.decisionPlaceholder'), 'aria-label': t('stage.rationale') })),
            h(Field, { label: t('stage.decidedBy') },
              h(TextInput, { value: decidedBy, onChange: setDecidedBy, 'aria-label': t('stage.decidedBy') })),
            outcome === 'go' && !canGo ? h('p', { className: 'fdw-hint' }, t('stage.notReady')) : null,
            decisionError === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, decisionError),
            h('div', { className: 'fdw-inline-actions' },
              h(Button, { variant: 'primary', onClick: submitDecision, disabled: rationale.trim() === '' }, h(CheckIcon), t('stage.recordDecision')),
              editable && stageIndex > 0 ? h(Button, { onClick: () => setReturnOpen(true) }, t('stage.return')) : null))
          : h('p', { className: 'fdw-hint' }, t('stage.readOnly')),
        stage.decisions.length === 0 ? null : h('ul', { className: 'fdw-decisions' }, stage.decisions.slice().reverse().map(item => h('li', { key: item.id, className: 'fdw-decision' },
          h('span', { className: 'fdw-decision-kind' }, t(`stage.outcome.${item.outcome ?? 'go'}`)),
          h('span', { className: 'fdw-decision-text' }, item.rationale ?? item.decision),
          h('span', { className: 'fdw-hint' }, `${String(item.decidedAt ?? item.at).slice(0, 10)}${item.legacy === true ? ` · ${t('stage.legacyDecision')}` : ''}${item.evidenceDigest && stage.evidenceDigest && item.evidenceDigest !== stage.evidenceDigest ? ` · ${t('stage.staleDecision')}` : ''}`)))))),

    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(SectionHead, {
          title: t('stage.research'),
          action: h(Button, { size: 'sm', onClick: onAddResearch, disabled: !editable }, h(PlusIcon), t('stage.addResearch')),
        }),
        attachments.research.length === 0
          ? h('p', { className: 'fdw-hint' }, t('research.empty'))
          : h('ul', { className: 'fdw-rows' }, attachments.research.map(item => h('li', { key: item.id, className: 'fdw-row' },
            h('button', { type: 'button', className: 'fdw-link-button', onClick: () => onOpenResearch(item.id) }, item.title),
            h(Badge, { tone: item.status === 'closed' ? 'ok' : 'muted' }, t(`research.status.${item.status}`)))))),
      h('section', { className: 'fdw-card' },
        h(SectionHead, {
          title: t('stage.docs'),
          action: h(Button, { size: 'sm', onClick: onAddDoc, disabled: !editable }, h(PlusIcon), t('stage.addDoc')),
        }),
        attachments.docs.length === 0
          ? h('p', { className: 'fdw-hint' }, t('doc.empty'))
          : h('ul', { className: 'fdw-rows' }, attachments.docs.map(item => h('li', { key: item.id, className: 'fdw-row' },
            h('button', { type: 'button', className: 'fdw-link-button', onClick: () => onOpenDoc(item.id) }, item.title),
            h(Badge, { tone: item.status === 'approved' ? 'ok' : 'muted' }, t(`doc.status.${item.status}`))))))),

    artifactEditor === null ? null : h(DeliverableEditor, {
      store,
      t,
      project,
      stageIndex,
      deliverable: artifactEditor,
      onClose: () => setArtifactEditor(null),
    }),
    h(ConfirmDialog, {
      open: confirmDecision,
      tone: outcome === 'stop' ? 'danger' : 'primary',
      title: t(`stage.confirm.${outcome}.title`),
      body: t(`stage.confirm.${outcome}.body`, { project: project.name, from: stageIndex + 1, to: Math.min(8, stageIndex + 2) }),
      confirmLabel: t(`stage.confirm.${outcome}.confirm`),
      cancelLabel: t('common.cancel'),
      onConfirm: confirmDecisionAction,
      onCancel: () => setConfirmDecision(false),
    }),
    h(Modal, {
      open: returnOpen,
      title: t('stage.returnTitle'),
      onClose: () => setReturnOpen(false),
      footer: [
        h(Button, { key: 'cancel', onClick: () => setReturnOpen(false) }, t('common.cancel')),
        h(Button, { key: 'return', variant: 'danger', onClick: submitReturn }, t('stage.returnConfirm')),
      ],
    },
    h('p', { className: 'fdw-dialog-text' }, t('stage.returnBody', { from: stageIndex + 1, to: stageIndex })),
    h(Field, { label: t('stage.returnReason'), required: true },
      h(TextArea, { value: returnReason, onChange: setReturnReason, rows: 3, 'aria-label': t('stage.returnReason') })),
    returnError === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, returnError)))
}
