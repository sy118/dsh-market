/** Evaluate the built bundle without a browser: registrations, copy, CSS, controls. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = '@acme-community/fde-workbench'
const PANEL_ID = 'fde-workbench'

/** A minimal React namespace: components are called directly in this test. */
function fakeReact() {
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(patch) {
      this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) }
    }
  }
  return {
    Component,
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
    useRef(initial) {
      return { current: initial ?? null }
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
  }
}

/** Load and execute the bundle with a fake module system. */
async function loadBundle() {
  const source = await readFile(join(dir, 'client.js'), 'utf8')
  let registration
  const fakeWindow = { __ModuleLoader__: { load(value) { registration = value } } }
  const react = fakeReact()
  new Function('window', 'require', 'console', source)(fakeWindow, specifier => {
    if (specifier !== 'react') throw new Error(`unexpected require: ${specifier}`)
    return react
  }, console)
  if (registration === undefined) throw new Error('client.js did not register')
  return { source, registration, react }
}

/** A recording Cordis-like context. */
function fakeContext() {
  const registered = []
  const effects = []
  const dictionaries = {}
  const panels = []
  const opened = []
  const ctx = {
    effect(callback, label) {
      effects.push({ label, dispose: callback() })
    },
    slots: {
      inject(slot, callback) {
        callback()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, value) {
        dictionaries[namespace] = value
        return () => {}
      },
      bind(namespace) {
        return (key, params) => {
          const dict = dictionaries[namespace]?.[key.startsWith('nav.') ? 'zh' : 'zh']
          const text = dict?.[key]
          if (text === undefined) throw new Error(`missing translation: ${key}`)
          return typeof params === 'object' && params !== null
            ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
            : text
        }
      },
      getLocale() {
        return { active: 'zh' }
      },
      subscribe() {
        return () => {}
      },
    },
    layout: {
      selectPanel(id) {
        panels.push(id)
      },
      panelInfo: {
        getSnapshot() {
          return { activePanelId: panels.at(-1) ?? null }
        },
      },
    },
    get(name) {
      if (name === 'uiWorkspace') return { openSession: id => opened.push(id) }
      return undefined
    },
  }
  return { ctx, registered, effects, dictionaries, panels, opened }
}

test('bundle: registration id, plugin face, and both slots', async () => {
  const { registration, react } = await loadBundle()
  assert.equal(registration.id, PLUGIN_ID)
  const loaded = registration.factory(() => react)
  assert.ok(Array.isArray(loaded.inject))
  assert.deepEqual(loaded.inject, ['slots', 'locale', 'layout'])

  const fake = fakeContext()
  loaded.apply(fake.ctx)

  const main = fake.registered.find(item => item.options.name === 'main')
  const sidebar = fake.registered.find(item => item.options.name === 'sidebar.panellist')
  assert.ok(main !== undefined)
  assert.equal(main.options.key, PANEL_ID)
  assert.equal(main.options.locale, 'fdeWorkbench')
  assert.ok(sidebar !== undefined)
  assert.equal(sidebar.options.id, PANEL_ID)
  assert.equal(sidebar.options.order, 30)
  assert.equal(typeof sidebar.options.label, 'function')
  assert.equal(sidebar.options.label(), '交付工作台')
  assert.equal(fake.effects.length, 2)
  assert.equal(fake.dictionaries.fdeWorkbench.zh['panel'], '交付工作台')
  assert.equal(fake.dictionaries.fdeWorkbench.en['panel'], 'Delivery workbench')
})

test('bundle: disposal returns the panel to the conversation', async () => {
  const { registration, react } = await loadBundle()
  const fake = fakeContext()
  registration.factory(() => react).apply(fake.ctx)
  fake.ctx.layout.selectPanel(PANEL_ID)
  await fake.effects[1].dispose()
  assert.equal(fake.panels.at(-1), null)
})

