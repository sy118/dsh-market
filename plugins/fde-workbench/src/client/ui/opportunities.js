/** AI opportunities: scored library, rating editor, and model assessment. */
import { useEffect, useState } from 'react'
import {
  COMPLIANCE_LEVELS,
  DIMENSIONS,
  DOMAINS,
  OPP_STATUSES,
  TASK_TYPES,
} from '../../shared/constants.js'
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
import { SparkIcon, PlusIcon, TrashIcon } from './icons.js'
import { errorText, aiReasonText } from './error-text.js'
import { filterOpportunities } from '../selectors.js'
import { scoreOpportunity as computeScore } from '../../shared/scoring.js'

/** Map a verdict to a badge tone. */
function verdictTone(verdict) {
  if (verdict === 'pilot') return 'ok'
  if (verdict === 'validate') return 'warn'
  return 'bad'
}

/** Score summary for one opportunity. */
export function ScoreCard(props) {
  const { t, derived } = props
  return h('div', { className: 'fdw-score' },
    h('div', { className: 'fdw-score-main' },
      h('span', { className: 'fdw-score-value' }, String(derived.score)),
      h('span', { className: 'fdw-score-max' }, '/100')),
    h('div', { className: 'fdw-score-body' },
      h('div', { className: 'fdw-score-row' },
        h('span', { className: 'fdw-hint' }, t('score.verdict')),
        h(Badge, { tone: verdictTone(derived.verdict) }, t(`verdict.${derived.verdict}`))),
      h('div', { className: 'fdw-score-row' },
        h('span', { className: 'fdw-hint' }, t('score.weakest')),
        h('span', null, t(`score.dimension.${derived.weakest}`))),
      derived.notes.length === 0 ? null : h('ul', { className: 'fdw-score-notes' },
        derived.notes.map(note => h('li', { key: note }, t(`score.note.${note}`)))),
      h('p', { className: 'fdw-hint' }, t('score.hint'))))
}

/** Five rating rows. */
function RatingEditor(props) {
  const { t, ratings, onChange, disabled } = props
  return h('div', { className: 'fdw-ratings' }, DIMENSIONS.map(dimension => h('div', { key: dimension.key, className: 'fdw-rating-row' },
    h('span', { className: 'fdw-rating-label' }, t(`score.dimension.${dimension.key}`)),
    h('span', { className: 'fdw-rating-buttons', role: 'group', 'aria-label': t(`score.dimension.${dimension.key}`) },
      [1, 2, 3, 4, 5].map(value => h('button', {
        key: value,
        type: 'button',
        className: ratings[dimension.key] === value ? 'fdw-rating fdw-rating--on' : 'fdw-rating',
        'aria-pressed': ratings[dimension.key] === value,
        'aria-label': `${t(`score.dimension.${dimension.key}`)} ${value}`,
        disabled,
        onClick: () => onChange(dimension.key, value),
      }, String(value)))))))
}

/** Create-opportunity dialog. */
function OpportunityForm(props) {
  const { open, t, state, initial, onClose, onSubmit } = props
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [proposer, setProposer] = useState(initial?.proposer ?? '')
  const [domain, setDomain] = useState(initial?.domain ?? 'other')
  const [taskType, setTaskType] = useState(initial?.taskType ?? 'validate')
  const [compliance, setCompliance] = useState(initial?.compliance ?? 'medium')
  const [sourceMeeting] = useState(initial?.source?.meetingId ?? '')
  return h(Modal, {
    open,
    title: t('opp.newTitle'),
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, t('common.cancel')),
      h(Button, {
        key: 'save',
        variant: 'primary',
        disabled: title.trim() === '',
        onClick: () => onSubmit({
          title: title.trim(),
          description,
          proposer,
          domain,
          taskType,
          compliance,
          ratings: { data: 3, rules: 3, review: 3, value: 3, adoption: 3 },
          source: sourceMeeting === '' ? { type: 'idea' } : { type: 'meeting', meetingId: sourceMeeting },
        }),
      }, t('common.save')),
    ],
  },
  h(Field, { label: t('opp.title'), required: true }, h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('opp.title') })),
  h(Field, { label: t('opp.description') }, h(TextArea, { value: description, onChange: setDescription, rows: 4, 'aria-label': t('opp.description') })),
  h(Field, { label: t('opp.proposer') }, h(TextInput, { value: proposer, onChange: setProposer, 'aria-label': t('opp.proposer') })),
  h(Field, { label: t('opp.domain') }, h(Select, {
    value: domain,
    onChange: setDomain,
    'aria-label': t('opp.domain'),
    options: DOMAINS.map(value => ({ value, label: t(`domain.${value}`) })),
  })),
  h(Field, { label: t('opp.taskType') }, h(Select, {
    value: taskType,
    onChange: setTaskType,
    'aria-label': t('opp.taskType'),
    options: TASK_TYPES.map(value => ({ value, label: t(`task.${value}`) })),
  })),
  h(Field, { label: t('opp.compliance') }, h(Select, {
    value: compliance,
    onChange: setCompliance,
    'aria-label': t('opp.compliance'),
    options: COMPLIANCE_LEVELS.map(value => ({ value, label: t(`compliance.${value}`) })),
  })))
}

