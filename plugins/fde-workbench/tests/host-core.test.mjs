/** Host foundation: configuration, paths, schema, store, files, mutations, migration. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveConfig } from '../src/host/config.js'
import { WorkbenchError, assertRelativePath, resolveInside } from '../src/host/paths.js'
import { emptyState, createProject, normalizeState, normalizeProject } from '../src/host/schema.js'
import { WorkbenchStore } from '../src/host/store.js'
import { WorkbenchFiles, hashText } from '../src/host/files.js'
import { applyMutation } from '../src/host/state.js'
import { legacyToState } from '../src/host/migrate.js'
import { scoreOpportunity } from '../src/shared/scoring.js'
import { hostFixture, legacyFixture, tempRoot } from './helpers.mjs'

test('config: defaults keep a single root and sane limits', () => {
  const config = resolveConfig()
  assert.match(config.root, /fde-workbench$/)
  assert.equal(config.limits.fileBytes, 512 * 1024)
  assert.equal(config.ai.provider, '')
  assert.equal(config.handoff.groupInWorkspace, true)
  assert.deepEqual(config.warnings, [])
})

test('config: invalid values fall back and warn', () => {
  const config = resolveConfig({
    root: 'relative/root',
    limits: { fileBytes: -1, unknown: 3 },
    ai: { provider: 'deepseek' },
  })
  assert.ok(config.warnings.includes('config/root-relative'))
  assert.ok(config.warnings.includes('config/unknown-limit:unknown'))
  assert.ok(config.warnings.includes('config/ai-route-incomplete'))
  assert.equal(config.limits.fileBytes, 512 * 1024)
  assert.equal(config.ai.provider, '')
})

test('paths: accepts nested markdown, rejects escapes and other types', () => {
  assert.equal(assertRelativePath('projects/p-1/project.md'), 'projects/p-1/project.md')
  assert.equal(assertRelativePath('meetings\\m-1.md'), 'meetings/m-1.md')
  for (const bad of ['../outside.md', '/etc/passwd.md', 'C:\\x.md', 'notes.txt', 'a//b.md', 'a/./b.md', '']) {
    assert.throws(() => assertRelativePath(bad), WorkbenchError, bad)
  }
  const root = process.cwd()
  assert.throws(() => resolveInside(root, '../escape.md'), WorkbenchError)
  assert.equal(resolveInside(root, 'a/b.md').relative, 'a/b.md')
})

test('schema: a new project has eight stages, four work items, and fixed deliverables', () => {
  const project = createProject({ name: '应付账款对账', customer: 'ACME' }, 'zh')
  assert.equal(project.stages.length, 8)
  for (const stage of project.stages) {
    assert.equal(stage.work.length, 4)
    assert.equal(stage.deliverables.length, stage.id === 'discovery' ? 4 : 3)
    assert.equal(stage.deliverables.filter(item => item.required).length, 3)
  }
  assert.equal(project.currentStage, 0)
  assert.equal(project.status, 'active')
  assert.match(project.file, /^projects\/p-/)
})

test('schema: normalization clamps enums and pads stages to four work items', () => {
  const project = normalizeProject({
    id: 'p-x',
    name: 'X',
    currentStage: 99,
    stages: [{ work: [{ id: 'w1', text: 'a', done: 'yes' }], blockers: [{ id: 'b1', text: 'b', severity: 'urgent' }] }],
  })
  assert.equal(project.currentStage, 7)
  assert.equal(project.stages.length, 8)
  assert.equal(project.stages[0].blockers[0].severity, 'medium')
  assert.equal(project.stages[0].work[0].done, false)
  assert.equal(project.stages[0].work.length, 4)
})

test('schema: normalizing garbage returns an empty v2 state', () => {
  const state = normalizeState({ projects: 'nope', opportunities: [null] })
  assert.equal(state.schemaVersion, 2)
  assert.deepEqual(state.projects, [])
  assert.deepEqual(state.opportunities, [])
  assert.deepEqual(normalizeState(null), emptyState())
})

test('store: empty root reads empty, mutations bump the revision and persist', async t => {
  const { store } = await hostFixture(t)
  const first = await store.read()
  assert.equal(first.state.revision, 0)
  const changed = await store.mutate(0, state => {
    state.projects.push(createProject({ name: 'A' }))
  })
  assert.equal(changed.state.revision, 1)
  const reread = await store.read()
  assert.equal(reread.state.projects.length, 1)
  assert.equal(reread.state.projects[0].name, 'A')
})

test('store: a stale baseRevision is a 409 without writing', async t => {
  const { store } = await hostFixture(t)
  await store.mutate(0, state => state.projects.push(createProject({ name: 'A' })))
  await assert.rejects(
    () => store.mutate(0, state => state.projects.push(createProject({ name: 'B' }))),
    error => error instanceof WorkbenchError && error.code === 'state/conflict' && error.status === 409,
  )
  const state = await store.read()
  assert.equal(state.state.projects.length, 1)
})

test('store: concurrent mutations with no base revision serialize', async t => {
  const { store } = await hostFixture(t)
  await Promise.all([
    store.mutate(null, state => state.projects.push(createProject({ name: 'A' }))),
    store.mutate(null, state => state.projects.push(createProject({ name: 'B' }))),
  ])
  const state = await store.read()
  assert.equal(state.state.projects.length, 2)
  assert.equal(state.state.revision, 2)
})

test('store: corrupt state is recovered from the backup', async t => {
  const { store, root } = await hostFixture(t)
  await store.mutate(0, state => state.projects.push(createProject({ name: 'A' })))
  await store.mutate(1, state => state.projects.push(createProject({ name: 'B' })))
  await writeFile(join(root, 'workbench.json'), '{ this is not json', 'utf8')
  const recovered = await store.read()
  assert.equal(recovered.recovered, true)
  assert.ok(recovered.warnings.includes('state/recovered-from-backup'))
  assert.equal(recovered.state.projects.length, 1)
})

test('store: corrupt state without a backup is quarantined, never seeded', async t => {
  const { store, root } = await hostFixture(t)
  await writeFile(join(root, 'workbench.json'), '{ broken', 'utf8')
  const state = await store.read()
  assert.equal(state.state.projects.length, 0)
  assert.ok(state.warnings.includes('state/corrupt-quarantined'))
  const entries = await stat(join(root, 'workbench.json')).then(
    () => false,
    error => error.code === 'ENOENT',
  )
  assert.equal(entries, true)
})

test('files: write/read round-trips, hashes guard edits, limits reject', async t => {
  const { config, files } = await hostFixture(t)
  const first = await files.write('projects/p-1/project.md', '# hello\n', null)
  assert.equal(first.hash, hashText('# hello\n'))
  const read = await files.read('projects/p-1/project.md')
  assert.equal(read.text, '# hello\n')
  assert.equal(read.hash, first.hash)
  await assert.rejects(
    () => files.write('projects/p-1/project.md', '# changed\n', 'deadbeef'),
    error => error.code === 'file/conflict' && error.status === 409,
  )
  const updated = await files.write('projects/p-1/project.md', '# changed\n', first.hash)
  assert.equal(updated.hash, hashText('# changed\n'))

  const tiny = await hostFixture(t, { limits: { fileBytes: 1024 } })
  await assert.rejects(
    () => tiny.files.write('a.md', 'x'.repeat(2000), null),
    error => error.code === 'file/too-large' && error.status === 413,
  )
  assert.ok(config.limits.totalBytes > 0)
})

test('files: traversal writes never touch the filesystem', async t => {
  const { files, root } = await hostFixture(t)
  await assert.rejects(() => files.write('../outside.md', 'x', null), error => error.status === 400)
  await assert.rejects(
    () => stat(join(root, '..', 'outside.md')),
    error => error.code === 'ENOENT',
  )
})

test('state: project create writes markdown and fixed work cannot be added', async t => {
  const { store, files } = await hostFixture(t)
  await store.mutate(0, state => applyMutation(state, {
    op: 'project.create',
    name: '应付账款对账',
    customer: 'ACME',
    owner: '张三',
    locale: 'zh',
  }, { files, locale: 'zh' }))
  let state = (await store.read()).state
  const project = state.projects[0]
  assert.equal(project.customer, 'ACME')
  assert.equal(project.stages[0].work.length, 4)
  assert.ok((await files.read(project.file)).text.includes('应付账款对账'))

  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.work.add',
      projectId: project.id,
      stage: 0,
      text: '新增工作项',
    }, { files, locale: 'zh' })),
    error => error.code === 'mutation/unknown' && error.status === 400,
  )

  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.work.toggle',
      projectId: project.id,
      stage: 2,
      workId: project.stages[2].work[0].id,
    }, { files, locale: 'zh' })),
    error => error.code === 'stage/not-current' && error.status === 409,
  )
})

/** Mark one stage review-ready by completing work and writing its artifacts. */
async function makeStageReady(store, files, projectId, stageIndex) {
  let state = (await store.read()).state
  const project = state.projects.find(item => item.id === projectId)
  const stage = project.stages[stageIndex]
  for (const item of stage.work) {
    state = (await store.read()).state
    await store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.work.toggle',
      projectId,
      stage: stageIndex,
      workId: item.id,
      done: true,
    }, { files, locale: 'zh' }))
  }
  for (const deliverable of stage.deliverables.filter(item => item.required)) {
    state = (await store.read()).state
    await store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.deliverable.write',
      projectId,
      stage: stageIndex,
      artifactId: deliverable.id,
      content: `# ${deliverable.title}\n\n证据内容\n`,
    }, { files, locale: 'zh' }))
  }
}

