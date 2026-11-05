/**
 * Shared controls with accessible names and one visual language.
 *
 * No UI library: every control is a small function component so the bundle
 * stays dependency-free and the stylesheet can own the theme tokens.
 */
import { createElement, Fragment as ReactFragment, useEffect, useRef } from 'react'

export const h = createElement
export const Fragment = ReactFragment

/** Join class names, skipping falsy entries. */
export function cx(...values) {
  return values.filter(Boolean).join(' ')
}

/** A labelled button; `iconOnly` requires `label` for screen readers. */
export function Button(props) {
  const { variant = 'default', size = 'md', label, iconOnly = false, type = 'button', disabled, onClick, children, title } = props
  return h('button', {
    type,
    className: cx('fdw-btn', variant !== 'default' && `fdw-btn--${variant}`, size === 'sm' && 'fdw-btn--sm', iconOnly && 'fdw-btn--icon'),
    'aria-label': iconOnly ? label : undefined,
    title: title ?? (iconOnly ? label : undefined),
    disabled,
    onClick,
  }, children)
}

/** A compact icon button. */
export function IconButton(props) {
  return h(Button, { ...props, iconOnly: true, variant: props.variant ?? 'ghost', size: 'sm' })
}

/** One labelled form row. */
export function Field(props) {
  const { label, hint, children, required = false, id } = props
  return h('label', { className: 'fdw-field', htmlFor: id },
    h('span', { className: 'fdw-label' }, label, required ? h('span', { className: 'fdw-required', 'aria-hidden': 'true' }, ' *') : null),
    children,
    hint === undefined ? null : h('span', { className: 'fdw-hint' }, hint))
}

/** Single-line text input. */
export function TextInput(props) {
  return h('input', {
    className: cx('fdw-input', props.className),
    type: props.type ?? 'text',
    value: props.value,
    placeholder: props.placeholder,
    id: props.id,
    disabled: props.disabled,
    maxLength: props.maxLength,
    'aria-label': props['aria-label'],
    onChange: event => props.onChange?.(event.target.value),
    onKeyDown: props.onKeyDown,
  })
}

/** Multi-line text input. */
export function TextArea(props) {
  return h('textarea', {
    className: cx('fdw-textarea', props.className),
    value: props.value,
    placeholder: props.placeholder,
    id: props.id,
    rows: props.rows ?? 6,
    disabled: props.disabled,
    spellCheck: props.spellCheck ?? false,
    'aria-label': props['aria-label'],
    onChange: event => props.onChange?.(event.target.value),
  })
}

/** Select with `{value,label}` options. */
export function Select(props) {
  return h('select', {
    className: cx('fdw-select', props.className),
    value: props.value,
    id: props.id,
    disabled: props.disabled,
    'aria-label': props['aria-label'],
    onChange: event => props.onChange?.(event.target.value),
  }, (props.options ?? []).map(option => h('option', { key: option.value, value: option.value }, option.label)))
}

/** Small status pill. */
export function Badge(props) {
  return h('span', { className: cx('fdw-badge', `fdw-badge--${props.tone ?? 'muted'}`) }, props.children)
}

/** One metric tile. */
export function Metric(props) {
  return h('div', { className: 'fdw-metric' },
    h('span', { className: 'fdw-metric-value' }, String(props.value)),
    h('span', { className: 'fdw-metric-label' }, props.label))
}

/** Centered empty state with an optional action. */
export function EmptyState(props) {
  return h('div', { className: 'fdw-empty' },
    h('p', { className: 'fdw-empty-title' }, props.title),
    props.body === undefined ? null : h('p', { className: 'fdw-empty-body' }, props.body),
    props.action === undefined ? null : h('div', { className: 'fdw-empty-action' }, props.action))
}

/** Busy indicator with a live label. */
export function Spinner(props) {
  return h('span', { className: 'fdw-spinner', role: 'status' }, h('span', { className: 'fdw-spinner-dot', 'aria-hidden': 'true' }), props.label)
}

/** Inline error line. */
export function InlineError(props) {
  return h('p', { className: 'fdw-error', role: 'alert' }, props.children)
}

/** A modal dialog with Escape and focus restoration. */
export function Modal(props) {
  const { open, title, onClose, children, footer } = props
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const previous = typeof document === 'undefined' ? null : document.activeElement
    const onKey = event => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const first = panel.current?.querySelector('button, input, select, textarea')
    first?.focus?.()
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous !== null && typeof previous.focus === 'function') previous.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return h('div', { className: 'fdw-overlay', role: 'presentation', onClick: event => { if (event.target === event.currentTarget) onClose?.() } },
    h('div', {
      className: 'fdw-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      ref: panel,
    },
      h('div', { className: 'fdw-dialog-head' },
        h('h3', { className: 'fdw-dialog-title' }, title),
        h(IconButton, { label: props.closeLabel ?? 'Close', onClick: onClose }, '×')),
      h('div', { className: 'fdw-dialog-body' }, children),
      footer === undefined ? null : h('div', { className: 'fdw-dialog-foot' }, footer)))
}

/** Two-step confirmation: the only way a dialog's action runs. */
export function ConfirmDialog(props) {
  const { open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel, tone = 'danger' } = props
  return h(Modal, {
    open,
    title,
    onClose: onCancel,
    closeLabel: cancelLabel,
    footer: [
      h(Button, { key: 'cancel', onClick: onCancel }, cancelLabel),
      h(Button, { key: 'confirm', variant: tone, onClick: onConfirm }, confirmLabel),
    ],
  }, h('p', { className: 'fdw-dialog-text' }, body))
}

/** Section heading with an optional action. */
export function SectionHead(props) {
  return h('div', { className: 'fdw-section-head' },
    h('div', null,
      h('h3', { className: 'fdw-section-title' }, props.title),
      props.hint === undefined ? null : h('p', { className: 'fdw-section-hint' }, props.hint)),
    props.action)
}

/** Thin progress bar. */
export function Progress(props) {
  const value = Math.max(0, Math.min(100, props.value ?? 0))
  return h('div', { className: 'fdw-progress', role: 'progressbar', 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('span', { className: 'fdw-progress-bar', style: { width: `${value}%` } }))
}

/** A toolbar row. */
export function Toolbar(props) {
  return h('div', { className: 'fdw-toolbar' }, props.children)
}
