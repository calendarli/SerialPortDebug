import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function nextVersion(current: string, input: string): string {
  if (!stableVersion.test(current)) throw new Error(`Unsupported current version: ${current}`)
  const parts = current.split('.').map(BigInt)
  const index = ['major', 'minor', 'patch'].indexOf(input)
  let next = input
  if (index >= 0) {
    parts[index] += 1n
    for (let i = index + 1; i < parts.length; i++) parts[i] = 0n
    next = parts.join('.')
  }
  if (!stableVersion.test(next))
    throw new Error('Use patch, minor, major or a stable version (x.y.z)')
  const before = current.split('.').map(BigInt)
  const after = next.split('.').map(BigInt)
  const difference = after.findIndex((part, i) => part !== before[i])
  if (difference < 0 || after[difference] < before[difference])
    throw new Error('New version must be greater than the current version')
  return next
}

export function bumpVersion(input: string, cwd = process.cwd()): string {
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
  if (git('status', '--porcelain')) throw new Error('Commit or stash all changes before releasing')
  git('symbolic-ref', '--quiet', '--short', 'HEAD')
  git('var', 'GIT_AUTHOR_IDENT')
  git('var', 'GIT_COMMITTER_IDENT')
  const file = join(cwd, 'package.json')
  const original = readFileSync(file, 'utf8')
  const pkg = JSON.parse(original) as { version: string }
  const version = nextVersion(pkg.version, input)
  const tag = `v${version}`
  const tags = git('tag', '--list').split(/\r?\n/)
  if (tags.some((existing) => existing.toLowerCase() === tag))
    throw new Error(`Tag already exists: ${tag}`)
  pkg.version = version
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  // Bun's lockfile does not store the root package version; dependencies are unchanged.
  git('add', '--', 'package.json')
  git('commit', '-m', `chore(release): ${tag}`)
  // If signing/hooks fail, preserve the commit and report the error for manual recovery.
  git('tag', '-a', tag, '-m', `SerialFlow ${tag}`)
  return tag
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: bun run release:version patch|minor|major|x.y.z')
    const tag = bumpVersion(process.argv[2])
    console.log(`Created version commit and annotated tag ${tag}.`)
    console.log(`Publish with: git push --atomic origin HEAD refs/tags/${tag}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
