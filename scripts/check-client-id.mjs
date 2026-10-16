/**
 * Guard for the client bundle's registration id.
 *
 * The browser module system looks the package up by the id a bundle passes to
 * `__ModuleLoader__.load({ id })`, so that id must equal the package name. A
 * mismatch loads the bundle without registering it and fails the whole entry:
 *
 *   client-modules: could not load "@scope/pkg" …
 *   loaded without registering "@scope/pkg" via __ModuleLoader__.load
 *
 * The factory is only queued here, never called, so no React or DOM is needed.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

let registration = null
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      registration = value
    },
  },
}

await import(new URL('../client.js', import.meta.url).href)

const problems = []
if (registration === null) {
  problems.push('client.js never called window.__ModuleLoader__.load({ ... })')
} else {
  if (registration.id !== pkg.name) {
    problems.push(`client.js registers id "${registration.id}", but the package name is "${pkg.name}"`)
  }
  if (typeof registration.factory !== 'function') {
    problems.push('client.js registered without a factory function')
  }
}

if (problems.length > 0) {
  console.error('client bundle check failed:\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log(`client bundle check ok: registers "${registration.id}"`)
