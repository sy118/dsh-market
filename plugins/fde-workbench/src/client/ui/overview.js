/** Overview: metrics, stage distribution, recent changes, next actions. */
import { EmptyState, Metric, Progress, SectionHead, h } from './common.js'
import { nextActions, overviewStats, recentActivity, percent } from '../selectors.js'

const KIND_KEY = {
  project: 'nav.projects',
  opportunity: 'nav.opportunities',
  meeting: 'nav.meetings',
  research: 'nav.research',
  doc: 'nav.docs',
}

/** One stage bar. */
function StageBar(props) {
  return h('div', { className: 'fdw-stage-bar' },
    h('span', { className: 'fdw-stage-bar-label' }, props.label),
    h(Progress, { value: percent(props.count, props.max) }),
    h('span', { className: 'fdw-stage-bar-count' }, String(props.count)))
}

/** One derived next action. */
function ActionRow(props) {
  const { action, t, state, onOpenProject, onNavigate } = props
  const label = action.code === 'blocked'
    ? t('overview.action.blocked', { project: action.name })
    : action.code === 'decide'
      ? t('overview.action.decide', { project: action.name })
      : action.code === 'deliver'
        ? t('overview.action.deliver', { project: action.name })
        : action.code === 'artifact'
          ? t('overview.action.artifact', { project: action.name, count: action.count })
          : action.code === 'work'
            ? t('overview.action.work', { project: action.name, count: action.count })
            : action.code === 'resume'
              ? t('overview.action.resume', { project: action.name })
              : action.code === 'opportunity'
                ? t('overview.action.opportunity', { count: action.count })
                : t('overview.action.research', { count: action.count ?? 0 })
  const open = () => {
    if (action.projectId !== undefined) {
      const project = (state.projects ?? []).find(item => item.id === action.projectId)
      onOpenProject(action.projectId, project?.currentStage ?? 0)
    } else {
      onNavigate(action.code === 'opportunity' ? 'opportunities' : 'research')
    }
  }
  return h('li', null, h('button', { type: 'button', className: 'fdw-link-button', onClick: open }, label))
}

/** Render the overview section. */
export function OverviewSection(props) {
  const { snapshot, t, lang, onOpenProject, onNavigate, onCreate } = props
  const state = snapshot.state
  const stats = overviewStats(state)
  const actions = nextActions(state)
  const recent = recentActivity(state)
  const max = Math.max(1, ...stats.byStage)

  if (stats.projects === 0 && stats.opportunities === 0 && stats.meetings === 0) {
    return h('div', { className: 'fdw-section' },
      h(EmptyState, {
        title: t('overview.empty'),
        body: t('overview.emptyBody'),
        action: h('button', { type: 'button', className: 'fdw-btn fdw-btn--primary', onClick: onCreate }, t('overview.create')),
      }))
  }

  const metrics = h('div', { className: 'fdw-metrics' },
    h(Metric, { label: t('overview.metrics.projects'), value: stats.projects }),
    h(Metric, { label: t('overview.metrics.active'), value: stats.active }),
    h(Metric, { label: t('overview.metrics.delivered'), value: stats.delivered }),
    h(Metric, { label: t('overview.metrics.blockers'), value: stats.blockers }))

  const pipeline = h('section', { className: 'fdw-card' },
    h(SectionHead, { title: t('overview.pipeline'), hint: t('overview.pipelineHint') }),
    h('div', { className: 'fdw-stage-bars' }, stats.byStage.map((count, index) => h(StageBar, {
      key: index,
      label: String(index + 1).padStart(2, '0'),
      count,
      max,
    }))))

  const nextCard = h('section', { className: 'fdw-card' },
    h(SectionHead, { title: t('overview.next') }),
    actions.length === 0
      ? h('p', { className: 'fdw-hint' }, t('overview.nextEmpty'))
      : h('ul', { className: 'fdw-action-list' }, actions.map(action => h(ActionRow, {
        key: `${action.code}-${action.projectId ?? action.count ?? ''}`,
        action,
        t,
        state,
        onOpenProject,
        onNavigate,
      }))))

  const recentCard = h('section', { className: 'fdw-card' },
    h(SectionHead, { title: t('overview.recent') }),
    recent.length === 0
      ? h('p', { className: 'fdw-hint' }, t('overview.recentEmpty'))
      : h('ul', { className: 'fdw-recent-list' }, recent.map(item => h('li', {
        key: `${item.kind}-${item.id}`,
        className: 'fdw-recent-row',
      },
      h('span', { className: 'fdw-recent-kind' }, t(KIND_KEY[item.kind] ?? 'common.empty')),
      h('span', { className: 'fdw-recent-title' }, item.title),
      h('span', { className: 'fdw-recent-date' }, item.at.slice(0, 10))))))

  return h('div', { className: 'fdw-section fdw-overview' },
    metrics,
    h('div', { className: 'fdw-columns' }, pipeline, nextCard),
    recentCard)
}
