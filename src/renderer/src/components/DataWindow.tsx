import { useEffect, useMemo, useState } from 'react'
import { WindowPinButton } from './WindowPinButton'
import {
  formatDataValue,
  compileDataPattern,
  DataWindowParser,
  type DataMatch
} from '../data-window-parser'
import {
  dataWindowKey,
  readDataWindowConfig,
  normalizeDataFieldFormat
} from '../data-window-config'

export function DataWindow({ id }: { id: string }): React.JSX.Element {
  const [config, setConfig] = useState(() => readDataWindowConfig(id))
  const [draft, setDraft] = useState(config)
  const [editing, setEditing] = useState(true)
  const [ports, setPorts] = useState<string[]>([])
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ match: DataMatch; count: number; time: string } | null>(
    null
  )
  useEffect(() => {
    document.title = `${config.name} · SerialFlow`
  }, [config.name])
  useEffect(() => {
    let active = true
    void window.api.getOpenedPortPaths().then(
      (value) => {
        if (active) setPorts(value)
      },
      () => {
        if (active) setError('读取已打开串口失败')
      }
    )
    const off = window.api.onStatus(({ path, open }) => {
      setPorts((current) =>
        open ? [...new Set([...current, path])] : current.filter((port) => port !== path)
      )
    })
    return () => {
      active = false
      off()
    }
  }, [])
  const compiled = useMemo(() => {
    try {
      return { pattern: compileDataPattern(config.template), error: '' }
    } catch (cause) {
      return { pattern: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }, [config.template])
  useEffect(() => {
    if (!compiled.pattern) return
    const parser = new DataWindowParser(compiled.pattern)
    const offData = window.api.onData(({ path, chunks }) => {
      if (!config.port || path !== config.port) return
      let count = 0
      let latest: DataMatch | null = null
      for (const chunk of chunks) {
        const found = parser.push(chunk)
        count += found.count
        if (found.latest) latest = found.latest
      }
      if (latest) {
        const match = latest
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
        setResult((current) => ({ match, count: (current?.count || 0) + count, time }))
      }
    })
    const offStatus = window.api.onStatus(({ path }) => {
      if (path === config.port) {
        parser.clear()
        setResult(null)
      }
    })
    return () => {
      offData()
      offStatus()
    }
  }, [config, compiled])

  const draftPattern = useMemo(() => {
    try {
      return { pattern: compileDataPattern(draft.template), error: '' }
    } catch (cause) {
      return { pattern: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }, [draft.template])
  const save = (): void => {
    try {
      const pattern = compileDataPattern(draft.template)
      if (!draft.port.trim()) throw new Error('请选择或输入接收串口')
      if (!draft.name.trim()) throw new Error('请输入窗口名称')
      const next = {
        ...draft,
        name: draft.name.trim(),
        port: draft.port.trim(),
        fieldFormats: Object.fromEntries(
          pattern.fields.map((field) => [
            field.name,
            normalizeDataFieldFormat(draft.fieldFormats[field.name])
          ])
        )
      }
      localStorage.setItem(dataWindowKey(id), JSON.stringify(next))
      setConfig(next)
      setDraft(next)
      setResult(null)
      setError('')
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <main className="data-window">
      <div className="data-window-heading">
        <strong>{config.name}</strong>
        <button onClick={() => setEditing(!editing)}>{editing ? '收起配置' : '配置'}</button>
        <WindowPinButton />
      </div>
      <div className="data-window-status">
        {config.port || '未选择串口'} ·{' '}
        {ports.includes(config.port) ? '接收中' : '请在主窗口打开串口'}
      </div>
      {editing && (
        <section className="data-window-editor">
          <label>
            窗口名称
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            接收串口
            <input
              list="data-window-ports"
              placeholder="例如 COM3"
              value={draft.port}
              onChange={(event) => setDraft({ ...draft, port: event.target.value })}
            />
          </label>
          <datalist id="data-window-ports">
            {ports.map((port) => (
              <option key={port} value={port} />
            ))}
          </datalist>
          <label>
            匹配模板
            <textarea
              rows={3}
              spellCheck={false}
              value={draft.template}
              onChange={(event) => setDraft({ ...draft, template: event.target.value })}
            />
          </label>
          <small>
            HEX 固定字节，?? 跳过任意 1 字节，{'{名称:字节数}'}{' '}
            提取并显示数据。可自由组合多个字段，字段名不能重复。
          </small>
          <small>
            示例：{'AA 02 {数据:4} BB'}；{'55 ?? {温度:2} {压力:2} 0D 0A'}
            。按完整模板从左到右匹配，所有长度均为字节。
          </small>
          {draftPattern.error && <small className="data-window-error">{draftPattern.error}</small>}
          {draftPattern.pattern?.fields.map((field) => {
            const format = normalizeDataFieldFormat(draft.fieldFormats[field.name])
            const updateFormat = (patch: Partial<typeof format>): void =>
              setDraft({
                ...draft,
                fieldFormats: { ...draft.fieldFormats, [field.name]: { ...format, ...patch } }
              })
            return (
              <div className="data-field-format" key={field.name}>
                <strong>
                  {field.name} · {field.length} 字节
                </strong>
                <label>
                  数值类型
                  <select
                    value={format.signed ? 'signed' : 'unsigned'}
                    onChange={(event) => updateFormat({ signed: event.target.value === 'signed' })}
                  >
                    <option value="unsigned">无符号</option>
                    <option value="signed">有符号（补码）</option>
                  </select>
                </label>
                <label>
                  DEC 小数位
                  <select
                    value={format.decimals}
                    onChange={(event) => updateFormat({ decimals: Number(event.target.value) })}
                  >
                    {Array.from({ length: 21 }, (_, index) => (
                      <option key={index} value={index}>
                        {index}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )
          })}
          <small>
            按大端解析，有符号数采用字段位宽的补码。负数 HEX
            显示负号及绝对值，原始字节可查看完整匹配帧。小数位仅作用于 DEC：1 位除以 10，2 位除以
            100。
          </small>
          <button className="primary" onClick={save}>
            保存并应用
          </button>
        </section>
      )}
      {(error || compiled.error) && (
        <p className="data-window-error" role="alert">
          {error || compiled.error}
        </p>
      )}
      <section className="data-window-values">
        {result ? (
          <>
            {result.match.fields.map((field) => {
              const format = normalizeDataFieldFormat(config.fieldFormats[field.name])
              const value = formatDataValue(field.hex, format.signed, format.decimals)
              return (
                <article key={field.name}>
                  <small>
                    {field.name} · HEX（{format.signed ? '有符号' : '无符号'}）
                  </small>
                  <output>{value.hex}</output>
                  <small>
                    {field.name} · DEC（{format.signed ? '有符号' : '无符号'}大端 ·{' '}
                    {format.decimals} 位小数）
                  </small>
                  <output>{value.dec}</output>
                </article>
              )
            })}
            <small>
              已匹配 {result.count} 帧 · 更新于 {result.time}
            </small>
            <details>
              <summary>完整匹配帧</summary>
              <code>{result.match.frame}</code>
            </details>
          </>
        ) : (
          <p>等待匹配数据…</p>
        )}
      </section>
    </main>
  )
}
