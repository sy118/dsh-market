/**
 * Durable state on disk.
 *
 * `workbench.json` is the cross-project index and the source of truth for
 * structured records. Project records are mirrored into `projects/<id>/.fde/`
 * so an agent can read them directly. Reads are serialized with writes, each
 * write goes through a temp file plus rename, the previous version stays as
 * `.bak`, and a corrupt file is quarantined instead of being silently replaced.
 */
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SCHEMA_VERSION } from '../shared/constants.js'
import { stageState } from '../shared/stage-state.js'
import { WorkbenchError } from './paths.js'
import { WorkbenchFiles } from './files.js'
import { migrateV1State } from './migrate-v1.js'
import { evidenceDigest } from './digest.js'
import { emptyState, enforceLimits, enforceProjectLimits, normalizeState, schemaVersionOf } from './schema.js'

const STATE_FILE = 'workbench.json'
const BACKUP_FILE = 'workbench.json.bak'
const V1_BACKUP_FILE = 'workbench.v1.backup.json'

/** UTF-8 byte length of a string. */
function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/** Read and parse one JSON file, or return `undefined` when it is absent. */
async function readJson(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  return { text, value: JSON.parse(text) }
}

/** Serialize the queue of state operations. */
export class WorkbenchStore {
  /**
   * @param {object} options - root directory, limits, logger, and an optional files facade.
   */
  constructor(options) {
    this.root = options.root
    this.limits = options.limits
    this.logger = options.logger
    this.file = join(this.root, STATE_FILE)
    this.backup = join(this.root, BACKUP_FILE)
    this.v1Backup = join(this.root, V1_BACKUP_FILE)
    this.files = options.files ?? new WorkbenchFiles({ root: this.root, limits: this.limits, logger: this.logger })
    this.queue = Promise.resolve()
    this.cached = undefined
  }

  /** Run one operation after every earlier operation settled. */
  #serialize(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Create the data directory. */
  async ensureReady() {
    await mkdir(this.root, { recursive: true })
  }

  /**
   * Read the current state.
   * @returns {object} state plus read-only, warnings, and recovery flags.
   */
  async read() {
    return this.#serialize(() => this.#readUnlocked())
  }

