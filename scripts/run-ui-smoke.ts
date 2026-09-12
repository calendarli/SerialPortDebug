import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import electron from 'electron'
import { run } from './optional'

const root = resolve(import.meta.dirname, '..')
const suite =
  process.argv[2] === 'updates'
    ? 'update-ui-smoke'
    : process.argv[2] === 'serial'
      ? 'serial-ui-performance'
      : 'firmware-ui-smoke'
await mkdir(resolve(root, 'build'), { recursive: true })
const result = await Bun.build({
  entrypoints: [resolve(root, `scripts/${suite}.ts`)],
  target: 'node',
  format: 'cjs',
  packages: 'external',
  outdir: resolve(root, 'build'),
  naming: `${suite}.cjs`
})
if (!result.success) throw new AggregateError(result.logs, 'UI smoke compilation failed')
run(electron as unknown as string, [resolve(root, `build/${suite}.cjs`)], root, false, 90000)