test('state: advancing requires review-ready and eight stages deliver the project', async t => {
  const { store, files } = await hostFixture(t)
  await store.mutate(0, state => applyMutation(state, { op: 'project.create', name: '交付' }, { files, locale: 'zh' }))
  let state = (await store.read()).state
  const projectId = state.projects[0].id

  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.decide',
      projectId,
      stage: 0,
      outcome: 'go',
      rationale: '太早',
    }, { files, locale: 'zh' })),
    error => error.code === 'stage/not-ready' && error.status === 422,
  )

  for (let stage = 0; stage < 8; stage += 1) {
    await makeStageReady(store, files, projectId, stage)
    state = (await store.read()).state
    await store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.decide',
      projectId,
      stage,
      outcome: 'go',
      rationale: `阶段 ${stage} 通过`,
      decidedBy: 'FDE',
    }, { files, locale: 'zh' }))
  }
  state = (await store.read()).state
  assert.ok(state.projects[0].deliveredAt !== null)
  assert.equal(state.projects[0].status, 'completed')
  assert.equal(state.projects[0].currentStage, 7)

  state = (await store.read()).state
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'stage.decide',
    projectId,
    stage: 7,
    outcome: 'revise',
    rationale: '交付后修订',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  assert.equal(state.projects[0].stages[7].decisions.at(-1).outcome, 'revise')
  assert.equal(state.projects[0].status, 'completed')

  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.decide',
      projectId,
      stage: 7,
      outcome: 'go',
      rationale: '再次推进',
    }, { files, locale: 'zh' })),
    error => error.code === 'project/completed',
  )
})

