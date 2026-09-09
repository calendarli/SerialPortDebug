import { ProgramCodeEditor } from './ProgramCodeEditor'
import { useEffect, useRef, useState } from 'react'
import type { AutoReplyGroup, Rule, TargetPortOption } from '../types'
import { defaultAutoReplyProgram, upgradeAutoReplyProgram } from '../scripts/auto-reply-program'
import { saveReplyGroup } from '../auto-reply-groups'

type Props = {
  rules: Rule[]
  setRules: (rules: Rule[]) => void
  groups: AutoReplyGroup[]
  setGroups: (groups: AutoReplyGroup[]) => void
  onDeleteGroup: (groupId: number, targetGroupId: number) => void
  targetPorts: TargetPortOption[]
  onResetState: (ruleId: number, notify?: boolean) => void
  onImport: () => Promise<boolean>
  onExport: () => void
}
type DraftParameter = { id: string }
const ruleModalSizeKey = 'serialflow.autoReplyModalSize'
type Draft = {
  groupId: number
  name: string
  pattern: string
  regex: boolean
  receiveHex: boolean
  reply: string
  hex: boolean
  targetPort: string
  parameterMode: 'parameters' | 'program'
  parameters: DraftParameter[]
  parameterProgram: string
}
const emptyDraft = (): Draft => ({
  groupId: 1,
  name: '',
  pattern: '',
  regex: false,
  receiveHex: false,
  reply: '',
  hex: false,
  targetPort: '',
  parameterMode: 'parameters',
  parameters: [],
  parameterProgram: defaultAutoReplyProgram
})

function isProgramRule(rule: Rule | undefined): boolean {
  return rule?.parameterMode === 'program'
}

function parameterValuePlaceholder(mode: 'ascii' | 'dec' | 'hex'): string {
  if (mode === 'ascii') return 'ASCII 文本'
  if (mode === 'dec') return 'DEC 0 及以上'
  return 'HEX 0-9、A-F（任意位）'
}

function extractPlaceholderIds(template: string): string[] {
  return [
    ...new Set(
      [...template.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1].trim()).filter(Boolean)
    )
  ]
}

