/** Meetings: minutes editor, AI candidate extraction, and confirmed import. */
import { useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  TextArea,
  TextInput,
  h,
} from './common.js'
import { BodyEditor } from './body-editor.js'
import { SparkIcon, PlusIcon, TrashIcon } from './icons.js'
import { errorText, aiReasonText } from './error-text.js'
import { opportunitiesOfMeeting, sortedMeetings } from '../selectors.js'

/** Create-meeting dialog. */
function MeetingForm(props) {
  const { open, t, onClose, onSubmit } = props
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [attendees, setAttendees] = useState('')
  const [content, setContent] = useState('')
  return h(Modal, {
    open,
    title: t('meeting.newTitle'),
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, t('common.cancel')),
      h(Button, { key: 'save', variant: 'primary', disabled: title.trim() === '', onClick: () => onSubmit({ title: title.trim(), date, attendees, content }) }, t('common.save')),
    ],
  },
  h(Field, { label: t('meeting.title'), required: true }, h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('meeting.title') })),
  h(Field, { label: t('meeting.date') }, h(TextInput, { value: date, onChange: setDate, type: 'date', 'aria-label': t('meeting.date') })),
  h(Field, { label: t('meeting.attendees'), hint: t('meeting.attendeesHint') }, h(TextInput, { value: attendees, onChange: setAttendees, 'aria-label': t('meeting.attendees') })),
  h(Field, { label: t('meeting.minutes') }, h(TextArea, { value: content, onChange: setContent, rows: 8, placeholder: t('meeting.minutesPlaceholder'), 'aria-label': t('meeting.minutes') })))
}

/** Candidate list produced by one extraction. */
function CandidateList(props) {
  const { t, candidates, selected, onToggle, onSelectAll, onClear } = props
  if (candidates.length === 0) return h('p', { className: 'fdw-hint' }, t('meeting.noCandidates'))
  return h('div', { className: 'fdw-candidates' },
    h('div', { className: 'fdw-inline-actions' },
      h(Button, { size: 'sm', variant: 'ghost', onClick: onSelectAll }, t('meeting.selectAll')),
      h(Button, { size: 'sm', variant: 'ghost', onClick: onClear }, t('meeting.clearSelection'))),
    h('ul', { className: 'fdw-candidate-list' }, candidates.map((candidate, index) => h('li', { key: `${candidate.title}-${index}`, className: 'fdw-candidate' },
      h('input', {
        type: 'checkbox',
        checked: selected.includes(index),
        onChange: () => onToggle(index),
        'aria-label': candidate.title,
      }),
      h('div', { className: 'fdw-candidate-body' },
        h('span', { className: 'fdw-candidate-title' }, candidate.title),
        h('blockquote', { className: 'fdw-quote' }, candidate.quote),
        h('div', { className: 'fdw-inline-actions' },
          h(Badge, { tone: 'muted' }, t(`domain.${candidate.domain}`)),
          h(Badge, { tone: 'muted' }, t(`task.${candidate.taskType}`)),
          h(Badge, { tone: candidate.confidence >= 0.7 ? 'ok' : 'warn' }, `${Math.round(candidate.confidence * 100)}%`)))))))
}