test('state: deleting a project cascades research and documents but keeps opportunities', async t => {
  const { store, files } = await hostFixture(t)
  await store.mutate(0, state => applyMutation(state, { op: 'project.create', name: '级联' }, { files, locale: 'zh' }))
  let state = (await store.read()).state
  const projectId = state.projects[0].id
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'research.create',
    title: '调研 A',
    projectId,
    stage: 1,
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'doc.create',
    title: '文档 A',
    projectId,
    template: 'delivery',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'opportunity.create',
    title: '机会 A',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  const researchFile = state.research[0].file
  const docFile = state.docs[0].file

  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'project.delete',
    projectId,
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  assert.equal(state.projects.length, 0)
  assert.equal(state.research.length, 0)
  assert.equal(state.docs.length, 0)
  assert.equal(state.opportunities.length, 1)
  await assert.rejects(() => files.read(researchFile), error => error.code === 'file/not-found')
  await assert.rejects(() => files.read(docFile), error => error.code === 'file/not-found')
})

test('state: invalid stage indexes and empty decisions are rejected', async t => {
  const { store, files } = await hostFixture(t)
  await store.mutate(0, state => applyMutation(state, { op: 'project.create', name: '校验' }, { files, locale: 'zh' }))
  const state = (await store.read()).state
  const projectId = state.projects[0].id
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.decide',
      projectId,
      stage: 9,
      decision: 'x',
      action: 'advance',
    }, { files, locale: 'zh' })),
    error => error.code === 'stage/invalid',
  )
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.decide',
      projectId,
      stage: 0,
      decision: '   ',
      action: 'advance',
    }, { files, locale: 'zh' })),
    error => error.code === 'decision/empty',
  )
})