  /**
   * Apply one mutation under the queue.
   * @param {number|null} baseRevision - revision the caller saw.
   * @param {(state: object) => object|void} mutate - synchronous edit of the state.
   * @returns {object} the new state plus warnings.
   */
  async mutate(baseRevision, mutate) {
    return this.#serialize(async () => {
      const current = await this.#readUnlocked()
      if (current.readOnly) {
        throw new WorkbenchError('state/version', 409, 'state was written by a newer workbench', {
          schemaVersion: current.state.schemaVersion,
          supported: SCHEMA_VERSION,
        })
      }
      if (Number.isInteger(baseRevision) && baseRevision !== current.state.revision) {
        throw new WorkbenchError('state/conflict', 409, 'state changed since it was loaded', {
          revision: current.state.revision,
          expected: baseRevision,
          state: current.state,
        })
      }
      const outcome = await mutate(current.state)
      for (const collection of ['projects', 'opportunities', 'meetings', 'research', 'docs']) {
        enforceLimits(current.state, this.limits, collection)
      }
      for (const project of current.state.projects) enforceProjectLimits(project, this.limits)
      if (outcome?.projectId !== undefined && outcome.projectId !== '') {
        const project = current.state.projects.find(item => item.id === outcome.projectId)
        if (project !== undefined) await this.#decorateProject(project)
      }
      current.state.revision += 1
      current.state.updatedAt = new Date().toISOString()
      await this.#write(current.state)
      if (outcome?.projectId !== undefined && outcome.projectId !== '') {
        const project = current.state.projects.find(item => item.id === outcome.projectId)
        if (project !== undefined) await this.#syncProject(project, current.state)
      }
      if (outcome?.removedProjectId !== undefined) {
        await rm(join(this.root, 'projects', outcome.removedProjectId), { recursive: true, force: true })
      }
      this.cached = current.state
      return { state: current.state, warnings: current.warnings, result: outcome }
    })
  }

  /**
   * Replace the whole state, used by the legacy importer.
   * @param {number|null} baseRevision - revision the caller saw.
   * @param {object} next - already-normalized state.
   */
  async replace(baseRevision, next) {
    return this.#serialize(async () => {
      const current = await this.#readUnlocked()
      if (Number.isInteger(baseRevision) && baseRevision !== current.state.revision) {
        throw new WorkbenchError('state/conflict', 409, 'state changed since it was loaded', {
          revision: current.state.revision,
          expected: baseRevision,
          state: current.state,
        })
      }
      const state = normalizeState({ ...next, revision: current.state.revision + 1 })
      for (const collection of ['projects', 'opportunities', 'meetings', 'research', 'docs']) {
        enforceLimits(state, this.limits, collection)
      }
      for (const project of state.projects) enforceProjectLimits(project, this.limits)
      await this.#decorate(state)
      state.updatedAt = new Date().toISOString()
      await this.#write(state)
      for (const project of state.projects) await this.#syncProject(project, state)
      this.cached = state
      return { state, warnings: [] }
    })
  }

  /** Recompute deliverable facts and the derived stage status. */
  async #decorateProject(project) {
    for (const stage of project.stages) {
      for (const deliverable of stage.deliverables) {
        const inspected = await this.files.inspect(`projects/${project.id}/${deliverable.path}`)
        deliverable.status = inspected.status
        deliverable.bytes = inspected.bytes
        deliverable.hash = inspected.hash
        deliverable.updatedAt = inspected.updatedAt
        deliverable.error = inspected.error
      }
      const derived = stageState(stage)
      stage.status = derived.status
      stage.reviewBlockers = derived.blockers
      stage.evidenceDigest = evidenceDigest(stage.deliverables)
    }
  }

  /** Decorate every project after a read or a full replace. */
  async #decorate(state) {
    for (const project of state.projects) await this.#decorateProject(project)
  }

  /** Read, recover, or quarantine the file. Caller holds the queue. */
  async #readUnlocked() {
    await this.ensureReady()
    const warnings = []
    let parsed
    try {
      parsed = await readJson(this.file)
    } catch (error) {
      if (error instanceof SyntaxError) {
        const recovered = await this.#recoverFromBackup()
        if (recovered !== undefined) {
          warnings.push('state/recovered-from-backup')
          await this.#decorate(recovered)
          return { state: recovered, readOnly: false, warnings, recovered: true }
        }
        await this.#quarantineCorrupt()
        warnings.push('state/corrupt-quarantined')
        return { state: emptyState(), readOnly: false, warnings, recovered: true }
      }
      throw error
    }
    if (parsed === undefined) {
      this.cached = emptyState()
      return { state: this.cached, readOnly: false, warnings, recovered: false }
    }
    const version = schemaVersionOf(parsed.value)
    if (version !== null && version > SCHEMA_VERSION) {
      return { state: normalizeState(parsed.value), readOnly: true, warnings: ['state/newer-version'], recovered: false }
    }
    if (version === 1) {
      return this.#migrateV1(parsed.value, warnings)
    }
    this.cached = normalizeState(parsed.value)
    await this.#decorate(this.cached)
    return { state: this.cached, readOnly: false, warnings, recovered: false }
  }

  /** Back up and migrate a v1 index, then create the per-project mirrors. */
  async #migrateV1(raw, warnings) {
    let backupExists = true
    try {
      await stat(this.v1Backup)
    } catch (error) {
      if (error.code === 'ENOENT') backupExists = false
      else throw error
    }
    if (!backupExists) await copyFile(this.file, this.v1Backup)
    let state
    try {
      state = migrateV1State(raw, { locale: 'zh' })
    } catch (error) {
      throw new WorkbenchError('state/migration-failed', 500, 'schema v1 could not be migrated', {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
    await this.#decorate(state)
    await this.#write(state)
    for (const project of state.projects) await this.#syncProject(project, state)
    warnings.push('state/migrated-v2')
    this.logger?.info?.('fde-workbench: migrated schema v1 to v2')
    this.cached = state
    return { state, readOnly: false, warnings, recovered: false }
  }

  /** Use `.bak` when the main file no longer parses; restore it as the main file. */
  async #recoverFromBackup() {
    let backup
    try {
      backup = await readJson(this.backup)
    } catch {
      return undefined
    }
    if (backup === undefined) return undefined
    const state = normalizeState(backup.value)
    state.revision += 1
    state.updatedAt = new Date().toISOString()
    await this.#write(state, { skipBackup: true })
    this.logger?.warn?.('fde-workbench: state recovered from backup')
    return state
  }

  /** Move an unparseable file aside so a later write cannot destroy it. */
  async #quarantineCorrupt() {
    const target = `${this.file}.corrupt-${Date.now()}`
    try {
      await rename(this.file, target)
      this.logger?.warn?.(`fde-workbench: corrupt state moved to ${target}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  /** Serialize, size-check, back up, and atomically replace the state file. */
  async #write(state, options = {}) {
    const text = `${JSON.stringify(state, null, 2)}\n`
    if (byteLength(text) > this.limits.stateBytes) {
      throw new WorkbenchError('state/too-large', 413, 'state exceeds the configured size', {
        bytes: byteLength(text),
        limit: this.limits.stateBytes,
      })
    }
    await mkdir(dirname(this.file), { recursive: true })
    if (options.skipBackup !== true) {
      try {
        await stat(this.file)
        await copyFile(this.file, this.backup)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    const temp = `${this.file}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
    await writeFile(temp, text, 'utf8')
    try {
      await rename(temp, this.file)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  /** Write one JSON file under the root atomically. */
  async #writeJson(relativePath, value) {
    const absolute = join(this.root, ...relativePath.split('/'))
    await mkdir(dirname(absolute), { recursive: true })
    const temp = `${absolute}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temp, absolute)
  }

  /** Mirror one project into its `.fde` directory and seed deliverable parents. */
  async #syncProject(project, state) {
    const base = `projects/${project.id}`
    await mkdir(join(this.root, ...base.split('/'), 'fde-deliverables'), { recursive: true })
    await this.#writeJson(`${base}/.fde/project.json`, {
      schemaVersion: SCHEMA_VERSION,
      id: project.id,
      name: project.name,
      customer: project.customer,
      owner: project.owner,
      startDate: project.startDate,
      endDate: project.endDate,
      status: project.status,
      currentStage: project.currentStage,
      deliveredAt: project.deliveredAt,
      reconfirmThrough: project.reconfirmThrough,
      returns: project.returns,
      updatedAt: project.updatedAt,
    })
    for (let index = 0; index < project.stages.length; index += 1) {
      const stage = project.stages[index]
      await this.#writeJson(`${base}/.fde/stages/${stage.id}.json`, {
        schemaVersion: SCHEMA_VERSION,
        stage: stage.id,
        index,
        status: stage.status,
        workItems: stage.work,
        deliverables: stage.deliverables,
        blockers: stage.blockers,
        decisions: stage.decisions,
        reviewBlockers: stage.reviewBlockers,
        noteFile: stage.noteFile,
      })
      for (const deliverable of stage.deliverables) {
        await mkdir(dirname(join(this.root, ...`${base}/${deliverable.path}`.split('/'))), { recursive: true })
      }
    }
    await this.#writeJson(`${base}/.fde/tasks.json`, { schemaVersion: SCHEMA_VERSION, tasks: project.tasks })
    await this.#writeJson(`${base}/.fde/sources.json`, { schemaVersion: SCHEMA_VERSION, sources: project.sources })
    await this.#writeJson(`${base}/.fde/documents.json`, {
      schemaVersion: SCHEMA_VERSION,
      documents: state.docs.filter(doc => doc.projectId === project.id),
    })
  }
}
