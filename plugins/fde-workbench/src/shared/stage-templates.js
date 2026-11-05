/**
 * Compatibility view of the stage definitions, plus the document template
 * skeletons. New code should read `stages.js`; this module keeps the document
 * helpers and the localized title/question/work arrays used by older callers.
 */
import { STAGES } from './stages.js'

/** Stage copy for one locale, derived from the canonical definitions. */
export function stageTemplates(locale) {
  const lang = locale === 'en' ? 'en' : 'zh'
  return STAGES.map(stage => ({
    id: stage.id,
    title: stage.title[lang],
    question: stage.question[lang],
    work: stage.work.map(item => item.text[lang]),
    artifacts: stage.artifacts,
  }))
}

/** Stage copy for both locales, keyed by language. */
export const STAGE_TEMPLATES = {
  zh: stageTemplates('zh'),
  en: stageTemplates('en'),
}

/** Document template skeletons; `{project}`, `{stage}`, `{date}` are replaced. */
export const DOC_TEMPLATE_BODIES = {
  zh: {
    proposal: '# {project} 立项说明\n\n## 背景\n\n## 目标与成功标准\n\n## 范围与不做清单\n\n## 责任人与计划\n',
    research: '# {project} 调研报告\n\n## 问题\n\n## 方法\n\n## 发现\n\n## 建议\n',
    delivery: '# {project} 交付说明\n\n## 交付范围\n\n## 使用方式\n\n## 依赖与限制\n\n## 验收清单\n',
    acceptance: '# {project} 验收记录\n\n## 验收项\n\n## 结果\n\n## 遗留问题\n',
    retro: '# {project} 复盘\n\n## 目标回顾\n\n## 做得好\n\n## 待改进\n\n## 后续动作\n',
  },
  en: {
    proposal: '# {project} proposal\n\n## Context\n\n## Goals and success criteria\n\n## Scope and not-doing list\n\n## Owners and plan\n',
    research: '# {project} research report\n\n## Question\n\n## Method\n\n## Findings\n\n## Recommendation\n',
    delivery: '# {project} delivery notes\n\n## Delivered scope\n\n## How to use it\n\n## Dependencies and limits\n\n## Acceptance checklist\n',
    acceptance: '# {project} acceptance record\n\n## Items\n\n## Result\n\n## Open issues\n',
    retro: '# {project} retrospective\n\n## Goals\n\n## What went well\n\n## What to improve\n\n## Next actions\n',
  },
}

/** Fill a template body with the project title and the current date. */
export function renderTemplate(template, locale, project, date) {
  const bodies = DOC_TEMPLATE_BODIES[locale] ?? DOC_TEMPLATE_BODIES.zh
  const body = bodies[template] ?? bodies.delivery
  return body.replaceAll('{project}', project).replaceAll('{date}', date)
}