test('migration: a v2 snapshot maps to records and markdown', () => {
  const { state, files, counts } = legacyToState(legacyFixture(), { locale: 'zh' })
  assert.deepEqual(counts, { projects: 2, opportunities: 6, meetings: 2 })
  assert.equal(state.projects.length, 2)
  assert.equal(state.projects[0].stages.length, 8)
  assert.equal(state.projects[0].stages[0].noteFile, 'projects/p-alpha/stages/0.md')
  assert.equal(state.opportunities[0].source.meetingId, 'm-1')
  assert.ok(files.some(file => file.path === 'projects/p-alpha/project.md'))
  assert.ok(files.some(file => file.path === 'meetings/m-1.md' && file.text.includes('月结凭证')))
  assert.ok(files.some(file => file.path === 'opportunities/o-1.md'))
})

test('migration: missing fields are filled with defaults and counted', () => {
  const { state, counts } = legacyToState({
    version: 2,
    projects: [{ id: 'p-1' }],
    opportunities: [{ id: 'o-1' }],
    meetings: [],
  })
  assert.deepEqual(counts, { projects: 1, opportunities: 1, meetings: 0 })
  assert.equal(state.projects[0].stages.length, 8)
  assert.equal(state.projects[0].stages[0].work.length, 4)
  assert.equal(state.projects[0].name, '')
  assert.equal(state.opportunities[0].domain, 'other')
  assert.equal(state.opportunities[0].source.type, 'idea')
  assert.equal(state.opportunities[0].ratings.data, 3)
})

test('migration: unsupported versions are rejected without side effects', () => {
  assert.throws(() => legacyToState({ version: 1 }), error => error.code === 'migration/unsupported')
  assert.throws(() => legacyToState(null), error => error.code === 'migration/invalid')
})

test('scoring: weights, compliance gate, and weakest dimension', () => {
  const strong = scoreOpportunity({ data: 4, rules: 4, review: 4, value: 4, adoption: 3 }, 'medium')
  assert.equal(strong.score, 78)
  assert.equal(strong.verdict, 'pilot')
  assert.equal(strong.weakest, 'adoption')

  const gated = scoreOpportunity({ data: 4, rules: 4, review: 2, value: 4, adoption: 3 }, 'high')
  assert.equal(gated.verdict, 'hold')
  assert.ok(gated.notes.includes('review-gate'))
  assert.ok(gated.notes.includes('compliance-gate'))

  const low = scoreOpportunity({ data: 2, rules: 2, review: 2, value: 2, adoption: 2 }, 'low')
  assert.equal(low.score, 40)
  assert.equal(low.verdict, 'hold')
})

test('store: newer schema version opens read-only', async t => {
  const { store, root } = await hostFixture(t)
  await writeFile(join(root, 'workbench.json'), JSON.stringify({ schemaVersion: 99, projects: [] }), 'utf8')
  const read = await store.read()
  assert.equal(read.readOnly, true)
  await assert.rejects(() => store.mutate(null, () => {}), error => error.code === 'state/version')
})

test('store: oversized state is refused', async t => {
  const root = await tempRoot(t)
  const store = new WorkbenchStore({
    root,
    limits: { ...resolveConfig({ root }).limits, stateBytes: 1024 },
    logger: { warn() {} },
  })
  await assert.rejects(
    () => store.mutate(0, state => {
      for (let index = 0; index < 100; index += 1) state.projects.push(createProject({ name: `项目 ${index}` }))
    }),
    error => error.code === 'state/too-large',
  )
})

test('files: read of a missing body is a 404', async t => {
  const { files } = await hostFixture(t)
  await assert.rejects(() => files.read('nope.md'), error => error.code === 'file/not-found' && error.status === 404)
})

test('host files are readable through the public read helper', async t => {
  const { files } = await hostFixture(t)
  await files.write('README.md', '# x\n', null)
  assert.equal((await readFile(join(files.root, 'README.md'), 'utf8')), '# x\n')
})

