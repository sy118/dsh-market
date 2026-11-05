/**
 * In-process test runner.
 *
 * `node --test` spawns one child per file, which the Windows sandbox blocks
 * (`spawn EPERM`). Importing the suites here runs the same tests in one
 * process and keeps the command usable from the market repository.
 */
import './host-core.test.mjs'
import './delivery.test.mjs'
import './ai.test.mjs'
import './routes.test.mjs'
import './handoff.test.mjs'
import './index.test.mjs'
import './store.test.mjs'
import './client-units.test.mjs'
import './ui-render.test.mjs'
import './client-smoke.test.mjs'
import './package.test.mjs'
