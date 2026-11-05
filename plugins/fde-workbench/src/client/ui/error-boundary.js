/** Keeps a rendering failure inside the workbench panel. */
import { Component, createElement } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    try {
      console.warn('[fde-workbench] render failed', error)
    } catch {
      /* logging must not throw inside the boundary */
    }
  }

  render() {
    if (this.state.error !== null) {
      const t = this.props.t
      return createElement('div', { className: 'fdw-error-panel', role: 'alert' },
        createElement('h2', { className: 'fdw-error-title' }, t('error.generic')),
        createElement('pre', { className: 'fdw-error-detail' }, String(this.state.error?.message ?? this.state.error)),
        createElement('button', {
          type: 'button',
          className: 'fdw-btn fdw-btn--primary',
          onClick: () => this.setState({ error: null }),
        }, t('common.retry')))
    }
    return this.props.children
  }
}

export default ErrorBoundary