/** Model assessment panel with explicit apply. */
function AssessPanel(props) {
  const { store, t, opportunity, derived, aiStatus } = props
  const [running, setRunning] = useState(false)
  const [text, setText] = useState('')
  const [suggestion, setSuggestion] = useState(null)
  const [invalid, setInvalid] = useState([])
  const [error, setError] = useState(null)
  const [controller, setController] = useState(null)

  async function run() {
    setRunning(true)
    setError(null)
    setText('')
    setSuggestion(null)
    setInvalid([])
    const next = new AbortController()
    setController(next)
    try {
      const final = await store.runAi('opportunity.assess', { opportunityId: opportunity.id }, {
        signal: next.signal,
        onDelta: delta => setText(current => current + delta),
      })
      if (final?.result !== undefined) setSuggestion(final.result)
      setInvalid(Array.isArray(final?.invalid) ? final.invalid : [])
    } catch (value) {
      if (value?.name !== 'AbortError' && value?.code !== 'ai/cancelled') {
        setError(value)
        if (value?.details?.cause === 'MISSING_CREDENTIAL') void store.refresh()
      }
    } finally {
      setRunning(false)
      setController(null)
    }
  }

  function apply() {
    if (suggestion === null) return
    void store.mutate({
      op: 'opportunity.update',
      opportunityId: opportunity.id,
      ratings: { ...opportunity.ratings, ...suggestion.ratings },
      compliance: suggestion.compliance ?? opportunity.compliance,
    }).then(() => {
      setSuggestion(null)
      setText('')
    }).catch(() => {})
  }

  const available = aiStatus?.available === true
  return h('section', { className: 'fdw-card' },
    h(SectionHead, {
      title: t('score.title'),
      hint: available ? t('ai.model') : aiReasonText(t, aiStatus?.reason),
      action: h(Button, {
        size: 'sm',
        variant: 'primary',
        disabled: !available || running,
        onClick: run,
        title: available ? undefined : aiReasonText(t, aiStatus?.reason),
      }, h(SparkIcon), running ? t('opp.aiRunning') : t('opp.aiAssess')),
    }),
    h(ScoreCard, { t, derived }),
    running ? h('div', { className: 'fdw-inline-actions' },
      h('p', { className: 'fdw-hint' }, t('assistant.thinking')),
      h(Button, { size: 'sm', onClick: () => controller?.abort() }, t('common.stop'))) : null,
    running && text !== '' ? h('pre', { className: 'fdw-ai-text' }, text) : null,
    error === null ? null : h('p', { className: 'fdw-error', role: 'alert' }, errorText(t, error?.code, error?.details?.cause)),
    suggestion === null ? null : h('div', { className: 'fdw-ai-result' },
      h('h4', { className: 'fdw-ai-result-title' }, t('opp.aiSuggested')),
      h('div', { className: 'fdw-ai-grid' }, DIMENSIONS.map(dimension => h('div', { key: dimension.key, className: 'fdw-ai-cell' },
        h('span', { className: 'fdw-hint' }, t(`score.dimension.${dimension.key}`)),
        h('span', null, `${t('opp.aiCurrent')} ${opportunity.ratings[dimension.key]} → ${suggestion.ratings[dimension.key] ?? opportunity.ratings[dimension.key]}`)))),
      h('p', { className: 'fdw-hint' }, `${t('opp.compliance')}: ${t(`compliance.${opportunity.compliance}`)} → ${t(`compliance.${suggestion.compliance ?? opportunity.compliance}`)}`),
      suggestion.rationale === '' ? null : h('p', { className: 'fdw-ai-rationale' }, suggestion.rationale),
      suggestion.conditions.length === 0 ? null : h('div', null,
        h('h4', { className: 'fdw-ai-result-title' }, t('opp.aiConditions')),
        h('ul', { className: 'fdw-score-notes' }, suggestion.conditions.map((item, index) => h('li', { key: index }, item)))),
      invalid.length === 0 ? null : h('p', { className: 'fdw-error' }, t('opp.aiInvalid')),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', variant: 'primary', onClick: apply }, t('opp.aiApply')),
        h(Button, { size: 'sm', variant: 'ghost', onClick: () => { setSuggestion(null); setText('') } }, t('opp.aiIgnore')))))
}

