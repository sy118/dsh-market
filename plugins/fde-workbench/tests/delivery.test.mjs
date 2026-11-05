/** Delivery contract: review gate, decisions, returns, tasks, sources, documents, migration. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyMutation } from '../src/host/state.js'
import { createProject } from '../src/host/schema.js'
import { evidenceDigest } from '../src/host/digest.js'
import { reviewBlockers, stageState } from '../src/shared/stage-state.js'
import { STAGES } from '../src/shared/stages.js'
import { hostFixture, tempRoot } from './helpers.mjs'

/** Apply one mutation through a fixture and return the new state. */
async function run(store, files, mutation) {
  const current = (await store.read()).state
  await store.mutate(current.revision, state => applyMutation(state, mutation, { files, locale: 'zh' }))
  return (await store.read()).state
}

/** Complete all work items and write all required artifacts for one stage. */
async function makeReady(store, files, projectId, stageIndex) {
  let state = (await store.read()).state
  const project = state.projects.find(item => item.id === projectId)
  const stage = project.stages[stageIndex]
  for (const item of stage.work) {
    state = await run(store, files, {
      op: 'stage.work.toggle',
      projectId,
      stage: stageIndex,
      workId: item.id,
      done: true,
    })
  }
  for (const deliverable of stage.deliverables.filter(item => item.required)) {
    state = await run(store, files, {
      op: 'stage.deliverable.write',
      projectId,
      stage: stageIndex,
      artifactId: deliverable.id,
      content: `# ${deliverable.title}\n\n真实证据。\n`,
    })
  }
  return state
}

test('stage: the shared contract has eight stages, four work items, and fixed paths', () => {
  assert.equal(STAGES.length, 8)
  const paths = new Set()
  for (const stage of STAGES) {
    assert.equal(stage.work.length, 4)
    assert.equal(stage.artifacts.filter(item => item.required).length, 3)
    assert.ok(stage.artifacts.every(item => item.path.startsWith('fde-deliverables/')))
    for (const artifact of stage.artifacts) {
      assert.equal(paths.has(artifact.path), false)
      paths.add(artifact.path)
    }
  }
  assert.equal(STAGES[0].artifacts.filter(item => item.required === false).length, 1)
})

test('stage: review state follows work, required artifacts, and high blockers', () => {
  const project = createProject({ name: 'X' })
  const stage = project.stages[0]
  assert.equal(stage.work.length, 4)
  assert.equal(stageState(stage).status, 'working')
  assert.equal(reviewBlockers(stage).filter(item => item.code === 'stage.review.artifactMissing').length, 3)
  for (const item of stage.work) item.done = true
  for (const item of stage.deliverables) if (item.required) item.status = 'present'
  assert.equal(stageState(stage).status, 'review-ready')
  stage.blockers.push({ id: 'b', text: '缺权限', severity: 'high', resolved: false })
  assert.equal(stageState(stage).status, 'blocked')
  stage.blockers[0].resolved = true
  assert.equal(stageState(stage).status, 'review-ready')
})

test('stage: optional artifact does not block review', () => {
  const project = createProject({ name: 'X' })
  const stage = project.stages[0]
  for (const item of stage.work) item.done = true
  for (const item of stage.deliverables) if (item.required) item.status = 'present'
  const optional = stage.deliverables.find(item => item.required === false)
  assert.equal(optional.status, 'missing')
  assert.equal(stageState(stage).status, 'review-ready')
})

test('digest: order-independent and changes with content', () => {
  const artifacts = [
    { id: 'b', required: true, hash: '2' },
    { id: 'a', required: true, hash: '1' },
    { id: 'optional', required: false, hash: '3' },
  ]
  const first = evidenceDigest(artifacts)
  const second = evidenceDigest([artifacts[1], artifacts[0], artifacts[2]])
  assert.equal(first, second)
  artifacts[0] = { ...artifacts[0], hash: '9' }
  assert.notEqual(first, evidenceDigest(artifacts))
})

