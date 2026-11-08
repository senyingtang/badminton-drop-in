// Test-only loader: resolves the "@/..." alias (web/src) and extensionless relative imports to .ts,
// so Node's built-in type stripping can run the security unit tests without a bundler.
import { register } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
const SRC = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src') + '/').href
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = SRC + spec.slice(2)
  try { return await next(spec, ctx) } catch (e) {
    const rel = spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('file:')
    if (rel && !/\.[cm]?[jt]sx?$/.test(spec)) {
      try { return await next(spec + '.ts', ctx) } catch { return next(spec + '/index.ts', ctx) }
    }
    throw e
  }
}`))