test('state: every remaining operation applies and validates', async t => {
  const { store, files } = await hostFixture(t)
  const run = async mutation => {
    const current = (await store.read()).state
    await store.mutate(current.revision, state => applyMutation(state, mutation, { files, locale: 'zh' }))
    return (await store.read()).state
  }

  let state = await run({ op: 'project.create', name: '全操作', customer: 'A' })
  const projectId = state.projects[0].id
  state = await run({ op: 'project.update', projectId, name: '全操作改名', owner: '张三', startDate: '2026-01-01', endDate: '2026-12-31' })
  assert.equal(state.projects[0].name, '全操作改名')
  assert.equal(state.projects[0].owner, '张三')
  assert.equal(state.projects[0].endDate, '2026-12-31')
  state = await run({ op: 'project.status.set', projectId, status: 'paused' })
  assert.equal(state.projects[0].status, 'paused')
  state = await run({ op: 'project.status.set', projectId, status: 'active' })
  assert.equal(state.projects[0].status, 'active')

  state = await run({ op: 'stage.work.toggle', projectId, stage: 0, workId: state.projects[0].stages[0].work[0].id, done: true })
  assert.equal(state.projects[0].stages[0].work[0].done, true)
  state = await run({ op: 'stage.work.toggle', projectId, stage: 0, workId: state.projects[0].stages[0].work[0].id })
  assert.equal(state.projects[0].stages[0].work[0].done, false)
  assert.equal(state.projects[0].stages[0].work.length, 4)

  state = await run({
    op: 'stage.deliverable.write',
    projectId,
    stage: 0,
    artifactId: state.projects[0].stages[0].deliverables[0].id,
    content: '# 产物\n\n内容\n',
  })
  assert.equal(state.projects[0].stages[0].deliverables[0].status, 'present')

  state = await run({ op: 'stage.artifact.add', projectId, stage: 0, name: '接口清单', kind: 'doc' })
  const artifactId = state.projects[0].stages[0].artifacts[0].id
  assert.equal(state.projects[0].stages[0].artifacts[0].status, 'draft')
  state = await run({ op: 'stage.artifact.cycle', projectId, stage: 0, artifactId })
  assert.equal(state.projects[0].stages[0].artifacts[0].status, 'pending')
  state = await run({ op: 'stage.artifact.cycle', projectId, stage: 0, artifactId })
  assert.equal(state.projects[0].stages[0].artifacts[0].status, 'verified')
  state = await run({ op: 'stage.artifact.cycle', projectId, stage: 0, artifactId })
  assert.equal(state.projects[0].stages[0].artifacts[0].status, 'draft')
  state = await run({ op: 'stage.artifact.remove', projectId, stage: 0, artifactId })
  assert.equal(state.projects[0].stages[0].artifacts.length, 0)

  state = await run({ op: 'stage.blocker.add', projectId, stage: 0, text: '缺接口', severity: 'high' })
  const blockerId = state.projects[0].stages[0].blockers[0].id
  assert.equal(state.projects[0].stages[0].blockers[0].severity, 'high')
  state = await run({ op: 'stage.blocker.resolve', projectId, stage: 0, blockerId })
  assert.equal(state.projects[0].stages[0].blockers[0].resolved, true)
  state = await run({ op: 'stage.blocker.remove', projectId, stage: 0, blockerId })
  assert.equal(state.projects[0].stages[0].blockers.length, 0)

  state = await run({ op: 'stage.note.set', projectId, stage: 0, text: '# 阶段备注' })
  assert.equal(state.projects[0].stages[0].noteFile, `projects/${projectId}/stages/0.md`)
  assert.equal((await files.read(state.projects[0].stages[0].noteFile)).text, '# 阶段备注')

  state = await run({ op: 'opportunity.create', title: '机会', description: '现状', ratings: { data: 5, rules: 4, review: 3, value: 4, adoption: 2 }, compliance: 'high' })
  const opportunityId = state.opportunities[0].id
  assert.equal(state.opportunities[0].ratings.data, 5)
  assert.ok((await files.read(state.opportunities[0].file)).text.includes('机会'))
  state = await run({ op: 'opportunity.update', opportunityId, title: '机会改名', status: 'validating', ratings: { data: 1, rules: 9 } })
  assert.equal(state.opportunities[0].title, '机会改名')
  assert.equal(state.opportunities[0].status, 'validating')
  assert.equal(state.opportunities[0].ratings.rules, 5)
  state = await run({ op: 'opportunity.delete', opportunityId })
  assert.equal(state.opportunities.length, 0)

  state = await run({ op: 'meeting.create', title: '访谈', date: '2026-10-01', attendees: ['A', 'B'], content: '原始纪要' })
  const meetingId = state.meetings[0].id
  assert.ok((await files.read(state.meetings[0].file)).text.includes('原始纪要'))
  state = await run({ op: 'meeting.update', meetingId, title: '访谈改名', attendees: ['A'] })
  assert.equal(state.meetings[0].title, '访谈改名')
  assert.deepEqual(state.meetings[0].attendees, ['A'])
  state = await run({ op: 'meeting.delete', meetingId })
  assert.equal(state.meetings.length, 0)

  state = await run({ op: 'research.create', title: '调研', projectId, stage: 1, question: '为什么', conclusion: '因为' })
  const researchId = state.research[0].id
  assert.equal(state.research[0].stage, 1)
  assert.ok((await files.read(state.research[0].file)).text.includes('为什么'))
  state = await run({ op: 'research.update', researchId, status: 'finding', conclusion: '新结论' })
  assert.equal(state.research[0].status, 'finding')
  assert.equal(state.research[0].conclusion, '新结论')
  state = await run({ op: 'research.delete', researchId })
  assert.equal(state.research.length, 0)

  state = await run({ op: 'doc.create', title: '文档', projectId, template: 'delivery', stage: 2 })
  const docId = state.docs[0].id
  const docBody = (await files.read(state.docs[0].file)).text
  assert.ok(docBody.includes('交付说明'))
  assert.equal(state.docs[0].currentVersion, 1)
  state = await run({ op: 'doc.save', docId, content: '# 文档\n\n新版本\n' })
  assert.equal(state.docs[0].currentVersion, 2)
  state = await run({ op: 'doc.restore', docId, version: 1 })
  assert.equal(state.docs[0].currentVersion, 3)
  state = await run({ op: 'doc.update', docId, status: 'approved' })
  assert.equal(state.docs[0].status, 'approved')
  state = await run({ op: 'doc.delete', docId })
  assert.equal(state.docs.length, 0)

  state = await run({ op: 'task.create', projectId, title: '任务 A', owner: '张三' })
  const taskId = state.projects[0].tasks[0].id
  assert.equal(state.projects[0].tasks[0].status, 'todo')
  state = await run({ op: 'task.update', projectId, taskId, status: 'in_progress', progress: 40 })
  assert.equal(state.projects[0].tasks[0].status, 'in_progress')
  state = await run({ op: 'task.delete', projectId, taskId })
  assert.equal(state.projects[0].tasks.length, 0)

  state = await run({
    op: 'source.add',
    projectId,
    sourceId: 'f-test',
    name: '接口清单.pdf',
    mime: 'application/pdf',
    bytes: 123,
    sha256: 'abc',
    version: 1,
    path: `projects/${projectId}/sources/f-test/1/接口清单.pdf`,
  })
  assert.equal(state.projects[0].sources.length, 1)
  state = await run({ op: 'source.delete', projectId, sourceId: 'f-test' })
  assert.equal(state.projects[0].sources.length, 0)
})

test('state: unknown or malformed mutations are rejected', async t => {
  const { store, files } = await hostFixture(t)
  const current = (await store.read()).state
  await assert.rejects(
    () => store.mutate(current.revision, state => applyMutation(state, { op: 'nope' }, { files, locale: 'zh' })),
    error => error.code === 'mutation/unknown',
  )
  await assert.rejects(
    () => store.mutate(current.revision, state => applyMutation(state, null, { files, locale: 'zh' })),
    error => error.code === 'mutation/invalid',
  )
  await assert.rejects(
    () => store.mutate(current.revision, state => applyMutation(state, { op: 'project.create', name: '   ' }, { files, locale: 'zh' })),
    error => error.code === 'project/name-required',
  )
})
