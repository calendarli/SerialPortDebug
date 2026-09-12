import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import electron from 'electron'
import { run } from './optional'

const root = resolve(import.meta.dirname, '..')
await mkdir(resolve(root, 'build'), { recursive: true })
const result = await Bun.build({
  entrypoints: [resolve(root, 'scripts/firmware-ui-smoke.ts')],
  target: 'node',
  format: 'cjs',
  packages: 'external',
  outdir: resolve(root, 'build'),
  naming: 'firmware-ui-smoke.cjs'
})
if (!result.success) throw new AggregateError(result.logs, 'UI smoke compilation failed')
run(
  electron as unknown as string,
  [resolve(root, 'build/firmware-ui-smoke.cjs')],
  root,
  false,
  90000
)