/** One opportunity detail. */
function OpportunityDetail(props) {
  const { store, t, snapshot, opportunity } = props
  const state = snapshot.state
  const [title, setTitle] = useState(opportunity.title)
  const [description, setDescription] = useState(opportunity.description)
  const [proposer, setProposer] = useState(opportunity.proposer)
  const [domain, setDomain] = useState(opportunity.domain)
  const [taskType, setTaskType] = useState(opportunity.taskType)
  const [status, setStatus] = useState(opportunity.status)
  const [compliance, setCompliance] = useState(opportunity.compliance)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const derived = computeScore(opportunity.ratings, opportunity.compliance)
  const meeting = (state.meetings ?? []).find(item => item.id === opportunity.source.meetingId)

  useEffect(() => {
    setCompliance(opportunity.compliance)
  }, [opportunity.compliance])

  const save = () => {
    void store.mutate({
      op: 'opportunity.update',
      opportunityId: opportunity.id,
      title,
      description,
      proposer,
      domain,
      taskType,
      status,
      compliance,
    }).catch(() => {})
  }

  const setRating = (dimension, value) => {
    void store.mutate({
      op: 'opportunity.update',
      opportunityId: opportunity.id,
      ratings: { ...opportunity.ratings, [dimension]: value },
    }).catch(() => {})
  }

  return h('div', { className: 'fdw-section' },
    h('div', { className: 'fdw-detail-head' },
      h('div', { className: 'fdw-detail-heading' },
        h('button', { type: 'button', className: 'fdw-back', onClick: () => store.setView({ opportunityId: undefined }) }, `← ${t('common.back')}`),
        h('h2', { className: 'fdw-detail-title' }, opportunity.title),
        h('div', { className: 'fdw-inline-actions' },
          h(Badge, { tone: verdictTone(derived.verdict) }, `${derived.score} · ${t(`verdict.${derived.verdict}`)}`),
          h(Badge, { tone: 'muted' }, t(`opp.status.${opportunity.status}`)))),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', onClick: save }, t('common.save')),
        h(Button, { size: 'sm', variant: 'danger', onClick: () => setDeleteOpen(true) }, h(TrashIcon), t('common.delete')))),
    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(Field, { label: t('opp.title') }, h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('opp.title') })),
        h(Field, { label: t('opp.description') }, h(TextArea, { value: description, onChange: setDescription, rows: 4, 'aria-label': t('opp.description') })),
        h(Field, { label: t('opp.proposer') }, h(TextInput, { value: proposer, onChange: setProposer, 'aria-label': t('opp.proposer') })),
        h(Field, { label: t('opp.domain') }, h(Select, {
          value: domain,
          onChange: setDomain,
          'aria-label': t('opp.domain'),
          options: DOMAINS.map(value => ({ value, label: t(`domain.${value}`) })),
        })),
        h(Field, { label: t('opp.taskType') }, h(Select, {
          value: taskType,
          onChange: setTaskType,
          'aria-label': t('opp.taskType'),
          options: TASK_TYPES.map(value => ({ value, label: t(`task.${value}`) })),
        })),
        h(Field, { label: t('opp.statusLabel') }, h(Select, {
          value: status,
          onChange: setStatus,
          'aria-label': t('opp.statusLabel'),
          options: OPP_STATUSES.map(value => ({ value, label: t(`opp.status.${value}`) })),
        })),
        h(Field, { label: t('opp.compliance') }, h(Select, {
          value: compliance,
          onChange: setCompliance,
          'aria-label': t('opp.compliance'),
          options: COMPLIANCE_LEVELS.map(value => ({ value, label: t(`compliance.${value}`) })),
        })),
        h(Field, { label: t('opp.source') }, opportunity.source.type === 'meeting'
          ? (meeting === undefined
            ? h('p', { className: 'fdw-hint' }, t('meeting.deletedSource'))
            : h('button', {
              type: 'button',
              className: 'fdw-link-button',
              onClick: () => store.setView({ section: 'meetings', meetingId: meeting.id }),
            }, meeting.title))
          : h('span', { className: 'fdw-hint' }, t(`source.${opportunity.source.type}`)))),
      h('div', null,
        h(AssessPanel, { store, t, opportunity, derived, aiStatus: snapshot.ai }),
        h('section', { className: 'fdw-card' },
          h(SectionHead, { title: t('opp.ratings'), hint: t('opp.adoptionHint') }),
          h(RatingEditor, { t, ratings: opportunity.ratings, onChange: setRating })))),
    h(ConfirmDialog, {
      open: deleteOpen,
      title: t('opp.deleteTitle'),
      body: t('opp.deleteBody'),
      confirmLabel: t('confirm.deleteOpportunity'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setDeleteOpen(false),
      onConfirm: () => {
        setDeleteOpen(false)
        void store.mutate({ op: 'opportunity.delete', opportunityId: opportunity.id }).then(() => store.setView({ opportunityId: undefined })).catch(() => {})
      },
    }))
}

