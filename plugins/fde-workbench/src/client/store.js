/**
 * The workbench store.
 *
 * One snapshot drives the React tree. Server state is authoritative: every
 * mutation replaces it with the response, a 409 reloads the whole state, and
 * an optimistic patch is rolled back when the host rejects the change.
 */
import * as defaultApi from './api.js'
import { ApiError } from './api.js'
import { pruneView } from './selectors.js'

/** Sections of the left navigation, in display order. */
export const SECTIONS = ['overview', 'projects', 'research', 'docs', 'opportunities', 'meetings']

/** The old plugin's browser key; read once and never deleted. */
export const LEGACY_KEY = 'dsh.fde-delivery-workbench.v1'

/** Marker written after a successful import. */
export const MIGRATION_FLAG = 'dsh.fde-workbench.migrated'

/** A fresh snapshot. */
export function initialSnapshot() {
  return {
    status: 'loading',
    error: null,
    state: null,
    revision: 0,
    refreshToken: 0,
    root: '',
    ai: { available: false, provider: '', model: '', reason: 'ai/no-llm' },
    readOnly: false,
    warnings: [],
    rootError: null,
    recovered: false,
    view: { section: 'overview' },
    files: {},
    dirtyPaths: [],
    busy: false,
    aiRunning: null,
    handoffBusy: false,
    migration: null,
    toast: null,
    lastLegacy: null,
  }
}

