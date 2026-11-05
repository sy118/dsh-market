/** Create/edit project dialog with delivery metadata and date validation. */
import { useState } from 'react'
import { Button, Field, Modal, TextArea, TextInput, h } from './common.js'

/** Controlled project form. */
export function ProjectForm(props) {
  const { open, t, initial, onClose, onSubmit } = props
  const [name, setName] = useState(initial?.name ?? '')
  const [customer, setCustomer] = useState(initial?.customer ?? '')
  const [owner, setOwner] = useState(initial?.owner ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? initial?.targetDate ?? '')
  const [successCriteria, setSuccessCriteria] = useState(initial?.successCriteria ?? '')
  const [stakeholders, setStakeholders] = useState(initial?.stakeholders ?? '')
  const [error, setError] = useState('')

  function submit() {
    if (name.trim() === '') return
    if (startDate !== '' && endDate !== '' && endDate < startDate) {
      setError(t('project.dateOrder'))
      return
    }
    setError('')
    onSubmit({
      name: name.trim(),
      customer,
      owner,
      startDate,
      endDate,
      targetDate: endDate,
      successCriteria,
      stakeholders,
    })
  }

  return h(Modal, {
    open,
    title: initial === undefined ? t('project.newTitle') : t('project.editTitle'),
    onClose,
    footer: [
      h(Button, { key: 'cancel', onClick: onClose }, t('common.cancel')),
      h(Button, { key: 'save', variant: 'primary', disabled: name.trim() === '', onClick: submit }, t('common.save')),
    ],
  },
  h(Field, { label: t('project.name'), required: true },
    h(TextInput, { value: name, onChange: setName, placeholder: t('project.namePlaceholder'), 'aria-label': t('project.name') })),
  h('div', { className: 'fdw-columns' },
    h(Field, { label: t('project.customer') },
      h(TextInput, { value: customer, onChange: setCustomer, 'aria-label': t('project.customer') })),
    h(Field, { label: t('project.owner') },
      h(TextInput, { value: owner, onChange: setOwner, 'aria-label': t('project.owner') }))),
  h('div', { className: 'fdw-columns' },
    h(Field, { label: t('project.startDate') },
      h(TextInput, { type: 'date', value: startDate, onChange: setStartDate, 'aria-label': t('project.startDate') })),
    h(Field, { label: t('project.endDate') },
      h(TextInput, { type: 'date', value: endDate, onChange: setEndDate, 'aria-label': t('project.endDate') }))),
  h(Field, { label: t('project.successCriteria'), hint: t('project.successHint') },
    h(TextArea, { value: successCriteria, onChange: setSuccessCriteria, rows: 3, 'aria-label': t('project.successCriteria') })),
  h(Field, { label: t('project.stakeholders'), hint: t('project.stakeholdersHint') },
    h(TextArea, { value: stakeholders, onChange: setStakeholders, rows: 3, 'aria-label': t('project.stakeholders') })),
  error === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, error))
}