/** One meeting detail. */
function MeetingDetail(props) {
  const { store, t, snapshot, meeting } = props
  const state = snapshot.state
  const [title, setTitle] = useState(meeting.title)
  const [date, setDate] = useState(meeting.date)
  const [attendees, setAttendees] = useState(meeting.attendees.join(', '))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [selected, setSelected] = useState([])
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [controller, setController] = useState(null)
  const [attempted, setAttempted] = useState(false)
  const linked = opportunitiesOfMeeting(state, meeting.id)

  const save = () => {
    void store.mutate({
      op: 'meeting.update',
      meetingId: meeting.id,
      title,
      date,
      attendees: attendees.split(',').map(item => item.trim()).filter(Boolean),
    }).catch(() => {})
  }

  async function extract() {
    setRunning(true)
    setError(null)
    setAttempted(true)
    setCandidates([])
    setSelected([])
    setText('')
    const next = new AbortController()
    setController(next)
    try {
      const final = await store.runAi('meeting.extract', { meetingId: meeting.id }, {
        signal: next.signal,
        onDelta: delta => setText(current => current + delta),
      })
      const list = final?.result?.candidates
      setCandidates(Array.isArray(list) ? list : [])
      setSelected(Array.isArray(list) ? list.map((_, index) => index) : [])
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

  function stop() {
    controller?.abort()
    setRunning(false)
  }

  async function addSelected() {
    const chosen = selected.map(index => candidates[index]).filter(Boolean)
    if (chosen.length === 0) return
    for (const candidate of chosen) {
      await store.mutate({
        op: 'opportunity.create',
        title: candidate.title,
        description: candidate.quote,
        domain: candidate.domain,
        taskType: candidate.taskType,
        source: { type: 'meeting', meetingId: meeting.id },
      }).catch(() => {})
    }
    store.notify('meeting.addedToast', { params: { count: chosen.length } })
    setCandidates([])
    setSelected([])
    setText('')
  }

  return h('div', { className: 'fdw-section' },
    h('div', { className: 'fdw-detail-head' },
      h('div', { className: 'fdw-detail-heading' },
        h('button', { type: 'button', className: 'fdw-back', onClick: () => store.setView({ meetingId: undefined }) }, `← ${t('common.back')}`),
        h('h2', { className: 'fdw-detail-title' }, meeting.title),
        h('p', { className: 'fdw-hint' }, meeting.date)),
      h('div', { className: 'fdw-inline-actions' },
        h(Button, { size: 'sm', onClick: save }, t('common.save')),
        h(Button, { size: 'sm', variant: 'danger', onClick: () => setDeleteOpen(true) }, h(TrashIcon), t('common.delete')))),
    h('div', { className: 'fdw-columns' },
      h('section', { className: 'fdw-card' },
        h(Field, { label: t('meeting.title') }, h(TextInput, { value: title, onChange: setTitle, 'aria-label': t('meeting.title') })),
        h(Field, { label: t('meeting.date') }, h(TextInput, { value: date, onChange: setDate, type: 'date', 'aria-label': t('meeting.date') })),
        h(Field, { label: t('meeting.attendees'), hint: t('meeting.attendeesHint') }, h(TextInput, { value: attendees, onChange: setAttendees, 'aria-label': t('meeting.attendees') })),
        h(Field, { label: t('meeting.minutes') }, h(BodyEditor, { store, t, path: meeting.file, label: t('meeting.minutes'), rows: 16 }))),
      h('div', null,
        h('section', { className: 'fdw-card' },
          h(SectionHead, {
            title: t('meeting.candidates'),
            hint: snapshot.ai?.available === true ? undefined : aiReasonText(t, snapshot.ai?.reason),
            action: h(Button, {
              size: 'sm',
              variant: 'primary',
              disabled: snapshot.ai?.available !== true || running,
              onClick: extract,
            }, h(SparkIcon), running ? t('meeting.extracting') : t('meeting.extract')),
          }),
          running ? h('p', { className: 'fdw-hint' }, t('assistant.thinking')) : null,
          running && text !== '' ? h('pre', { className: 'fdw-ai-text' }, text) : null,
          running ? h(Button, { size: 'sm', onClick: stop }, t('common.stop')) : null,
          error === null ? null : h('p', { className: 'fdw-error', role: 'alert' }, errorText(t, error?.code, error?.details?.cause)),
          candidates.length > 0
            ? h(CandidateList, {
              t,
              candidates,
              selected,
              onToggle: index => setSelected(current => (current.includes(index) ? current.filter(item => item !== index) : [...current, index])),
              onSelectAll: () => setSelected(candidates.map((_, index) => index)),
              onClear: () => setSelected([]),
            })
            : attempted && !running && error === null
              ? h('p', { className: 'fdw-hint' }, t('meeting.noCandidates'))
              : attempted || running
                ? null
                : h('p', { className: 'fdw-hint' }, t('meeting.aiEmpty')),
          candidates.length === 0 ? null : h(Button, { variant: 'primary', onClick: addSelected, disabled: selected.length === 0 },
            t('meeting.addSelected'))),
        h('section', { className: 'fdw-card' },
          h(SectionHead, { title: t('meeting.sourceLabel') }),
          linked.length === 0
            ? h('p', { className: 'fdw-hint' }, t('common.empty'))
            : h('ul', { className: 'fdw-rows' }, linked.map(item => h('li', { key: item.id, className: 'fdw-row' },
              h('button', { type: 'button', className: 'fdw-link-button', onClick: () => store.setView({ section: 'opportunities', opportunityId: item.id }) }, item.title),
              h(Badge, { tone: item.derived.verdict === 'pilot' ? 'ok' : item.derived.verdict === 'hold' ? 'bad' : 'warn' }, `${item.derived.score}`))))))),
    h(ConfirmDialog, {
      open: deleteOpen,
      title: t('meeting.deleteTitle'),
      body: t('meeting.deleteBody'),
      confirmLabel: t('confirm.deleteMeeting'),
      cancelLabel: t('common.cancel'),
      onCancel: () => setDeleteOpen(false),
      onConfirm: () => {
        setDeleteOpen(false)
        void store.mutate({ op: 'meeting.delete', meetingId: meeting.id }).then(() => store.setView({ meetingId: undefined })).catch(() => {})
      },
    }))
}

/** Meetings list or detail. */
export function MeetingsSection(props) {
  const { store, t, snapshot } = props
  const state = snapshot.state
  const [formOpen, setFormOpen] = useState(false)

  if (snapshot.view.meetingId !== undefined) {
    const meeting = (state.meetings ?? []).find(item => item.id === snapshot.view.meetingId)
    if (meeting === undefined) return h(EmptyState, { title: t('meeting.empty') })
    return h(MeetingDetail, { key: meeting.id, store, t, snapshot, meeting })
  }

  const items = sortedMeetings(state)
  return h('div', { className: 'fdw-section' },
    h(SectionHead, {
      title: t('meeting.list'),
      hint: `${items.length} ${t('common.items')}`,
      action: h(Button, { variant: 'primary', size: 'sm', onClick: () => setFormOpen(true) }, h(PlusIcon), t('meeting.new')),
    }),
    items.length === 0
      ? h(EmptyState, {
        title: t('meeting.empty'),
        body: t('meeting.emptyBody'),
        action: h(Button, { variant: 'primary', onClick: () => setFormOpen(true) }, h(PlusIcon), t('meeting.new')),
      })
      : h('div', { className: 'fdw-card-grid' }, items.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'fdw-record-card',
        onClick: () => store.setView({ section: 'meetings', meetingId: item.id }),
      },
      h('div', { className: 'fdw-record-head' },
        h('span', { className: 'fdw-record-title' }, item.title),
        h(Badge, { tone: 'muted' }, item.date || t('common.notSet'))),
      h('p', { className: 'fdw-record-sub' }, item.attendees.join(', ') || t('common.empty')),
      h('p', { className: 'fdw-record-sub' }, t('meeting.sourceLabel'))))),
    h(MeetingForm, {
      open: formOpen,
      t,
      onClose: () => setFormOpen(false),
      onSubmit: values => {
        setFormOpen(false)
        void store.mutate({
          op: 'meeting.create',
          title: values.title,
          date: values.date,
          attendees: values.attendees.split(',').map(item => item.trim()).filter(Boolean),
          content: values.content,
        }).then(data => {
          if (typeof data?.result?.meetingId === 'string') store.setView({ section: 'meetings', meetingId: data.result.meetingId })
        }).catch(() => {})
      },
    }))
}
