/** Streaming AI draft panel used by research, documents, and stage review. */
import { useRef, useState } from 'react'
import { Button, InlineError, Spinner, h } from './common.js'
import { SparkIcon } from './icons.js'
import { errorText } from './error-text.js'

/**
 * Run one Markdown-producing task and offer the result for explicit insertion.
 * @param {object} props - store, t, task, payload, labels, and onApply.
 */
export function AiDraftPanel(props) {
  const { store, t, task, payload, runLabel, applyLabel, onApply, disabled = false } = props
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [applied, setApplied] = useState(false)
  const controller = useRef(null)

  async function run() {
    setRunning(true)
    setError(null)
    setText('')
    setApplied(false)
    controller.current = new AbortController()
    try {
      const final = await store.runAi(task, payload, {
        signal: controller.current.signal,
        onDelta: delta => setText(current => current + delta),
      })
      const markdown = final?.result?.markdown
      if (typeof markdown === 'string' && markdown !== '') setText(markdown)
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

  function stop() {
    controller.current?.abort()
    setRunning(false)
  }

  async function apply() {
    if (text.trim() === '' || typeof onApply !== 'function') return
    await onApply(text)
    setApplied(true)
  }

  return h('div', { className: 'fdw-ai-panel' },
    h('div', { className: 'fdw-inline-actions' },
      h(Button, {
        size: 'sm',
        variant: 'primary',
        onClick: run,
        disabled: disabled || running,
      }, h(SparkIcon), running ? t('assistant.thinking') : runLabel),
      running ? h(Button, { size: 'sm', onClick: stop }, t('common.stop')) : null),
    error === null ? null : h(InlineError, null, errorText(t, error?.code, error?.details?.cause)),
    running && text === '' ? h(Spinner, { label: t('assistant.thinking') }) : null,
    text === '' ? null : h('pre', { className: 'fdw-ai-text' }, text),
    text === '' ? null : h('div', { className: 'fdw-inline-actions' },
      h(Button, { size: 'sm', onClick: apply, disabled: running || applied }, applied ? t('common.saved') : applyLabel),
      h(Button, { size: 'sm', variant: 'ghost', onClick: () => { setText(''); setApplied(false) } }, t('common.ignore'))))
}
