/** Markdown body editor with dirty state, hash guard, and external-change handling. */
import { useEffect, useState } from 'react'
import { useWorkbench } from './hooks.js'
import { Button, InlineError, Spinner, TextArea, h } from './common.js'

/**
 * Own one body's draft. The host hash is the version token; a change made by an
 * agent or another tab while the draft is dirty becomes an explicit choice.
 */
export function useBodyEditor(store, path, options = {}) {
  const snapshot = useWorkbench(store)
  const file = path === '' ? undefined : snapshot.files[path]
  const [draft, setDraftState] = useState('')
  const [baseHash, setBaseHash] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [conflict, setConflict] = useState(false)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (path === '') return undefined
    let alive = true
    setMissing(false)
    store.loadFile(path).catch(value => {
      if (!alive) return
      if (value?.code === 'file/not-found') {
        setMissing(true)
        setDraftState('')
        setBaseHash('')
        setDirty(false)
        setError(null)
      } else {
        setError(value?.code ?? 'file/read')
      }
    })
    return () => {
      alive = false
    }
  }, [store, path])

  useEffect(() => {
    if (path === '' || snapshot.status !== 'ready') return undefined
    store.loadFile(path, { force: true }).catch(() => {})
    return undefined
  }, [snapshot.refreshToken, path, store])

  useEffect(() => {
    if (file?.status === 'ready' && !dirty) {
      setDraftState(file.text)
      // A never-written body has no version to guard; treat it as a create.
      setBaseHash(file.missing === true ? '' : file.hash)
      setMissing(file.missing === true)
      setError(null)
    }
  }, [file?.status, file?.hash, dirty])

  useEffect(() => {
    if (dirty && file?.status === 'ready' && baseHash !== '' && file.hash !== baseHash) setConflict(true)
  }, [dirty, baseHash, file?.hash, file?.status])

  useEffect(() => {
    if (path === '') return undefined
    store.setDirty(path, dirty)
    return () => store.setDirty(path, false)
  }, [store, path, dirty])

  const setDraft = value => {
    setDraftState(value)
    setDirty(true)
  }

  async function save() {
    if (path === '') return false
    setSaving(true)
    setError(null)
    try {
      if (typeof options.onSave === 'function') {
        await options.onSave(draft)
        setDirty(false)
        setConflict(false)
        return true
      }
      const data = await store.saveFile(path, draft, baseHash)
      setBaseHash(data.hash)
      setDirty(false)
      setConflict(false)
      return true
    } catch (value) {
      if (value?.status === 409) setConflict(true)
      else setError(value?.code ?? 'file/read')
      return false
    } finally {
      setSaving(false)
    }
  }

  function keepLocal() {
    if (file?.status === 'ready') setBaseHash(file.hash)
    setConflict(false)
  }

  async function loadExternal() {
    await store.loadFile(path, { force: true })
    const next = store.getSnapshot().files[path]
    if (next?.status === 'ready') {
      setDraftState(next.text)
      setBaseHash(next.hash)
      setDirty(false)
      setConflict(false)
    }
  }

  return {
    file,
    missing,
    draft,
    setDraft,
    dirty,
    saving,
    error,
    conflict,
    save,
    keepLocal,
    loadExternal,
  }
}

/** Editor block reused for notes, minutes, research, and document bodies. */
export function BodyEditor(props) {
  const { store, t, path, label, placeholder, rows = 12, readOnly = false, onSave } = props
  const editor = useBodyEditor(store, path, { onSave })
  if (path === '') {
    return h('p', { className: 'fdw-hint' }, t('file.empty'))
  }
  return h('div', { className: 'fdw-body-editor' },
    h('div', { className: 'fdw-body-head' },
      h('span', { className: editor.dirty ? 'fdw-body-state fdw-body-state--dirty' : 'fdw-body-state' },
        editor.missing && editor.draft === ''
          ? t('file.empty')
          : editor.dirty ? t('file.unsaved') : t('file.saved')),
      h(Button, { onClick: editor.save, disabled: readOnly || editor.saving || !editor.dirty, size: 'sm' },
        editor.saving ? t('file.saving') : t('file.save'))),
    editor.conflict
      ? h('div', { className: 'fdw-conflict', role: 'alert' },
        h('p', { className: 'fdw-conflict-title' }, t('file.conflictTitle')),
        h('p', { className: 'fdw-hint' }, t('file.conflictBody')),
        h('div', { className: 'fdw-inline-actions' },
          h(Button, { size: 'sm', onClick: editor.keepLocal }, t('file.keepLocal')),
          h(Button, { size: 'sm', variant: 'primary', onClick: editor.loadExternal }, t('file.loadExternal'))))
      : null,
    editor.error === null ? null : h(InlineError, null, t('error.generic')),
    editor.file?.status === 'loading' && !editor.missing
      ? h(Spinner, { label: t('file.loading') })
      : h(TextArea, {
        value: editor.draft,
        onChange: editor.setDraft,
        rows,
        disabled: readOnly,
        placeholder: placeholder ?? '',
        'aria-label': label,
      }))}