test('decisions: Go requires review-ready, advances one stage, and returns preserve material', async t => {
  const { store, files } = await hostFixture(t)
  let state = await run(store, files, {
    op: 'project.create',
    name: '阶段门禁',
    owner: '张三',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  })
  const projectId = state.projects[0].id

  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.decide', projectId, stage: 0, outcome: 'go', rationale: '未就绪',
    }, { files, locale: 'zh' })),
    error => error.code === 'stage/not-ready' && error.status === 422,
  )

  state = await makeReady(store, files, projectId, 0)
  state = await run(store, files, {
    op: 'stage.decide', projectId, stage: 0, outcome: 'go', rationale: '证据齐备', decidedBy: 'FDE',
  })
  assert.equal(state.projects[0].currentStage, 1)
  assert.equal(state.projects[0].stages[0].decisions.at(-1).outcome, 'go')
  assert.equal(state.projects[0].status, 'active')
  const deliverablePath = `projects/${projectId}/${state.projects[0].stages[0].deliverables[0].path}`

  state = await run(store, files, {
    op: 'stage.return', projectId, reason: '范围需要重新定义',
  })
  assert.equal(state.projects[0].currentStage, 0)
  assert.equal(state.projects[0].reconfirmThrough, 1)
  assert.equal(state.projects[0].returns.length, 1)
  assert.ok((await files.read(deliverablePath)).text.includes('真实证据'))
  assert.equal(state.projects[0].stages[0].decisions.length, 1)

  state = await makeReady(store, files, projectId, 0)
  state = await run(store, files, {
    op: 'stage.decide', projectId, stage: 0, outcome: 'narrow', rationale: '缩小到对账主流程',
  })
  assert.equal(state.projects[0].currentStage, 0)
  assert.equal(state.projects[0].stages[0].decisions.at(-1).outcome, 'narrow')
})

test('decisions: Stop closes the project and rejects further progress', async t => {
  const { store, files } = await hostFixture(t)
  let state = await run(store, files, { op: 'project.create', name: '停止' })
  const projectId = state.projects[0].id
  state = await run(store, files, {
    op: 'stage.decide', projectId, stage: 0, outcome: 'stop', rationale: '客户取消',
  })
  assert.equal(state.projects[0].status, 'stopped')
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'stage.work.toggle', projectId, stage: 0, workId: state.projects[0].stages[0].work[0].id,
    }, { files, locale: 'zh' })),
    error => error.code === 'project/not-active',
  )
})

test('project: metadata dates, pause, and invalid ordering', async t => {
  const { store, files } = await hostFixture(t)
  let state = await run(store, files, {
    op: 'project.create', name: '元数据', startDate: '2026-02-01', endDate: '2026-03-01',
  })
  const projectId = state.projects[0].id
  assert.equal(state.projects[0].endDate, '2026-03-01')
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'project.update', projectId, startDate: '2026-05-01', endDate: '2026-04-01',
    }, { files, locale: 'zh' })),
    error => error.code === 'project/date-order' && error.status === 422,
  )
  state = await run(store, files, { op: 'project.status.set', projectId, status: 'paused' })
  assert.equal(state.projects[0].status, 'paused')
  state = await run(store, files, { op: 'project.status.set', projectId, status: 'active' })
  assert.equal(state.projects[0].status, 'active')
})

test('tasks: dependencies block completion, cycles are rejected, and blocked needs a reason', async t => {
  const { store, files } = await hostFixture(t)
  let state = await run(store, files, { op: 'project.create', name: '任务' })
  const projectId = state.projects[0].id
  state = await run(store, files, { op: 'task.create', projectId, title: 'A' })
  const a = state.projects[0].tasks[0].id
  state = await run(store, files, { op: 'task.create', projectId, title: 'B', dependencyIds: [a] })
  const b = state.projects[0].tasks.at(-1).id

  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'task.update', projectId, taskId: b, status: 'done',
    }, { files, locale: 'zh' })),
    error => error.code === 'task/dependency-open' && error.status === 422,
  )
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'task.update', projectId, taskId: a, dependencyIds: [b],
    }, { files, locale: 'zh' })),
    error => error.code === 'task/dependency-cycle',
  )
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'task.update', projectId, taskId: a, status: 'blocked',
    }, { files, locale: 'zh' })),
    error => error.code === 'task/blocked-reason',
  )
  state = await run(store, files, { op: 'task.update', projectId, taskId: a, status: 'done' })
  state = await run(store, files, { op: 'task.update', projectId, taskId: b, status: 'done' })
  assert.equal(state.projects[0].tasks.find(item => item.id === b).status, 'done')
})

test('documents: save and restore create new versions, archive is read-only, referenced delete is refused', async t => {
  const { store, files, root } = await hostFixture(t)
  let state = await run(store, files, { op: 'project.create', name: '文档' })
  const projectId = state.projects[0].id
  state = await run(store, files, { op: 'doc.create', title: '交付说明', projectId, template: 'delivery' })
  const docId = state.docs[0].id
  assert.equal(state.docs[0].currentVersion, 1)
  state = await run(store, files, { op: 'doc.save', docId, content: '# 第二版\n' })
  assert.equal(state.docs[0].currentVersion, 2)
  state = await run(store, files, { op: 'doc.restore', docId, version: 1 })
  assert.equal(state.docs[0].currentVersion, 3)
  assert.equal(state.docs[0].versions.at(-1).source, 'restore')
  const docMirror = JSON.parse(await readFile(join(root, 'projects', projectId, '.fde', 'documents.json'), 'utf8'))
  assert.equal(docMirror.documents[0].currentVersion, 3)

  state = await run(store, files, {
    op: 'stage.artifact.add', projectId, stage: 0, name: '引用文档', docId,
  })
  state = await run(store, files, { op: 'doc.update', docId, status: 'archived' })
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'doc.save', docId, content: '# 不应保存\n',
    }, { files, locale: 'zh' })),
    error => error.code === 'doc/archived',
  )
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'doc.delete', docId,
    }, { files, locale: 'zh' })),
    error => error.code === 'doc/referenced' && error.status === 409,
  )
  const artifactId = state.projects[0].stages[0].artifacts[0].id
  state = await run(store, files, {
    op: 'stage.artifact.remove', projectId, stage: 0, artifactId,
  })
  state = await run(store, files, { op: 'doc.delete', docId })
  assert.equal(state.docs.length, 0)
})