function extractReturnedParameterIds(source: string): string[] {
  const ids: string[] = []
  const returnObjectPattern = /\breturn\s*\{([\s\S]*?)\}/g
  for (const objectMatch of source.matchAll(returnObjectPattern)) {
    const body = objectMatch[1]
    const propertyPattern =
      /(?:^|,)\s*(?:(['"])([^'"\r\n]+)\1|([\p{L}_$][\p{L}\p{N}_$]*))\s*(?=:|,|$)/gu
    for (const propertyMatch of body.matchAll(propertyPattern)) {
      const id = (propertyMatch[2] || propertyMatch[3] || '').trim()
      if (id && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

export function AutoReplyPanel({
  rules,
  setRules,
  groups,
  setGroups,
  onDeleteGroup,
  targetPorts,
  onResetState,
  onImport,
  onExport
}: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState('')
  const [groupEditor, setGroupEditor] = useState<{ id: number | null; name: string } | null>(null)
  const [groupDeletion, setGroupDeletion] = useState<{ id: number; targetId: number } | null>(null)
  const [groupError, setGroupError] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [collapsedRuleIds, setCollapsedRuleIds] = useState<Set<number>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; ruleId: number | null } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  useEffect(() => {
    const modal = modalRef.current
    if (!creating || !modal) return
    try {
      const saved = JSON.parse(localStorage.getItem(ruleModalSizeKey) || 'null') as {
        width?: number
        height?: number
        layoutVersion?: number
      } | null
      // Older widths belong to the single-column editor; use the new CSS default once.
      if (saved?.layoutVersion === 2 && Number.isFinite(saved.width)) {
        modal.style.width = `${Math.min(Math.max(500, saved.width!), window.innerWidth - 24)}px`
      }
      if (saved && Number.isFinite(saved.height)) {
        modal.style.height = `${Math.min(Math.max(800, saved.height!), window.innerHeight - 24)}px`
      }
    } catch {
      localStorage.removeItem(ruleModalSizeKey)
    }
    let persistTimer = 0
    const persistSize = (): void => {
      window.clearTimeout(persistTimer)
      persistTimer = window.setTimeout(() => {
        localStorage.setItem(
          ruleModalSizeKey,
          JSON.stringify({ width: modal.offsetWidth, height: modal.offsetHeight, layoutVersion: 2 })
        )
      }, 120)
    }
    const observer = new ResizeObserver(persistSize)
    observer.observe(modal)
    return () => {
      observer.disconnect()
      window.clearTimeout(persistTimer)
      localStorage.setItem(
        ruleModalSizeKey,
        JSON.stringify({ width: modal.offsetWidth, height: modal.offsetHeight, layoutVersion: 2 })
      )
    }
  }, [creating])

  const update = (id: number, patch: Partial<Rule>): void =>
    setRules(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  const updateParameter = (rule: Rule, parameterId: string, value: string): void => {
    update(rule.id, {
      parameters: rule.parameters.map((parameter) =>
        parameter.id === parameterId ? { ...parameter, value } : parameter
      )
    })
  }
  const updateParameterMode = (
    rule: Rule,
    parameterId: string,
    inputMode: 'ascii' | 'dec' | 'hex'
  ): void => {
    update(rule.id, {
      parameters: rule.parameters.map((parameter) =>
        parameter.id === parameterId ? { ...parameter, inputMode } : parameter
      )
    })
  }
  const updateDraftParameter = (index: number, patch: Partial<DraftParameter>): void => {
    setDraft((current) => ({
      ...current,
      parameters: current.parameters.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    }))
  }
  const openCreate = (): void => {
    setEditingRuleId(null)
    setDraft({
      ...emptyDraft(),
      groupId: groups[0]?.id || 1,
      targetPort: targetPorts[0]?.path || ''
    })
    setError('')
    setCreating(true)
  }
  const openEdit = (id: number): void => {
    const rule = rules.find((item) => item.id === id)
    if (!rule) return
    setEditingRuleId(id)
    setDraft({
      groupId: rule.groupId || groups[0]?.id || 1,
      name: rule.name,
      pattern: rule.pattern,
      regex: rule.regex !== false,
      receiveHex: rule.hex,
      reply: rule.reply,
      hex: rule.hex,
      targetPort: rule.targetPort || targetPorts[0]?.path || '',
      parameterMode:
        rule.parameterMode === 'program' ||
        rule.parameters.some((parameter) => parameter.mode === 'program')
          ? 'program'
          : 'parameters',
      parameters: rule.parameters.map((parameter) => ({ id: parameter.id })),
      parameterProgram: upgradeAutoReplyProgram(rule.parameterProgram)
    })
    setError('')
    setCreating(true)
    setMenu(null)
  }
  const openMenu = (event: React.MouseEvent, ruleId: number | null): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 170),
      y: Math.min(event.clientY, window.innerHeight - 90),
      ruleId
    })
  }
  const copyPlaceholder = async (id: string, index: number): Promise<void> => {
    const cleanId = id.trim()
    if (!cleanId) return
    try {
      await navigator.clipboard.writeText(`{{${cleanId}}}`)
      setCopiedIndex(index)
      window.setTimeout(
        () => setCopiedIndex((current) => (current === index ? null : current)),
        1200
      )
    } catch {
      setError('复制失败，请检查剪贴板权限')
    }
  }
  const insertProgramTab = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    const next = `${draft.parameterProgram.slice(0, start)}\t${draft.parameterProgram.slice(end)}`
    setDraft((current) => ({ ...current, parameterProgram: next }))
    window.requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1))
  }
  const saveRule = (): void => {
    if (!draft.name.trim()) return setError('请输入规则名称')
    if (!draft.pattern.trim()) return setError('请输入接收匹配表达式')
    if (draft.receiveHex && !draft.regex && !/^(?:[0-9a-f]{2}\s*)+$/i.test(draft.pattern)) {
      return setError('HEX 接收内容必须由成对的 0-9、A-F 字节组成')
    }
    if (draft.regex) {
      try {
        new RegExp(draft.pattern)
      } catch {
        return setError('接收匹配表达式不是有效的正则')
      }
    }
    if (!draft.reply) return setError('请输入发送指令')
    if (!draft.targetPort) return setError('请选择目标端口')
    const definedParameters = draft.parameters
      .map((parameter) => ({ ...parameter, id: parameter.id.trim() }))
      .filter((parameter) => Boolean(parameter.id))
    const placeholders = extractPlaceholderIds(draft.reply)
    const returnedParameters = extractReturnedParameterIds(draft.parameterProgram)
    const parameters =
      draft.parameterMode === 'program'
        ? returnedParameters.map((id) => ({ id }))
        : definedParameters
    const ids = parameters.map((parameter) => parameter.id)
    if (ids.some((id) => /[{}]/.test(id))) return setError('参数名字不能包含花括号')
    if (new Set(ids).size !== ids.length) return setError('参数名字不能重复')
    if (draft.parameterMode === 'program' && placeholders.length && !returnedParameters.length)
      return setError('未识别到程序返回参数，请使用 return { 参数名: 值 } 格式')
    const undefinedPlaceholder = placeholders.find(
      (id) => !id.startsWith('global.') && !ids.includes(id)
    )
    if (undefinedPlaceholder)
      return setError(
        draft.parameterMode === 'program'
          ? `发送占位符“${undefinedPlaceholder}”与程序返回参数不一致`
          : `发送指令中的参数“${undefinedPlaceholder}”尚未定义`
      )
    if (draft.parameterMode === 'program') {
      if (!draft.parameterProgram.trim()) return setError('请输入编程模式代码')
      if (!/\bfunction\s+calculate\b|\bcalculate\s*(?::[^=]+)?=/.test(draft.parameterProgram))
        return setError('编程模式必须定义 calculate(input, match, context) 函数')
    }
    if (editingRuleId === null) {
      setRules([
        ...rules,
        {
          id: Date.now(),
          groupId: draft.groupId,
          name: draft.name.trim(),
          pattern: draft.pattern,
          regex: draft.regex,
          receiveHex: draft.receiveHex,
          reply: draft.reply,
          hex: draft.hex,
          enabled: true,
          targetPort: draft.targetPort,
          parameterMode: draft.parameterMode,
          parameterProgram: draft.parameterProgram,
          parameters: parameters.map((parameter) => ({
            ...parameter,
            value: '',
            inputMode: draft.hex ? ('hex' as const) : ('ascii' as const)
          }))
        }
      ])
    } else {
      const current = rules.find((rule) => rule.id === editingRuleId)
      if (!current) return setError('要编辑的自动回复规则不存在')
      setRules(
        rules.map((rule) =>
          rule.id === editingRuleId
            ? {
                ...rule,
                groupId: draft.groupId,
                name: draft.name.trim(),
                pattern: draft.pattern,
                regex: draft.regex,
                receiveHex: draft.receiveHex,
                reply: draft.reply,
                hex: draft.hex,
                targetPort: draft.targetPort,
                parameterMode: draft.parameterMode,
                parameterProgram: draft.parameterProgram,
                parameters: parameters.map((parameter) => ({
                  ...parameter,
                  value: current.parameters.find((item) => item.id === parameter.id)?.value || '',
                  inputMode:
                    current.parameters.find((item) => item.id === parameter.id)?.inputMode ||
                    (draft.hex ? ('hex' as const) : ('ascii' as const))
                }))
              }
            : rule
        )
      )
      if (
        current.parameterProgram !== draft.parameterProgram ||
        current.parameterMode !== draft.parameterMode ||
        current.parameters.map((parameter) => parameter.id).join('\u0000') !==
          parameters.map((parameter) => parameter.id).join('\u0000')
      )
        onResetState(current.id)
    }
    setCreating(false)
    setEditingRuleId(null)
  }

  const detectedProgramParameters = extractReturnedParameterIds(draft.parameterProgram)

  const saveGroup = (): void => {
    if (!groupEditor) return
    try {
      setGroups(saveReplyGroup(groups, groupEditor.id, groupEditor.name))
      setGroupEditor(null)
    } catch (cause) {
      setGroupError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const deleteGroup = (): void => {
    if (!groupDeletion) return
    try {
      onDeleteGroup(groupDeletion.id, groupDeletion.targetId)
      setGroupDeletion(null)
    } catch (cause) {
      setGroupError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="auto-reply-panel" onContextMenu={(event) => openMenu(event, null)}>
      <div className="side-section-head">
        <div>
          <strong>自动回复规则</strong>
          <div className="auto-reply-subtitle">
            <small>右键新建或删除</small>
            <span className="side-section-count">
              {rules.filter((rule) => rule.enabled).length} 启用
            </span>
          </div>
        </div>
        <div className="side-section-actions">
          <button
            onClick={() => {
              setGroupError('')
              setGroupEditor({ id: null, name: '' })
            }}
          >
            ＋ 分组
          </button>
          <button onClick={() => void onImport()}>导入</button>
          <button onClick={onExport}>导出</button>
        </div>
      </div>
      <div className="auto-reply-group-list">
        {groups.map((group) => (
          <div key={group.id}>
            <strong title={group.name}>{group.name}</strong>
            <span>global · {Object.keys(group.globals).length}</span>
            <button
              aria-label={`编辑分组 ${group.name}`}
              onClick={() => {
                setGroupError('')
                setGroupEditor({ id: group.id, name: group.name })
              }}
            >
              编辑
            </button>
            <button
              aria-label={`删除分组 ${group.name}`}
              disabled={groups.length <= 1}
              title={groups.length <= 1 ? '至少保留一个变量分组' : '删除分组并迁移规则'}
              onClick={() => {
                setGroupError('')
                setGroupDeletion({
                  id: group.id,
                  targetId: groups.find((item) => item.id !== group.id)!.id
                })
              }}
            >
              删除
            </button>
            <button
              disabled={!Object.keys(group.globals).length}
              onClick={() => {
                const firstRule = rules.find((rule) => rule.groupId === group.id)
                if (firstRule) onResetState(firstRule.id)
                else
                  setGroups(
                    groups.map((item) => (item.id === group.id ? { ...item, globals: {} } : item))
                  )
              }}
            >
              重置
            </button>
          </div>
        ))}
      </div>
      <div className="reply-list">
        {rules.map((rule) => {
          const isCollapsed = collapsedRuleIds.has(rule.id)
          return (
            <section
              className={`reply-item ${isCollapsed ? 'collapsed' : ''}`}
              key={rule.id}
              onContextMenu={(event) => openMenu(event, rule.id)}
            >
              <div className="reply-item-head">
                <button
                  className="reply-collapse-button"
                  title={isCollapsed ? '展开规则' : '收起规则'}
                  onClick={() =>
                    setCollapsedRuleIds((current) => {
                      const next = new Set(current)
                      if (next.has(rule.id)) next.delete(rule.id)
                      else next.add(rule.id)
                      return next
                    })
                  }
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <label className="rule-enable">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) => update(rule.id, { enabled: event.target.checked })}
                  />
                  <strong title={rule.name}>{rule.name}</strong>
                </label>
                <span
                  className="port-badge"
                  title={groups.find((group) => group.id === rule.groupId)?.name || '默认分组'}
                >
                  {groups.find((group) => group.id === rule.groupId)?.name || '默认分组'}
                </span>
                {isProgramRule(rule) && (
                  <button
                    className="rule-state-reset"
                    title="清除该规则编程模式中的变量、计数和累计状态"
                    onClick={(event) => {
                      event.stopPropagation()
                      onResetState(rule.id)
                    }}
                  >
                    重置状态
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <>
                  <dl>
                    <div>
                      <dt>接收</dt>
                      <dd className="reply-receive-preview">
                        <span className="reply-match-format">
                          {rule.receiveHex ? 'HEX' : 'ASCII'}
                          {rule.regex !== false ? ' · 正则' : ''}
                        </span>
                        <span className="reply-pattern" title={rule.pattern}>
                          {rule.pattern}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>发送</dt>
                      <dd title={rule.reply}>{rule.reply}</dd>
                    </div>
                  </dl>
                  {!isProgramRule(rule) && rule.parameters.length > 0 && (
                    <div className="parameter-list">
                      <span className="parameter-title">发送参数</span>
                      {rule.parameters.map((parameter) => (
                        <label key={parameter.id}>
                          <code>{`{{${parameter.id}}}`}</code>
                          <input
                            value={parameter.value}
                            inputMode={parameter.inputMode === 'dec' ? 'numeric' : 'text'}
                            placeholder={parameterValuePlaceholder(
                              parameter.inputMode || (rule.hex ? 'hex' : 'ascii')
                            )}
                            onChange={(event) => {
                              const inputMode = parameter.inputMode || (rule.hex ? 'hex' : 'ascii')
                              const value = event.target.value
                              if (
                                inputMode === 'ascii' ||
                                !value ||
                                (inputMode === 'dec'
                                  ? /^\d+$/.test(value)
                                  : /^[0-9a-f]+$/i.test(value))
                              )
                                updateParameter(
                                  rule,
                                  parameter.id,
                                  inputMode === 'hex' ? value.toUpperCase() : value
                                )
                            }}
                          />
                          <select
                            aria-label={`${parameter.id} 参数格式`}
                            value={parameter.inputMode || (rule.hex ? 'hex' : 'ascii')}
                            onChange={(event) =>
                              updateParameterMode(
                                rule,
                                parameter.id,
                                event.target.value as 'ascii' | 'dec' | 'hex'
                              )
                            }
                          >
                            <option value="ascii">ASCII</option>
                            <option value="dec">DEC</option>
                            <option value="hex">HEX</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                  {isProgramRule(rule) && (
                    <div className="program-output-list">
                      <span>程序输出</span>
                      {rule.parameters.map((parameter) => (
                        <code key={parameter.id} title={`{{${parameter.id}}}`}>
                          {`{{${parameter.id}}}`}
                        </code>
                      ))}
                    </div>
                  )}
                  <div className="reply-item-meta">
                    <span className={`format-badge ${rule.hex ? 'hex' : ''}`}>
                      {rule.hex ? 'HEX' : 'ASCII'}
                    </span>
                    <span
                      className={`parameter-mode-badge ${isProgramRule(rule) ? 'program' : ''}`}
                    >
                      {isProgramRule(rule) ? '编程模式' : '参数模式'}
                    </span>
                    <span className="port-badge">{rule.targetPort || '未指定端口'}</span>
                  </div>
                </>
              )}
            </section>
          )
        })}
        {!rules.length && <div className="empty-rules">在空白处右键新建规则</div>}
      </div>
      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.ruleId === null ? (
            <button
              onClick={() => {
                setMenu(null)
                openCreate()
              }}
            >
              ＋ 新建规则
            </button>
          ) : (
            <>
              <button onClick={() => openEdit(menu.ruleId!)}>✎ 编辑规则</button>
              {isProgramRule(rules.find((rule) => rule.id === menu.ruleId)) && (
                <button
                  onClick={() => {
                    onResetState(menu.ruleId!)
                    setMenu(null)
                  }}
                >
                  ↻ 重置编程状态
                </button>
              )}
              <div className="menu-separator" />
              <button
                className="danger"
                onClick={() => {
                  onResetState(menu.ruleId!, false)
                  setRules(rules.filter((rule) => rule.id !== menu.ruleId))
                  setMenu(null)
                }}
              >
                删除当前规则
              </button>
            </>
          )}
        </div>
      )}

      {(groupEditor || groupDeletion) && (
        <div
          className="modal-backdrop rule-create-backdrop"
          onContextMenu={(event) => event.stopPropagation()}
        >
          <div
            className="modal reply-group-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reply-group-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setGroupEditor(null)
                setGroupDeletion(null)
              }
            }}
          >
            <div className="modal-head">
              <div>
                <h2 id="reply-group-title">
                  {groupDeletion
                    ? '删除变量分组'
                    : groupEditor?.id === null
                      ? '新建变量分组'
                      : '编辑变量分组'}
                </h2>
                <p>同组规则共享 global，分组之间相互隔离</p>
              </div>
              <button
                aria-label="关闭分组管理"
                onClick={() => {
                  setGroupEditor(null)
                  setGroupDeletion(null)
                }}
              >
                ×
              </button>
            </div>
            <div className="create-rule-form">
              {groupEditor && (
                <label>
                  分组名称
                  <input
                    autoFocus
                    value={groupEditor.name}
                    placeholder="例如：电机状态"
                    onChange={(event) => {
                      setGroupEditor({ ...groupEditor, name: event.target.value })
                      setGroupError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        saveGroup()
                      }
                    }}
                  />
                  <small>修改名称会保留该组的规则、共享变量和运行状态。</small>
                </label>
              )}
              {groupDeletion && (
                <>
                  <p>
                    删除“{groups.find((group) => group.id === groupDeletion.id)?.name}
                    ”后，该组共享变量将被清除。
                  </p>
                  <label>
                    将 {rules.filter((rule) => rule.groupId === groupDeletion.id).length}{' '}
                    条规则迁移到
                    <select
                      autoFocus
                      value={groupDeletion.targetId}
                      onChange={(event) => {
                        setGroupDeletion({ ...groupDeletion, targetId: Number(event.target.value) })
                        setGroupError('')
                      }}
                    >
                      {groups
                        .filter((group) => group.id !== groupDeletion.id)
                        .map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                    </select>
                    <small>
                      迁移的规则将暂停，编程状态会重置。目标分组已有的变量和规则保持不变。
                    </small>
                  </label>
                </>
              )}
              {groupError && (
                <p className="form-error" role="alert">
                  {groupError}
                </p>
              )}
            </div>
            <div className="modal-foot">
              <button
                className="cancel-button"
                onClick={() => {
                  setGroupEditor(null)
                  setGroupDeletion(null)
                }}
              >
                取消
              </button>
              <button
                className={groupDeletion ? 'reply-group-delete' : ''}
                onClick={groupDeletion ? deleteGroup : saveGroup}
              >
                {groupDeletion ? '删除并迁移' : groupEditor?.id === null ? '创建分组' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div
          className="modal-backdrop rule-create-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreating(false)
          }}
        >
          <div
            ref={modalRef}
            className="modal create-rule-modal reply-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reply-editor-title"
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                saveRule()
              }
            }}
          >
            <div className="modal-head">
              <div>
                <h2 id="reply-editor-title">
                  {editingRuleId === null ? '新建自动回复规则' : '编辑自动回复规则'}
                </h2>
                <p>定义接收条件、发送指令及运行时参数</p>
              </div>
              <button aria-label="关闭规则编辑器" onClick={() => setCreating(false)}>
                ×
              </button>
            </div>
            <div className="create-rule-form reply-editor-form">
              <div className="reply-identity-grid">
                <label className="reply-name-field">
                  规则名称
                  <input
                    autoFocus
                    value={draft.name}
                    placeholder="例如：设置 PWM"
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </label>
                <label>
                  所属分组
                  <select
                    value={draft.groupId}
                    onChange={(event) =>
                      setDraft({ ...draft, groupId: Number(event.target.value) })
                    }
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <small>组内共享 global，组间隔离</small>
                </label>
                <label>
                  目标端口
                  <select
                    value={draft.targetPort}
                    onChange={(event) => setDraft({ ...draft, targetPort: event.target.value })}
                  >
                    <option value="">选择目标端口</option>
                    {targetPorts.map((port) => (
                      <option key={port.path} value={port.path}>
                        {port.name}（{port.path}）
                      </option>
                    ))}
                  </select>
                  <small>仅匹配并回复此端口</small>
                </label>
              </div>
              <section className="reply-flow-section" aria-label="匹配与回复">
                <div className="reply-flow-heading">
                  <h3>匹配与回复</h3>
                  <div className="receive-format-row">
                    <span>收发编码</span>
                    <div className="mini-segment">
                      <button
                        className={!draft.receiveHex ? 'active' : ''}
                        onClick={() => setDraft({ ...draft, receiveHex: false, hex: false })}
                      >
                        ASCII
                      </button>
                      <button
                        className={draft.receiveHex ? 'active' : ''}
                        onClick={() => setDraft({ ...draft, receiveHex: true, hex: true })}
                      >
                        HEX
                      </button>
                    </div>
                  </div>
                </div>
                <div className="reply-packet-grid">
                  <div className="reply-packet-field reply-receive-field">
                    <label htmlFor="reply-receive-pattern">接收条件</label>
                    <div className="rule-pattern-input">
                      <input
                        id="reply-receive-pattern"
                        value={draft.pattern}
                        placeholder={
                          draft.receiveHex
                            ? '例如：AA 01 BB'
                            : draft.regex
                              ? '例如：^SET PWM$'
                              : '例如：SET PWM'
                        }
                        onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
                      />
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.regex}
                          onChange={(event) => setDraft({ ...draft, regex: event.target.checked })}
                        />
                        正则
                        <span
                          className="regex-help"
                          tabIndex={0}
                          aria-label="自动回复正则使用说明"
                          data-tooltip={
                            draft.receiveHex
                              ? '匹配标准化 HEX 字节文本，字节间用空格分隔。\n. 匹配任意字符；[0-9A-F]{2} 匹配一个字节。\n示例：^AA [0-9A-F]{2} BB$'
                              : '匹配接收到的 ASCII 文本，并自动兼容 CR/LF 行尾。\n^ 表示开头，$ 表示结尾，.* 表示任意内容。\n示例：^TEMP=[0-9]+$'
                          }
                        >
                          ?
                        </span>
                      </label>
                    </div>
                    <small>
                      {draft.regex
                        ? `启用后按${draft.receiveHex ? '标准化 HEX 字节文本' : 'ASCII 文本'}正则匹配`
                        : `默认按完整${draft.receiveHex ? ' HEX 字节' : '指令文本'}匹配，特殊字符无需转义`}
                    </small>
                  </div>
                  <label className="auto-reply-send-field reply-packet-field">
                    <span>回复内容</span>
                    <textarea
                      className="auto-reply-send-input compact-packet-input"
                      rows={1}
                      value={draft.reply}
                      placeholder={'例如：PWM {{占空比}}\\r\\n'}
                      onChange={(event) => setDraft({ ...draft, reply: event.target.value })}
                    />
                    <small>
                      使用完整参数名字引用，例如 <code>{'{{目标速度}}'}</code>
                    </small>
                  </label>
                </div>
              </section>
              <section className="reply-parameters-section" aria-label="参数生成">
                <div className="form-row reply-parameter-heading">
                  <span>参数生成模式</span>
                  <div className="mini-segment">
                    <button
                      className={draft.parameterMode === 'parameters' ? 'active' : ''}
                      onClick={() => setDraft({ ...draft, parameterMode: 'parameters' })}
                    >
                      参数模式
                    </button>
                    <button
                      className={draft.parameterMode === 'program' ? 'active' : ''}
                      onClick={() => setDraft({ ...draft, parameterMode: 'program' })}
                    >
                      编程模式
                    </button>
                  </div>
                </div>
                {draft.parameterMode === 'parameters' ? (
                  <div className="parameter-editor">
                    <div className="parameter-editor-head">
                      <span>指令参数</span>
                      <button
                        onClick={() =>
                          setDraft({
                            ...draft,
                            parameters: [...draft.parameters, { id: '' }]
                          })
                        }
                      >
                        ＋ 添加参数
                      </button>
                    </div>
                    {draft.parameters.map((parameter, index) => (
                      <div className="parameter-edit-row" key={index}>
                        <input
                          value={parameter.id}
                          placeholder="参数名字，例如 占空比"
                          onChange={(event) =>
                            updateDraftParameter(index, { id: event.target.value })
                          }
                        />
                        <button
                          className="copy-placeholder"
                          disabled={!parameter.id.trim()}
                          title={
                            parameter.id.trim()
                              ? `复制 {{${parameter.id.trim()}}}`
                              : '请先输入参数名字'
                          }
                          onClick={() => void copyPlaceholder(parameter.id, index)}
                        >
                          {copiedIndex === index
                            ? '已复制'
                            : parameter.id.trim()
                              ? `{{${parameter.id.trim()}}}`
                              : '{{参数名字}}'}
                        </button>
                        <button
                          className="remove-parameter"
                          title="删除参数"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              parameters: draft.parameters.filter(
                                (_, itemIndex) => itemIndex !== index
                              )
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="program-placeholder-note">
                    <div className="program-placeholder-head">
                      <span>程序返回参数，点击复制占位符</span>
                      <strong className={detectedProgramParameters.length ? '' : 'empty'}>
                        实时监控 · {detectedProgramParameters.length} 个
                      </strong>
                    </div>
                    <div className="program-placeholder-values" aria-live="polite">
                      {detectedProgramParameters.length ? (
                        detectedProgramParameters.map((id, index) => (
                          <button
                            className="program-placeholder-copy"
                            key={id}
                            title={`复制 {{${id}}}`}
                            onClick={() => void copyPlaceholder(id, index)}
                          >
                            {copiedIndex === index ? '已复制' : `{{${id}}}`}
                          </button>
                        ))
                      ) : (
                        <small>尚未识别到返回参数，例如：return {'{ 计数: i }'}</small>
                      )}
                    </div>
                  </div>
                )}
                {draft.parameterMode === 'program' && (
                  <div className="auto-reply-program-editor">
                    <span className="program-editor-title">
                      参数程序（JS / TS）
                      <button
                        type="button"
                        className="program-manual-button"
                        title="打开编程参数手册"
                        aria-label="打开编程参数手册"
                        onClick={(event) => {
                          event.preventDefault()
                          window.open(
                            new URL('programming-manual.html', window.location.href).toString(),
                            'serialflow-programming-manual'
                          )
                        }}
                      >
                        ?
                      </button>
                    </span>
                    <ProgramCodeEditor
                      aria-label="自动回复参数程序"
                      spellCheck={false}
                      value={draft.parameterProgram}
                      onKeyDown={insertProgramTab}
                      onChange={(event) =>
                        setDraft({ ...draft, parameterProgram: event.target.value })
                      }
                    />
                    <small>直接编写 JS 或 TS，无需切换语言。</small>
                  </div>
                )}
              </section>
              {error && <p className="form-error">{error}</p>}
            </div>
            <div className="modal-foot">
              <span className="modal-resize-hint">拖拽右下角调整窗口大小</span>
              <button className="cancel-button" onClick={() => setCreating(false)}>
                取消
              </button>
              <button onClick={saveRule}>{editingRuleId === null ? '创建规则' : '保存修改'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