/** Opportunity library or detail. */
export function OpportunitiesSection(props) {
  const { store, t, snapshot } = props
  const state = snapshot.state
  const [query, setQuery] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  if (snapshot.view.opportunityId !== undefined) {
    const opportunity = (state.opportunities ?? []).find(item => item.id === snapshot.view.opportunityId)
    if (opportunity === undefined) return h(EmptyState, { title: t('opp.empty') })
    return h(OpportunityDetail, { key: opportunity.id, store, t, snapshot, opportunity })
  }

  const items = query === '' && domainFilter === '' && statusFilter === ''
    ? filterOpportunities(state)
    : filterOpportunities(state, { query, domain: domainFilter, status: statusFilter })
  return h('div', { className: 'fdw-section' },
    h(SectionHead, {
      title: t('opp.library'),
      hint: t('opp.count', { count: items.length }),
      action: h(Button, { variant: 'primary', size: 'sm', onClick: () => setFormOpen(true) }, h(PlusIcon), t('opp.new')),
    }),
    h('div', { className: 'fdw-filters' },
      h(TextInput, { value: query, onChange: setQuery, placeholder: t('opp.searchPlaceholder'), 'aria-label': t('common.search') }),
      h(Select, {
        value: domainFilter,
        onChange: setDomainFilter,
        'aria-label': t('opp.filterDomain'),
        options: [{ value: '', label: t('common.all') }, ...DOMAINS.map(value => ({ value, label: t(`domain.${value}`) }))],
      }),
      h(Select, {
        value: statusFilter,
        onChange: setStatusFilter,
        'aria-label': t('opp.filterStatus'),
        options: [{ value: '', label: t('common.all') }, ...OPP_STATUSES.map(value => ({ value, label: t(`opp.status.${value}`) }))],
      })),
    items.length === 0
      ? h(EmptyState, {
        title: t('opp.empty'),
        body: t('opp.emptyBody'),
        action: h(Button, { variant: 'primary', onClick: () => setFormOpen(true) }, h(PlusIcon), t('opp.new')),
      })
      : h('div', { className: 'fdw-card-grid' }, items.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'fdw-record-card fdw-opp-card',
        onClick: () => store.setView({ section: 'opportunities', opportunityId: item.id }),
      },
      h('div', { className: 'fdw-record-head' },
        h('span', { className: 'fdw-record-title' }, item.title),
        h(Badge, { tone: verdictTone(item.derived.verdict) }, `${item.derived.score}`)),
      h('p', { className: 'fdw-record-sub' }, `${t(`domain.${item.domain}`)} · ${t(`task.${item.taskType}`)}`),
      h('p', { className: 'fdw-record-sub' }, `${t(`verdict.${item.derived.verdict}`)} · ${t(`opp.status.${item.status}`)}`)))),
    h(OpportunityForm, {
      open: formOpen,
      t,
      state,
      initial: undefined,
      onClose: () => setFormOpen(false),
      onSubmit: values => {
        setFormOpen(false)
        void store.mutate({ op: 'opportunity.create', ...values }).then(data => {
          if (typeof data?.result?.opportunityId === 'string') store.setView({ section: 'opportunities', opportunityId: data.result.opportunityId })
        }).catch(() => {})
      },
    }))
}
