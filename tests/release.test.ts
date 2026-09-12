import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bumpVersion, nextVersion } from '../scripts/release-version'
import { generateReleaseNotes } from '../scripts/release-notes'

function repository(action: (cwd: string, git: (...args: string[]) => string) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), 'serialflow-release-test-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
  try {
    git('init', '--quiet')
    git('config', 'user.name', 'Release Test')
    git('config', 'user.email', 'release-test@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'tag.gpgsign', 'false')
    git('config', 'core.hooksPath', join(cwd, 'no-hooks'))
    writeFileSync(join(cwd, 'package.json'), '{"name":"fixture","version":"1.2.3"}\n')
    git('add', 'package.json')
    git('commit', '--quiet', '-m', 'feat: initial application')
    action(cwd, git)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('version increments and explicit versions reject malformed, equal and lower values', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4')
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0')
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0')
  assert.equal(nextVersion('1.2.3', '1.10.0'), '1.10.0')
  for (const input of ['1.2.3', '1.2.2', '0.9.9', '01.3.0', 'v1.3.0', '1.3.0-beta.1', '--help'])
    assert.throws(() => nextVersion('1.2.3', input))
})

test('version command creates a clean version commit and annotated tag at the same commit', () => {
  repository((cwd, git) => {
    assert.equal(bumpVersion('patch', cwd), 'v1.2.4')
    assert.equal(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version, '1.2.4')
    assert.equal(git('status', '--porcelain'), '')
    assert.equal(git('log', '-1', '--format=%s'), 'chore(release): v1.2.4')
    assert.equal(git('cat-file', '-t', 'v1.2.4'), 'tag')
    assert.equal(git('rev-parse', 'v1.2.4^{commit}'), git('rev-parse', 'HEAD'))
  })
})

test('dirty tree, duplicate legacy tag and detached HEAD do not change package version', () => {
  repository((cwd, git) => {
    const file = join(cwd, 'package.json')
    const original = readFileSync(file, 'utf8')
    writeFileSync(join(cwd, 'untracked.txt'), 'work in progress')
    assert.throws(() => bumpVersion('patch', cwd), /Commit or stash/)
    git('add', 'untracked.txt')
    git('commit', '--quiet', '-m', 'docs: fixture')
    git('tag', 'V1.2.4')
    assert.throws(() => bumpVersion('patch', cwd), /Tag already exists/)
    git('checkout', '--detach', '--quiet')
    assert.throws(() => bumpVersion('minor', cwd))
    assert.equal(readFileSync(file, 'utf8'), original)
  })
})

test('notes include direct commits since the legacy tag and skip the release commit', () => {
  repository((cwd, git) => {
    git('tag', 'V1.2.3')
    git('commit', '--allow-empty', '--quiet', '-m', 'fix(serial): 修复断开连接')
    git('commit', '--allow-empty', '--quiet', '-m', 'feat!: new protocol')
    git('commit', '--allow-empty', '--quiet', '-m', '普通改进')
    bumpVersion('patch', cwd)
    const notes = generateReleaseNotes('v1.2.4', cwd)
    assert.match(notes, /## 问题修复/)
    assert.match(notes, /修复断开连接/)
    assert.match(notes, /## 不兼容变更/)
    assert.match(notes, /普通改进/)
    assert.match(notes, /compare\/V1.2.3\.\.\.v1.2.4/)
    assert.doesNotMatch(notes, /initial application|chore\(release\)/)
  })
})

test('first release includes history, even if the tag is on the root commit', () => {
  repository((cwd, git) => {
    git('tag', 'v1.2.3')
    assert.match(generateReleaseNotes('v1.2.3', cwd), /initial application/)
    git('commit', '--allow-empty', '--quiet', '-m', 'fix: more work')
    assert.throws(() => generateReleaseNotes('v1.2.3', cwd), /point at HEAD/)
  })
})

test('notes reject tag/package mismatches and unsupported versions', () => {
  repository((cwd) => {
    assert.throws(() => generateReleaseNotes('v1.2.4', cwd), /does not match/)
    assert.throws(() => generateReleaseNotes('v1.3.0-beta.1', cwd), /Invalid release tag/)
    assert.throws(() => generateReleaseNotes('--all', cwd), /Invalid release tag/)
  })
})
