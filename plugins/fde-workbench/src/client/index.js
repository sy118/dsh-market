/**
 * Browser entry: one sidebar entry and the main panel it opens.
 *
 * The store is created once per plugin activation; the panel registration
 * passes it down, and disposal returns the main column to the conversation.
 */
import { createElement } from 'react'
import css from './styles.css'
import { LOCALE_NS, PANEL_ID } from '../shared/constants.js'
import { scoreOpportunity } from '../shared/scoring.js'
import { en } from './i18n/en.js'
import { zh } from './i18n/zh.js'
import { createWorkbenchStore } from './store.js'
import { WorkbenchApp } from './ui/app.js'
import { Button, ConfirmDialog, TextInput } from './ui/common.js'
import { ErrorBoundary } from './ui/error-boundary.js'
import { WorkbenchIcon } from './ui/icons.js'
import * as selectors from './selectors.js'

// The Loader claims untagged styles created while the factory materializes and
// removes them on unload.
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}

/** Panel root with the render boundary above it. */
function Page(props) {
  return createElement(ErrorBoundary, { t: props.t }, createElement(WorkbenchApp, props))
}

const plugin = {
  inject: ['slots', 'locale', 'layout'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(LOCALE_NS, { en, zh }), 'fde-workbench: dictionaries')
    const t = ctx.locale.bind(LOCALE_NS)

    const getLang = () => {
      try {
        return String(ctx.locale.getLocale().active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'zh'
      }
    }

    const openSession = sessionId => {
      try {
        const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
        workspace?.openSession?.(sessionId)
        ctx.layout.selectPanel(null)
      } catch {
        /* navigation is best effort; the session id is still on screen */
      }
    }

    const store = createWorkbenchStore({ getLang, openSession })

    // The main-area page. Its key equals the sidebar entry's id.
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: LOCALE_NS,
      inject: () => ({ store, t, getLang, locale: ctx.locale }),
    }, Page))

    // The left-sidebar entry: icon plus its localized label.
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 30,
      locale: LOCALE_NS,
      label: () => t('panel'),
    }, WorkbenchIcon))

    // Leaving our panel selected would point the main column at a missing
    // entry after unload; return to the Conversation only when we own it.
    ctx.effect(() => () => {
      try {
        const info = ctx.layout.panelInfo.getSnapshot()
        if (info.activePanelId === PANEL_ID) ctx.layout.selectPanel(null)
      } catch {
        /* the layout service may already be gone with the page */
      }
      store.dispose()
    }, 'fde-workbench: leave the panel on disposal')
  },
}

// Non-enumerable hook: the smoke test exercises selectors and dictionaries
// without rendering React.
Object.defineProperty(plugin, Symbol.for('dsh.fde-workbench.test'), {
  value: {
    selectors,
    scoreOpportunity,
    dictionaries: { en, zh },
    ui: { Button, ConfirmDialog, TextInput },
    ErrorBoundary,
  },
})

export default plugin