test('sources: metadata and references protect deletion', async t => {
  const { store, files } = await hostFixture(t)
  let state = await run(store, files, { op: 'project.create', name: '资料' })
  const projectId = state.projects[0].id
  state = await run(store, files, {
    op: 'source.add', projectId, name: '接口.md', mime: 'text/markdown', bytes: 10, sha256: 'x', version: 1,
    path: `projects/${projectId}/sources/f-1/1/接口.md`, sourceId: 'f-1',
  })
  state = await run(store, files, {
    op: 'stage.artifact.add', projectId, stage: 0, name: '引用资料', sourceId: 'f-1',
  })
  await assert.rejects(
    () => store.mutate(state.revision, current => applyMutation(current, {
      op: 'source.delete', projectId, sourceId: 'f-1',
    }, { files, locale: 'zh' })),
    error => error.code === 'source/referenced' && error.status === 409,
  )
})

test('migration: v1 index becomes v2 with a backup, four work items, and mirrors', async t => {
  const root = await tempRoot(t)
  const v1 = {
    schemaVersion: 1,
    revision: 4,
    updatedAt: '2026-10-01T00:00:00.000Z',
    migration: { legacyImportedAt: null, legacySchema: null },
    projects: [{
      id: 'p-old',
      name: '旧项目',
      customer: 'ACME',
      owner: '张三',
      targetDate: '2026-12-31',
      createdAt: '2026-09-01T00:00:00.000Z',
      currentStage: 1,
      deliveredAt: null,
      stages: Array.from({ length: 8 }, (_, index) => ({
        work: [
          { id: `w-${index}-0`, text: `旧工作 ${index}.0`, done: index < 1 },
          { id: `w-${index}-1`, text: `旧工作 ${index}.1`, done: false },
          { id: `w-${index}-2`, text: `旧工作 ${index}.2`, done: false },
        ],
        artifacts: index === 1 ? [{ id: 'a-old', name: '旧证据', kind: 'doc', status: 'pending', file: '' }] : [],
        blockers: [],
        decisions: index < 1 ? [{ id: 's-old', at: '2026-09-10T00:00:00.000Z', decision: '旧决定', kind: 'advance' }] : [],
        noteFile: `projects/p-old/stages/${index}.md`,
      })),
    }],
    opportunities: [],
    meetings: [],
    research: [],
    docs: [{
      id: 'd-old', title: '旧文档', template: 'delivery', projectId: 'p-old', stage: 0, status: 'draft',
      file: 'projects/p-old/docs/d-old.md', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  }
  const { WorkbenchStore } = await import('../src/host/store.js')
  const { WorkbenchFiles } = await import('../src/host/files.js')
  const { resolveConfig } = await import('../src/host/config.js')
  const { writeFile, stat } = await import('node:fs/promises')
  await writeFile(join(root, 'workbench.json'), JSON.stringify(v1), 'utf8')
  const config = resolveConfig({ root })
  const store = new WorkbenchStore({ root, limits: config.limits, logger: { info() {}, warn() {} } })
  const files = new WorkbenchFiles({ root, limits: config.limits })
  const read = await store.read()
  assert.ok(read.warnings.includes('state/migrated-v2'))
  assert.equal(read.state.schemaVersion, 2)
  assert.equal((await stat(join(root, 'workbench.v1.backup.json'))).isFile(), true)
  assert.equal(read.state.projects[0].stages[0].work.length, 4)
  assert.equal(read.state.projects[0].stages[0].work[0].text, '旧工作 0.0')
  assert.equal(read.state.projects[0].stages[0].decisions[0].legacy, true)
  assert.equal(read.state.docs[0].currentVersion, 1)
  const mirror = await readFile(join(root, 'projects', 'p-old', '.fde', 'stages', 'discovery.json'), 'utf8')
  assert.ok(mirror.includes('workItems'))
  const second = await store.read()
  assert.equal(second.warnings.includes('state/migrated-v2'), false)
})
