import { useEffect, useState } from 'react'
import type { Rule } from '../types'

type Props = { rules: Rule[]; setRules: (rules: Rule[]) => void; targetPorts: string[] }
type Draft = {
  name: string
  pattern: string
  regex: boolean
  receiveHex: boolean
  reply: string
  hex: boolean
  targetPort: string
  parameterIds: string[]
}
const emptyDraft = (): Draft => ({
  name: '',
  pattern: '',
  regex: false,
  receiveHex: false,
  reply: '',
  hex: false,
  targetPort: '',
  parameterIds: []
})

export function AutoReplyPanel({ rules, setRules, targetPorts }: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; ruleId: number | null } | null>(null)

  useEffect(() => {
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  const update = (id: number, patch: Partial<Rule>): void =>
    setRules(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  const updateParameter = (rule: Rule, parameterId: string, value: string): void => {
    update(rule.id, {
      parameters: rule.parameters.map((parameter) =>
        parameter.id === parameterId ? { ...parameter, value } : parameter
      )
    })
  }
  const updateDraftParameter = (index: number, value: string): void => {
    setDraft((current) => ({
      ...current,
      parameterIds: current.parameterIds.map((item, itemIndex) =>
        itemIndex === index ? value : item
      )
    }))
  }
  const openCreate = (): void => {
    setEditingRuleId(null)
    setDraft({ ...emptyDraft(), targetPort: targetPorts[0] || '' })
    setError('')
    setCreating(true)
  }
  const openEdit = (id: number): void => {
    const rule = rules.find((item) => item.id === id)
    if (!rule) return
    setEditingRuleId(id)
    setDraft({
      name: rule.name,
      pattern: rule.pattern,
      regex: rule.regex !== false,
      receiveHex: Boolean(rule.receiveHex),
      reply: rule.reply,
      hex: rule.hex,
      targetPort: rule.targetPort || targetPorts[0] || '',
      parameterIds: rule.parameters.map((parameter) => parameter.id)
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
    const ids = draft.parameterIds.map((id) => id.trim()).filter(Boolean)
    if (ids.some((id) => /[{}]/.test(id))) return setError('参数名字不能包含花括号')
    if (new Set(ids).size !== ids.length) return setError('参数名字不能重复')
    if (editingRuleId === null) {
      setRules([
        ...rules,
        {
          id: Date.now(),
          name: draft.name.trim(),
          pattern: draft.pattern,
          regex: draft.regex,
          receiveHex: draft.receiveHex,
          reply: draft.reply,
          hex: draft.hex,
          enabled: true,
          targetPort: draft.targetPort,
          parameters: ids.map((id) => ({ id, value: '' }))
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
                name: draft.name.trim(),
                pattern: draft.pattern,
                regex: draft.regex,
                receiveHex: draft.receiveHex,
                reply: draft.reply,
                hex: draft.hex,
                targetPort: draft.targetPort,
                parameters: ids.map(
                  (id) =>
                    current.parameters.find((parameter) => parameter.id === id) || { id, value: '' }
                )
              }
            : rule
        )
      )
    }
    setCreating(false)
    setEditingRuleId(null)
  }

  return (
    <div className="auto-reply-panel" onContextMenu={(event) => openMenu(event, null)}>
      <div className="side-section-head">
        <div>
          <strong>自动回复规则</strong>
          <small>右键新建或删除规则</small>
        </div>
        <span>{rules.filter((rule) => rule.enabled).length} 启用</span>
      </div>
      <div className="reply-list">
        {rules.map((rule) => (
          <section
            className="reply-item"
            key={rule.id}
            onContextMenu={(event) => openMenu(event, rule.id)}
          >
            <div className="reply-item-head">
              <label className="rule-enable">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => update(rule.id, { enabled: event.target.checked })}
                />
                <strong>{rule.name}</strong>
              </label>
            </div>
            <dl>
              <div>
                <dt>
                  接收（{rule.receiveHex ? 'HEX' : 'ASCII'}
                  {rule.regex !== false ? ' · 正则' : ''}）
                </dt>
                <dd>{rule.pattern}</dd>
              </div>
              <div>
                <dt>发送</dt>
                <dd>{rule.reply}</dd>
              </div>
            </dl>
            {rule.parameters.length > 0 && (
              <div className="parameter-list">
                <span className="parameter-title">发送参数</span>
                {rule.parameters.map((parameter) => (
                  <label key={parameter.id}>
                    <code>{`{{${parameter.id}}}`}</code>
                    <input
                      value={parameter.value}
                      placeholder={`输入 ${parameter.id}`}
                      onChange={(event) => updateParameter(rule, parameter.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            )}
            <span className={`format-badge ${rule.hex ? 'hex' : ''}`}>
              {rule.hex ? 'HEX' : 'ASCII'}
            </span>
            <span className="port-badge">{rule.targetPort || '未指定端口'}</span>
          </section>
        ))}
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
              <div className="menu-separator" />
              <button
                className="danger"
                onClick={() => {
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

      {creating && (
        <div
          className="modal-backdrop rule-create-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreating(false)
          }}
        >
          <div className="modal create-rule-modal">
            <div className="modal-head">
              <div>
                <h2>{editingRuleId === null ? '新建自动回复规则' : '编辑自动回复规则'}</h2>
                <p>定义接收条件、发送指令及运行时参数</p>
              </div>
              <button onClick={() => setCreating(false)}>×</button>
            </div>
            <div className="create-rule-form">
              <label>
                规则名称
                <input
                  autoFocus
                  value={draft.name}
                  placeholder="例如：设置 PWM"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                接收内容
                <div className="receive-format-row">
                  <span>接收格式</span>
                  <div className="mini-segment">
                    <button
                      className={!draft.receiveHex ? 'active' : ''}
                      onClick={() => setDraft({ ...draft, receiveHex: false })}
                    >
                      ASCII
                    </button>
                    <button
                      className={draft.receiveHex ? 'active' : ''}
                      onClick={() => setDraft({ ...draft, receiveHex: true })}
                    >
                      HEX
                    </button>
                  </div>
                </div>
                <div className="rule-pattern-input">
                  <input
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
              </label>
              <label>
                发送（发送指令）
                <textarea
                  className="auto-reply-send-input"
                  value={draft.reply}
                  placeholder={'例如：PWM {{占空比}}\\r\\n'}
                  onChange={(event) => setDraft({ ...draft, reply: event.target.value })}
                />
                <small>
                  使用完整参数名字引用，例如 <code>{'{{目标速度}}'}</code>
                </small>
              </label>
              <label>
                目标端口
                <select
                  value={draft.targetPort}
                  onChange={(event) => setDraft({ ...draft, targetPort: event.target.value })}
                >
                  <option value="">选择目标端口</option>
                  {targetPorts.map((port) => (
                    <option key={port}>{port}</option>
                  ))}
                </select>
                <small>仅匹配该端口收到的数据，并从该端口发送回复</small>
              </label>
              <div className="form-row">
                <span>发送格式</span>
                <div className="mini-segment">
                  <button
                    className={!draft.hex ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, hex: false })}
                  >
                    ASCII
                  </button>
                  <button
                    className={draft.hex ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, hex: true })}
                  >
                    HEX
                  </button>
                </div>
              </div>
              <div className="parameter-editor">
                <div className="parameter-editor-head">
                  <span>参数名字（支持中文，任意数量）</span>
                  <button
                    onClick={() =>
                      setDraft({ ...draft, parameterIds: [...draft.parameterIds, ''] })
                    }
                  >
                    ＋ 添加参数
                  </button>
                </div>
                {draft.parameterIds.map((id, index) => (
                  <div className="parameter-edit-row" key={index}>
                    <input
                      value={id}
                      placeholder="参数名字，例如 占空比"
                      onChange={(event) => updateDraftParameter(index, event.target.value)}
                    />
                    <button
                      className="copy-placeholder"
                      disabled={!id.trim()}
                      title={id.trim() ? `复制 {{${id.trim()}}}` : '请先输入参数名字'}
                      onClick={() => void copyPlaceholder(id, index)}
                    >
                      {copiedIndex === index
                        ? '已复制'
                        : id.trim()
                          ? `{{${id.trim()}}}`
                          : '{{参数名字}}'}
                    </button>
                    <button
                      className="remove-parameter"
                      title="删除参数"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          parameterIds: draft.parameterIds.filter(
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
              {error && <p className="form-error">{error}</p>}
            </div>
            <div className="modal-foot">
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
