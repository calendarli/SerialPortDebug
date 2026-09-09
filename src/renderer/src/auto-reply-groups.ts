import type { AutoReplyGroup, Rule } from './types'

export function saveReplyGroup(
  groups: AutoReplyGroup[],
  id: number | null,
  input: string
): AutoReplyGroup[] {
  const name = input.trim()
  if (!name) throw new Error('请输入分组名称')
  if (groups.some((group) => group.id !== id && group.name === name))
    throw new Error('分组名称已存在')
  if (id !== null) {
    if (!groups.some((group) => group.id === id)) throw new Error('分组已不存在')
    return groups.map((group) => (group.id === id ? { ...group, name } : group))
  }
  const nextId = Math.max(Date.now(), ...groups.map((group) => group.id + 1))
  return [...groups, { id: nextId, name, globals: {} }]
}

export function removeReplyGroup(
  groups: AutoReplyGroup[],
  rules: Rule[],
  id: number,
  targetId: number
): {
  groups: AutoReplyGroup[]
  rules: Rule[]
  movedIds: number[]
} {
  if (groups.length <= 1) throw new Error('至少保留一个变量分组')
  if (!groups.some((group) => group.id === id)) throw new Error('分组已不存在')
  if (id === targetId || !groups.some((group) => group.id === targetId))
    throw new Error('请选择有效的目标分组')
  return {
    groups: groups.filter((group) => group.id !== id),
    rules: rules.map((rule) =>
      rule.groupId === id ? { ...rule, groupId: targetId, enabled: false } : rule
    ),
    movedIds: rules.filter((rule) => rule.groupId === id).map((rule) => rule.id)
  }
}
