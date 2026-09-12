import { expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('project commands run Node shebangs and nested runtime calls with Bun', () => {
  const directory = mkdtempSync(join(tmpdir(), 'serialflow-runtime-'))
  try {
    copyFileSync(resolve(import.meta.dirname, '../bunfig.toml'), join(directory, 'bunfig.toml'))
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ scripts: { probe: 'bun cli.cjs' } })
    )
    const entrypoint = join(directory, 'cli.cjs')
    writeFileSync(
      entrypoint,
      `#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
console.log(JSON.stringify({
  runtime: process.versions.bun,
  child: execFileSync('node', ['-p', 'process.versions.bun'], { encoding: 'utf8' }).trim()
}))
`
    )
    const result = Bun.spawnSync([process.execPath, 'run', 'probe'], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 20000
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({
      runtime: Bun.version,
      child: Bun.version
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)
