import type { Rule } from '../types'

type Props = { rules: Rule[]; setRules: (rules: Rule[]) => void; close: () => void }

function expressionClass(pattern: string): string {
  try { new RegExp(pattern); return '' } catch { return 'invalid' }
}

export function RuleDialog({ rules, setRules, close }: Props): React.JSX.Element {
  const update = (id: number, patch: Partial<Rule>): void => setRules(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule))
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="modal">
        <div className="modal-head"><div><h2>正则自动回复</h2><p>收到的数据匹配表达式后自动发送回复</p></div><button onClick={close}>×</button></div>
        <div className="rule-list">
          {rules.map((rule) => <div className="rule" key={rule.id}>
            <input type="checkbox" checked={rule.enabled} onChange={(event) => update(rule.id, { enabled: event.target.checked })} />
            <div>
              <label>匹配表达式<input className={expressionClass(rule.pattern)} value={rule.pattern} onChange={(event) => update(rule.id, { pattern: event.target.value })} /></label>
              <label>回复内容<input value={rule.reply} onChange={(event) => update(rule.id, { reply: event.target.value })} /></label>
            </div>
            <button className="delete" onClick={() => setRules(rules.filter((item) => item.id !== rule.id))}>×</button>
          </div>)}
        </div>
        <button className="add-rule" onClick={() => setRules([...rules, { id: Date.now(), name: '新规则', pattern: '', reply: '', hex: false, enabled: true, parameters: [] }])}>＋ 添加规则</button>
        <div className="modal-foot"><button onClick={close}>完成</button></div>
      </div>
    </div>
  )
}