/** Tiny observable store with an external-store hook. */
export function createWorkbenchStore(options = {}) {
  const api = options.api ?? defaultApi
  const getLang = options.getLang ?? (() => 'zh')
  const openSession = options.openSession
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  const listeners = new Set()
  let snapshot = initialSnapshot()
  let timer
  let toastId = 0

  const locale = () => (getLang() === 'en' ? 'en' : 'zh')
  const emit = () => {
    for (const listener of listeners) listener()
  }
  const set = patch => {
    const next = typeof patch === 'function' ? patch(snapshot) : { ...snapshot, ...patch }
    if (next === snapshot) return
    snapshot = next
    emit()
  }

  /** Show one transient message. */
  function notify(code, options = {}) {
    toastId += 1
    const toast = { id: toastId, code, tone: options.tone ?? 'info', params: options.params ?? {} }
    set({ toast })
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      set(current => (current.toast?.id === toast.id ? { ...current, toast: null } : current))
    }, 4200)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  /** Merge one `/state` response. */
  function applyServerData(data, extra = {}) {
    set(current => ({
      ...current,
      ...extra,
      status: 'ready',
      error: null,
      state: data.state,
      revision: data.revision ?? data.state?.revision ?? 0,
      refreshToken: (current.refreshToken ?? 0) + 1,
      root: data.root ?? current.root,
      ai: data.ai ?? current.ai,
      readOnly: data.readOnly === true,
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      rootError: data.rootError ?? null,
      recovered: data.recovered === true,
      view: pruneView(current.view, data.state),
    }))
  }

  /** Read the old browser snapshot and import it once. */
  async function maybeImportLegacy() {
    if (storage === undefined) return undefined
    let raw
    try {
      raw = storage.getItem(LEGACY_KEY)
    } catch {
      return undefined
    }
    if (raw === null) return undefined
    if (storage.getItem(MIGRATION_FLAG) !== null) return undefined
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      set({ lastLegacy: { status: 'invalid' } })
      notify('migration.skipped')
      return undefined
    }
    try {
      const result = await api.legacyImport(parsed, snapshot.revision, locale())
      storage.setItem(MIGRATION_FLAG, new Date().toISOString())
      if (result.alreadyImported === true) {
        set({ lastLegacy: { status: 'already' } })
        return result
      }
      applyServerData(result)
      set({ lastLegacy: { status: 'imported', counts: result.counts } })
      notify('migration.done', { params: result.counts ?? {} })
      return result
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'internal'
      set({ lastLegacy: { status: 'failed', code } })
      notify('migration.skipped', { tone: 'warning' })
      return undefined
    }
  }

  /** Load or reload the state. */
  async function load(options = {}) {
    if (options.silent !== true) set({ status: snapshot.state === null ? 'loading' : snapshot.status })
    try {
      const data = await api.getState()
      applyServerData(data)
      if (options.skipMigration !== true) await maybeImportLegacy(data)
      return data
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'network/failed'
      set({ status: snapshot.state === null ? 'error' : snapshot.status, error: { code, message: error.message } })
      if (options.silent === true) notify('toast.refreshFailed', { tone: 'warning' })
      return undefined
    }
  }

  /** Reload without a loading flash. */
  function refresh() {
    return load({ silent: true, skipMigration: true })
  }

  /** Change the visible section or selection. */
  function setView(patch) {
    set(current => {
      const next = { ...current.view, ...patch }
      if (next.section !== undefined && !SECTIONS.includes(next.section)) next.section = 'projects'
      if (next.section !== 'projects') delete next.stage
      return { ...current, view: next }
    })
  }

  /** Apply one mutation; optional optimistic patch for a snappy toggle. */
  async function mutate(mutation, options = {}) {
    const before = snapshot
    if (typeof options.optimistic === 'function') {
      set(current => ({ ...current, state: options.optimistic(current.state), busy: true }))
    } else {
      set({ busy: true })
    }
    try {
      const data = await api.mutate(before.revision, mutation, locale())
      applyServerData(data)
      set({ busy: false })
      return data
    } catch (error) {
      if (error instanceof ApiError && error.code === 'state/conflict') {
        set({ busy: false })
        await refresh()
        notify('error.conflict', { tone: 'warning' })
      } else {
        set({ state: before.state, busy: false })
        notify(error?.code === 'file/conflict' ? 'file.conflictTitle' : 'error.generic', { tone: 'error' })
      }
      throw error
    }
  }

  /** Read one Markdown body. */
  async function loadFile(path, options = {}) {
    const cached = snapshot.files[path]
    if (cached !== undefined && cached.status === 'ready' && options.force !== true) return cached
    set(current => ({
      ...current,
      files: { ...current.files, [path]: { status: 'loading', text: '', hash: '', error: null } },
    }))
    try {
      const data = await api.readFile(path)
      const entry = {
        status: 'ready',
        text: data.text,
        hash: data.hash,
        bytes: data.bytes,
        missing: data.missing === true,
        error: null,
        loadedAt: Date.now(),
      }
      set(current => ({ ...current, files: { ...current.files, [path]: entry } }))
      return entry
    } catch (error) {
      const entry = { status: 'error', text: '', hash: '', error: error.code ?? 'file/read', loadedAt: Date.now() }
      set(current => ({ ...current, files: { ...current.files, [path]: entry } }))
      throw error
    }
  }

  /** Save one body; a 409 leaves the draft in place for the editor to resolve. */
  async function saveFile(path, content, baseHash) {
    try {
      const data = await api.writeFile(path, content, baseHash)
      set(current => ({
        ...current,
        files: { ...current.files, [path]: { status: 'ready', text: content, hash: data.hash, bytes: data.bytes, error: null, loadedAt: Date.now() } },
      }))
      notify('toast.fileSaved')
      return data
    } catch (error) {
      notify(error?.code === 'file/conflict' ? 'file.conflictTitle' : 'error.generic', { tone: 'error' })
      throw error
    }
  }

  /** Read one fixed deliverable by stage + artifact id. */
  async function readArtifact(projectId, stage, artifactId) {
    const data = await api.readArtifact(projectId, stage, artifactId)
    return {
      status: data.missing === true ? 'missing' : 'present',
      text: data.text ?? '',
      hash: data.hash ?? '',
      bytes: data.bytes ?? 0,
      path: data.path ?? '',
    }
  }

  /** Upload one source and merge the returned state. */
  async function uploadSource(projectId, file) {
    set({ busy: true })
    try {
      const data = await api.uploadSource(projectId, file, locale())
      applyServerData(data)
      set({ busy: false })
      notify('toast.sourceUploaded')
      return data
    } catch (error) {
      set({ busy: false })
      notify(error?.code === 'source/too-large' ? 'source.tooLarge' : 'error.generic', { tone: 'error' })
      throw error
    }
  }

  /** Read source metadata and preview. */
  async function readSource(projectId, sourceId) {
    return api.readSource(projectId, sourceId)
  }

  /** Save a new document version through the host's version chain. */
  async function saveDoc(docId, content) {
    const data = await mutate({ op: 'doc.save', docId, content })
    return data
  }

  /** Restore one document version, creating a new current version. */
  async function restoreDoc(docId, version) {
    const data = await mutate({ op: 'doc.restore', docId, version })
    return data
  }

  /** Run one AI task and collect the final proposal. */
  async function runAi(task, payload, handlers = {}) {
    set({ aiRunning: task })
    try {
      const final = await api.aiStream({
        task,
        payload,
        locale: locale(),
        signal: handlers.signal,
        onEvent: event => {
          if (event.type === 'delta') handlers.onDelta?.(event.text)
          if (event.type === 'result') handlers.onResult?.(event)
        },
      })
      return final
    } finally {
      set({ aiRunning: null })
    }
  }

  /** Create a session and open it. */
  async function handoff(scope) {
    set({ handoffBusy: true })
    try {
      const result = await api.handoff(scope, locale())
      notify('toast.handoff')
      if (typeof openSession === 'function' && typeof result.sessionId === 'string') {
        try {
          openSession(result.sessionId)
        } catch {
          /* opening is best effort; the id is in the result */
        }
      }
      return result
    } catch (error) {
      notify(error?.code === 'handoff/unavailable' ? 'handoff.failure' : 'handoff.failure', { tone: 'error' })
      throw error
    } finally {
      set({ handoffBusy: false })
    }
  }

  /** Clear the toast. */
  function dismissToast() {
    set({ toast: null })
  }

  /** Track an editor with unsaved content. */
  function setDirty(path, dirty) {
    set(current => {
      const known = new Set(current.dirtyPaths)
      if (dirty) known.add(path)
      else known.delete(path)
      return { ...current, dirtyPaths: [...known] }
    })
  }

  /** Whether any editor has unsaved content. */
  function hasDirty() {
    return snapshot.dirtyPaths.length > 0
  }

  /** Stop the auto-dismiss timer. */
  function dispose() {
    if (timer !== undefined) clearTimeout(timer)
    listeners.clear()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    load,
    refresh,
    setView,
    mutate,
    loadFile,
    saveFile,
    readArtifact,
    uploadSource,
    readSource,
    saveDoc,
    restoreDoc,
    runAi,
    handoff,
    notify,
    dismissToast,
    setDirty,
    hasDirty,
    dispose,
  }
}

/** Empty state reused by the panel while loading. */
export const EMPTY_STATE = {
  schemaVersion: 2,
  revision: 0,
  updatedAt: '',
  migration: { legacyImportedAt: null, legacySchema: null, v2MigratedAt: null },
  projects: [],
  opportunities: [],
  meetings: [],
  research: [],
  docs: [],
}
