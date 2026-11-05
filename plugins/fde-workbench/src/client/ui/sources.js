/** Project source library: upload, versions, bounded preview, and reference guard. */
import { useEffect, useState } from 'react'
import { MAX_SOURCE_BYTES } from '../../shared/constants.js'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  SectionHead,
  h,
} from './common.js'
import { sourceFileUrl } from '../api.js'
import { PlusIcon, TrashIcon } from './icons.js'
import { errorText } from './error-text.js'

/** Human-readable byte count. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Read a File as base64 without depending on a bundler helper. */
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.onload = () => {
      const value = String(reader.result ?? '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** Source detail modal: metadata, preview, download, and removal. */
function SourceDetail(props) {
  const { store, t, project, source, onClose, onDeleted } = props
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [replacing, setReplacing] = useState(false)

  useEffect(() => {
    let alive = true
    store.readSource(project.id, source.id).then(value => {
      if (alive) setData(value)
    }).catch(value => {
      if (alive) setError(value?.code ?? 'error.generic')
    })
    return () => { alive = false }
  }, [store, project.id, source.id])

  async function replace(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    if (file.size > MAX_SOURCE_BYTES) {
      setError('source.tooLarge')
      return
    }
    setReplacing(true)
    try {
      await store.uploadSource(project.id, {
        sourceId: source.id,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataBase64: await readBase64(file),
      })
      onClose()
    } catch (value) {
      setError(value?.code ?? 'error.generic')
    } finally {
      setReplacing(false)
    }
  }

  return h(Modal, {
    open: true,
    title: source.name,
    onClose,
    footer: [
      h('label', { key: 'replace', className: 'fdw-btn fdw-btn--sm fdw-upload' },
        replacing ? t('source.uploading') : t('source.replace'),
        h('input', {
          type: 'file',
          disabled: replacing,
          onChange: replace,
          'aria-label': t('source.replace'),
        })),
      h('a', {
        key: 'download',
        className: 'fdw-btn fdw-btn--sm',
        href: sourceFileUrl(project.id, source.id),
        download: source.name,
      }, t('source.download')),
      h(Button, { key: 'delete', variant: 'danger', onClick: () => setDeleteOpen(true) }, h(TrashIcon), t('common.delete')),
      h(Button, { key: 'close', onClick: onClose }, t('common.close')),
    ],
  },
  h('dl', { className: 'fdw-facts' },
    h('div', null, h('dt', null, t('source.size')), h('dd', null, formatBytes(source.bytes))),
    h('div', null, h('dt', null, t('source.mime')), h('dd', null, source.mime)),
    h('div', null, h('dt', null, t('source.version')), h('dd', null, `v${source.version}`)),
    h('div', null, h('dt', null, t('source.sha256')), h('dd', null, h('code', null, source.sha256.slice(0, 16))))),
  error === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, error === 'source/referenced' ? t('source.referenced') : error === 'source.tooLarge' ? t('source.tooLarge') : errorText(t, error)),
  data === null
    ? h('p', { role: 'status' }, t('loading'))
    : data.preview.available
      ? h('pre', { className: 'fdw-preview' }, data.preview.text + (data.preview.truncated ? `\n… ${t('source.truncated')}` : ''))
      : h('p', { className: 'fdw-hint' }, t('source.noPreview')),
  h(ConfirmDialog, {
    open: deleteOpen,
    title: t('source.deleteTitle'),
    body: t('source.deleteBody'),
    confirmLabel: t('source.delete'),
    cancelLabel: t('common.cancel'),
    onCancel: () => setDeleteOpen(false),
    onConfirm: () => {
      setDeleteOpen(false)
      void store.mutate({ op: 'source.delete', projectId: project.id, sourceId: source.id }).then(() => {
        onClose()
        onDeleted?.()
      }).catch(value => {
        if (value?.code === 'source/referenced') setError('source.referenced')
      })
    },
  }))
}

/** Source tab. */
export function SourcesPanel(props) {
  const { store, t, project, focusSourceId } = props
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const sources = project.sources ?? []

  useEffect(() => {
    if (typeof focusSourceId !== 'string') return
    const found = sources.find(item => item.id === focusSourceId)
    if (found !== undefined) setSelected(found)
  }, [focusSourceId, sources])

  async function upload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    if (file.size > MAX_SOURCE_BYTES) {
      setError(t('source.tooLarge'))
      return
    }
    setUploading(true)
    setError('')
    try {
      const dataBase64 = await readBase64(file)
      await store.uploadSource(project.id, {
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataBase64,
      })
    } catch (value) {
      setError(value?.code ?? 'error.generic')
    } finally {
      setUploading(false)
    }
  }

  return h('div', { className: 'fdw-project-tab' },
    h(SectionHead, {
      title: t('source.title'),
      hint: t('source.count', { count: sources.length }),
      action: h('label', { className: 'fdw-btn fdw-btn--primary fdw-btn--sm fdw-upload' },
        h(PlusIcon),
        uploading ? t('source.uploading') : t('source.upload'),
        h('input', {
          type: 'file',
          onChange: upload,
          disabled: uploading,
          'aria-label': t('source.upload'),
        })),
    }),
    error === '' ? null : h('p', { className: 'fdw-error', role: 'alert' }, error === 'source.tooLarge' ? t('source.tooLarge') : errorText(t, error)),
    sources.length === 0
      ? h(EmptyState, { title: t('source.empty'), body: t('source.emptyBody') })
      : h('div', { className: 'fdw-card-grid' }, sources.map(source => h('button', {
        key: source.id,
        type: 'button',
        className: 'fdw-record-card',
        onClick: () => setSelected(source),
      },
      h('div', { className: 'fdw-record-head' },
        h('span', { className: 'fdw-record-title' }, source.name),
        h(Badge, { tone: 'muted' }, `v${source.version}`)),
      h('p', { className: 'fdw-record-sub' }, `${formatBytes(source.bytes)} · ${source.mime}`),
      h('p', { className: 'fdw-hint' }, source.createdAt.slice(0, 10))))),
    selected === null ? null : h(SourceDetail, {
      store,
      t,
      project,
      source: sources.find(item => item.id === selected.id) ?? selected,
      onClose: () => setSelected(null),
      onDeleted: () => setSelected(null),
    }))
}
