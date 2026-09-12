import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stableVersion } from './release-version'

export function generateReleaseNotes(tag: string, cwd = process.cwd()): string {
  const version = tag.replace(/^[vV]/, '')
  if (!/^[vV]/.test(tag) || !stableVersion.test(version))
    throw new Error(`Invalid release tag: ${tag}`)
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { version: string }
  if (pkg.version !== version)
    throw new Error(`Tag ${tag} does not match package version ${pkg.version}`)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
  if (git('rev-parse', `${tag}^{commit}`) !== git('rev-parse', 'HEAD'))
    throw new Error('Release tag must point at HEAD')
  const hasParent = git('rev-list', '--parents', '-n', '1', tag).split(' ').length > 1
  const previousTags = hasParent
    ? git('tag', '--merged', `${tag}^`, '--sort=-version:refname')
        .split(/\r?\n/)
        .filter((name) => /^[vV]/.test(name) && stableVersion.test(name.slice(1)))
    : []
  // git describe finds the closest reachable version tag, including legacy uppercase V tags.
  const previous = previousTags.length
    ? git(
        'describe',
        '--tags',
        '--abbrev=0',
        ...previousTags.flatMap((name) => ['--match', name]),
        `${tag}^`
      )
    : ''
  const range = previous ? `${previous}..${tag}` : tag
  const entries = git('log', '--no-merges', '--reverse', '--format=%H%x09%s', range)
  const groups = new Map<string, string[]>()
  for (const line of entries.split('\n').filter(Boolean)) {
    const [hash, ...subjectParts] = line.split('\t')
    const subject = subjectParts.join('\t').replace(/\r$/, '')
    if (/^chore\(release\):/i.test(subject)) continue
    const type = /^([a-z]+)(?:\([^)]*\))?(!)?:/i.exec(subject)
    const category = type?.[2]
      ? '不兼容变更'
      : ({ feat: '新功能', fix: '问题修复', perf: '性能优化', docs: '文档' }[type?.[1] ?? ''] ??
        '其他改进')
    const items = groups.get(category) ?? []
    // Escape HTML/Markdown from commit subjects; full details remain available in the commit.
    const escaped = subject.replace(/[\\`*_{}[\]<>]/g, '\\$&')
    items.push(`- ${escaped} (${hash.slice(0, 7)})`)
    groups.set(category, items)
  }
  const sections = ['不兼容变更', '新功能', '问题修复', '性能优化', '文档', '其他改进']
    .filter((category) => groups.has(category))
    .map((category) => `## ${category}\n\n${groups.get(category)!.join('\n')}`)
  const repo = process.env.GITHUB_REPOSITORY || 'calendarli/SerialFlow'
  const url = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}`
  const compare = previous
    ? `[完整变更](${url}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(tag)})`
    : `[提交记录](${url}/commits/${encodeURIComponent(tag)})`
  return `# SerialFlow ${tag}\n\n${sections.join('\n\n') || '版本更新。'}\n\n${compare}\n`
}

if (import.meta.main) {
  const [tag, output] = process.argv.slice(2)
  if (!tag) throw new Error('Usage: bun run release:notes <tag> [output.md]')
  const notes = generateReleaseNotes(tag)
  if (output) writeFileSync(output, notes)
  else process.stdout.write(notes)
}