test('copy: dictionaries have identical keys, no blanks, and cover every static key', async () => {
  const { registration, react, source } = await loadBundle()
  const plugin = registration.factory(() => react)
  const hook = plugin[Symbol.for('dsh.fde-workbench.test')]
  const { en, zh } = hook.dictionaries
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const key of Object.keys(en)) {
    assert.ok(typeof en[key] === 'string' && en[key].trim() !== '', `empty en ${key}`)
    assert.ok(typeof zh[key] === 'string' && zh[key].trim() !== '', `empty zh ${key}`)
  }

  const used = new Set()
  for (const match of source.matchAll(/\bt\('([^']+)'/g)) used.add(match[1])
  for (const match of source.matchAll(/\bt\("([^"]+)"/g)) used.add(match[1])
  const missing = [...used].filter(key => en[key] === undefined || zh[key] === undefined)
  assert.deepEqual(missing, [], `static t() keys missing: ${missing.join(', ')}`)
  assert.ok(used.size > 80)
})

test('copy: enum families are complete in both languages', async () => {
  const { registration, react } = await loadBundle()
  const hook = registration.factory(() => react)[Symbol.for('dsh.fde-workbench.test')]
  const { en, zh } = hook.dictionaries
  for (const key of ['nav.overview', 'nav.projects', 'nav.research', 'nav.docs', 'nav.opportunities', 'nav.meetings']) {
    assert.ok(en[key] !== undefined && zh[key] !== undefined, `missing nav key ${key}`)
  }
  const families = {
    'status.': ['draft', 'pending', 'verified'],
    'kind.': ['doc', 'code', 'report', 'record', 'data'],
    'severity.': ['high', 'medium', 'low'],
    'research.status.': ['open', 'researching', 'finding', 'closed'],
    'doc.status.': ['draft', 'review', 'approved'],
    'doc.template.': ['proposal', 'research', 'delivery', 'acceptance', 'retro'],
    'domain.': ['reporting', 'ap', 'ar', 'expense', 'close', 'tax', 'audit', 'fpa', 'treasury', 'shared', 'other'],
    'task.': ['extract', 'validate', 'summarize', 'generate', 'classify', 'analyze', 'qa', 'orchestrate'],
    'opp.status.': ['candidate', 'validating', 'pilot', 'adopted', 'parked', 'rejected'],
    'verdict.': ['pilot', 'validate', 'hold'],
    'compliance.': ['low', 'medium', 'high'],
    'source.': ['meeting', 'idea', 'process'],
    'score.dimension.': ['data', 'rules', 'review', 'value', 'adoption'],
    'score.note.': ['compliance-gate', 'compliance-cap', 'review-gate', 'review-weak', 'weak-data', 'weak-rules', 'weak-adoption'],
    'ai.reason.': ['no-llm', 'no-route', 'provider-missing', 'model-missing', 'unavailable', 'catalog-empty'],
  }
  for (const [prefix, values] of Object.entries(families)) {
    for (const value of values) {
      assert.ok(en[`${prefix}${value}`] !== undefined, `missing en ${prefix}${value}`)
      assert.ok(zh[`${prefix}${value}`] !== undefined, `missing zh ${prefix}${value}`)
    }
  }
})

test('copy: interpolation renders params', async () => {
  const { registration, react } = await loadBundle()
  const fake = fakeContext()
  registration.factory(() => react).apply(fake.ctx)
  const t = fake.ctx.locale.bind('fdeWorkbench')
  assert.equal(t('project.count', { count: 3 }), '3 个项目')
  assert.equal(t('stage.advanceBody', { project: 'A', from: 1, to: 2 }).includes('第 2 阶段'), true)
})

test('styles: every static class used by the bundle exists, and no literal colours', async () => {
  const { source } = await loadBundle()
  const css = await readFile(join(dir, 'src/client/styles.css'), 'utf8')
  const classes = new Set()
  for (const match of source.matchAll(/className:\s*'([^']+)'/g)) {
    for (const token of match[1].split(/\s+/)) if (token.startsWith('fdw-')) classes.add(token)
  }
  const dynamic = [
    'fdw-body--assistant',
    'fdw-columns--stage',
    'fdw-badge--ok', 'fdw-badge--warn', 'fdw-badge--bad', 'fdw-badge--info', 'fdw-badge--muted',
    'fdw-btn--primary', 'fdw-btn--ghost', 'fdw-btn--danger', 'fdw-btn--sm', 'fdw-btn--icon',
    'fdw-status--draft', 'fdw-status--pending', 'fdw-status--verified',
    'fdw-stage-step--done', 'fdw-stage-step--current', 'fdw-stage-step--todo', 'fdw-stage-step--selected',
    'fdw-stage-dot--done', 'fdw-stage-dot--current', 'fdw-stage-dot--todo',
    'fdw-toast--info', 'fdw-toast--error', 'fdw-toast--warning', 'fdw-toast--success',
    'fdw-rating--on', 'fdw-body-state--dirty', 'fdw-notice--ok', 'fdw-banner--bad', 'fdw-message--user',
  ]
  for (const token of dynamic) classes.add(token)
  const missing = [...classes].filter(token => !css.includes(`.${token}`))
  assert.deepEqual(missing, [], `classes missing from styles.css: ${missing.join(', ')}`)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false)
})

test('controls: accessible names and two-step confirmation', async () => {
  const { registration, react } = await loadBundle()
  const hook = registration.factory(() => react)[Symbol.for('dsh.fde-workbench.test')]
  const { Button, ConfirmDialog, TextInput } = hook.ui

  const icon = Button({ iconOnly: true, label: 'Refresh', children: 'r' })
  assert.equal(icon.props['aria-label'], 'Refresh')
  const input = TextInput({ value: 'x', onChange: () => {}, 'aria-label': 'Search' })
  assert.equal(input.props['aria-label'], 'Search')

  let confirmed = 0
  let cancelled = 0
  const dialog = ConfirmDialog({
    open: true,
    title: 'Delete?',
    body: 'body',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    onConfirm: () => { confirmed += 1 },
    onCancel: () => { cancelled += 1 },
  })
  assert.equal(confirmed, 0)
  const footer = dialog.props.footer
  assert.equal(footer.length, 2)
  footer[1].props.onClick()
  assert.equal(confirmed, 1)
  footer[0].props.onClick()
  assert.equal(cancelled, 1)
})

test('error boundary: a thrown render produces a recoverable panel', async () => {
  const { registration, react } = await loadBundle()
  const hook = registration.factory(() => react)[Symbol.for('dsh.fde-workbench.test')]
  const t = key => key
  const boundary = new hook.ErrorBoundary({ t })
  boundary.state = hook.ErrorBoundary.getDerivedStateFromError(new Error('boom'))
  const tree = boundary.render()
  assert.equal(tree.props.className, 'fdw-error-panel')
  assert.equal(tree.children.some(child => child?.props?.className === 'fdw-error-detail'), true)
})

test('test hook: selectors and scoring are available without rendering', async () => {
  const { registration, react } = await loadBundle()
  const hook = registration.factory(() => react)[Symbol.for('dsh.fde-workbench.test')]
  assert.equal(typeof hook.selectors.overviewStats, 'function')
  const stats = hook.selectors.overviewStats({ projects: [], opportunities: [], meetings: [], research: [], docs: [] })
  assert.equal(stats.projects, 0)
  assert.equal(hook.scoreOpportunity({ data: 4, rules: 4, review: 4, value: 4, adoption: 3 }, 'medium').score, 78)
})
