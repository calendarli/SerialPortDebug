import { useMemo, useRef, useState } from 'react'
import { bytesToHex, hexToBytes } from '../serial-utils'
import { ScriptEditor, type ScriptEditorHandle } from './ScriptEditor'
import { hashScriptSource } from './script-pipeline'
import { scriptRuntime } from './script-runtime'
import { createScript, type SavedScript, type ScriptEncoding } from './script-types'

type Props = {
  scripts: SavedScript[]
  setScripts(scripts: SavedScript[]): void
  ports: string[]
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function parseTestValue(value: string, encoding: ScriptEncoding): unknown {
  if (encoding === 'json') return JSON.parse(value)
  if (encoding === 'bytes') return Array.from(hexToBytes(value))
  return encoding === 'hex' ? bytesToHex(hexToBytes(value)) : value
}

export function ScriptPanel(props: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(() => props.scripts[0]?.id || '')
  const selected = useMemo(
    () => props.scripts.find((script) => script.id === selectedId) || props.scripts[0],
    [props.scripts, selectedId]
  )
  const [source, setSource] = useState(selected?.source || '')
  const [dirty, setDirty] = useState(false)
  const [testInput, setTestInput] = useState('AA 01 BB')
  const [testOutput, setTestOutput] = useState('等待测试…')
  const [busy, setBusy] = useState(false)
  const editorRef = useRef<ScriptEditorHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const replaceScript = (id: string, patch: Partial<SavedScript>): SavedScript | null => {
    let nextScript: SavedScript | null = null
    props.setScripts(
      props.scripts.map((script) => {
        if (script.id !== id) return script
        nextScript = { ...script, ...patch, updatedAt: Date.now() }
        return nextScript
      })
    )
    return nextScript
  }

  const compileCurrent = async (): Promise<{ code: string; sourceHash: string }> => {
    if (!selected) throw new Error('请选择脚本')
    if (!source.trim()) throw new Error('脚本内容不能为空')
    return editorRef.current?.compile() || Promise.reject(new Error('编辑器尚未加载'))
  }

  const saveCurrent = async (enable?: boolean): Promise<SavedScript | null> => {
    if (!selected || busy) return null
    setBusy(true)
    try {
      const compiled = await compileCurrent()
      const next = replaceScript(selected.id, {
        source,
        compiledCode: compiled.code,
        sourceHash: compiled.sourceHash,
        enabled: enable ?? selected.enabled
      })
      setDirty(false)
      setTestOutput('保存成功')
      return next
    } catch (cause) {
      setTestOutput(`编译失败\n${cause instanceof Error ? cause.message : String(cause)}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  const testCurrent = async (): Promise<void> => {
    if (!selected || busy) return
    setBusy(true)
    const started = performance.now()
    try {
      const compiled = await compileCurrent()
      const temporary: SavedScript = {
        ...selected,
        source,
        compiledCode: compiled.code,
        sourceHash: `${compiled.sourceHash}:test`
      }
      const value = parseTestValue(testInput, selected.encoding)
      const result = await scriptRuntime.run(
        temporary,
        value,
        selected.direction === 'received' ? 'received' : 'send',
        0,
        {
          port: selected.ports[0] || props.ports[0] || 'TEST',
          encoding: selected.encoding,
          timestamp: Date.now(),
          byteLength:
            selected.encoding === 'hex' || selected.encoding === 'bytes'
              ? hexToBytes(testInput).length
              : new TextEncoder().encode(testInput).length,
          scriptName: selected.name,
          direction: selected.direction === 'received' ? 'received' : 'send',
          index: 0
        },
        100
      )
      setTestOutput(
        `${stringifyOutput(result)}\n\n耗时 ${(performance.now() - started).toFixed(2)}ms`
      )
    } catch (cause) {
      setTestOutput(`运行失败\n${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const addScript = (language: 'javascript' | 'typescript' = 'typescript'): void => {
    const script = createScript(language)
    props.setScripts([...props.scripts, script])
    setSelectedId(script.id)
    setSource(script.source)
    setDirty(false)
  }

  const importScript = async (file: File): Promise<void> => {
    const language = file.name.toLowerCase().endsWith('.ts') ? 'typescript' : 'javascript'
    const script = createScript(language)
    script.name = file.name.replace(/\.(?:m?js|ts)$/i, '') || script.name
    script.source = await file.text()
    script.compiledCode = language === 'javascript' ? script.source : ''
    script.sourceHash = language === 'javascript' ? hashScriptSource(script.source) : ''
    props.setScripts([...props.scripts, script])
    setSelectedId(script.id)
    setSource(script.source)
    setDirty(false)
  }

  const exportScript = (): void => {
    if (!selected) return
    const blob = new Blob([source], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selected.name}.${selected.language === 'typescript' ? 'ts' : 'js'}`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!selected) {
    return (
      <div className="script-empty">
        <p>还没有脚本</p>
        <button onClick={() => addScript()}>新建 TypeScript 脚本</button>
      </div>
    )
  }

  return (
    <div className="script-panel">
      <div className="script-workspace">
        <aside className="script-list-pane">
          <header className="script-list-head">
            <strong>脚本</strong>
            <span>{props.scripts.filter((script) => script.enabled).length} 个运行中</span>
          </header>
          <div className="script-list">
            {props.scripts.map((script) => (
              <button
                key={script.id}
                className={script.id === selected.id ? 'active' : ''}
                onClick={() => {
                  setSelectedId(script.id)
                  setSource(script.source)
                  setDirty(false)
                }}
              >
                <i className={script.enabled ? 'running' : ''} />
                <span>{script.name}</span>
                <em>{script.language === 'typescript' ? 'TS' : 'JS'}</em>
              </button>
            ))}
          </div>
        </aside>
        <section className="script-editor-area">
          <div className="script-toolbar">
            <input
              value={selected.name}
              aria-label="脚本名称"
              onChange={(event) => replaceScript(selected.id, { name: event.target.value })}
            />
            <select
              value={selected.language}
              onChange={(event) =>
                replaceScript(selected.id, {
                  language: event.target.value as SavedScript['language'],
                  compiledCode: '',
                  sourceHash: ''
                })
              }
            >
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
            </select>
            <span className="script-dirty">{dirty ? '未保存' : ''}</span>
            <button onClick={() => void editorRef.current?.format()}>格式化</button>
            <button disabled={busy} onClick={() => void testCurrent()}>
              测试
            </button>
            <button disabled={busy} onClick={() => void saveCurrent()}>
              保存
            </button>
            <button onClick={exportScript}>导出</button>
            <button
              className="danger"
              disabled={props.scripts.length === 1}
              onClick={() => {
                if (!window.confirm(`确定删除脚本“${selected.name}”吗？`)) return
                scriptRuntime.disposeScript(selected.id)
                const remaining = props.scripts.filter((script) => script.id !== selected.id)
                props.setScripts(remaining)
                setSelectedId(remaining[0]?.id || '')
                setSource(remaining[0]?.source || '')
                setDirty(false)
              }}
            >
              删除
            </button>
            <span className="script-toolbar-divider" />
            <button onClick={() => addScript('typescript')}>＋ TS</button>
            <button onClick={() => addScript('javascript')}>＋ JS</button>
            <button onClick={() => importRef.current?.click()}>导入</button>
            <input
              ref={importRef}
              hidden
              type="file"
              accept=".js,.mjs,.ts,text/javascript,text/typescript"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importScript(file)
                event.target.value = ''
              }}
            />
          </div>
          <ScriptEditor
            ref={editorRef}
            scriptId={selected.id}
            language={selected.language}
            value={source}
            onChange={(value) => {
              setSource(value)
              setDirty(value !== selected.source)
            }}
            onSave={() => void saveCurrent()}
            onTest={() => void testCurrent()}
          />
          <div className="script-test-area">
            <label>
              测试输入
              <textarea value={testInput} onChange={(event) => setTestInput(event.target.value)} />
            </label>
            <label>
              运行输出
              <pre>{testOutput}</pre>
            </label>
          </div>
        </section>
      </div>
      <section className="script-binding">
        <label>
          <input
            type="checkbox"
            checked={selected.enabled}
            onChange={(event) => {
              if (event.target.checked) void saveCurrent(true)
              else {
                replaceScript(selected.id, { enabled: false })
                scriptRuntime.disposeScript(selected.id)
              }
            }}
          />
          运行脚本
        </label>
        <label>
          方向
          <select
            value={selected.direction}
            onChange={(event) =>
              replaceScript(selected.id, {
                direction: event.target.value as SavedScript['direction']
              })
            }
          >
            <option value="all">发送和接收</option>
            <option value="send">仅发送</option>
            <option value="received">仅接收</option>
          </select>
        </label>
        <label>
          输入格式
          <select
            value={selected.encoding}
            onChange={(event) =>
              replaceScript(selected.id, { encoding: event.target.value as ScriptEncoding })
            }
          >
            <option value="hex">HEX</option>
            <option value="ascii">ASCII</option>
            <option value="json">JSON</option>
            <option value="bytes">字节数组</option>
          </select>
        </label>
        <label>
          接收分帧
          <select
            value={selected.framing.mode}
            onChange={(event) =>
              replaceScript(selected.id, {
                framing: {
                  ...selected.framing,
                  mode: event.target.value as SavedScript['framing']['mode']
                }
              })
            }
          >
            <option value="chunk">原始数据块</option>
            <option value="delimiter">分隔符</option>
            <option value="fixed">固定长度</option>
            <option value="header-footer">帧头帧尾</option>
            <option value="idle">空闲超时</option>
          </select>
        </label>
        <label>
          结果显示
          <select
            value={selected.displayMode}
            onChange={(event) =>
              replaceScript(selected.id, {
                displayMode: event.target.value as SavedScript['displayMode']
              })
            }
          >
            <option value="append">追加脚本结果</option>
            <option value="replace">仅显示脚本结果</option>
            <option value="hidden">不显示结果</option>
          </select>
        </label>
        {selected.framing.mode === 'fixed' && (
          <label>
            字节数
            <input
              type="number"
              min="1"
              value={selected.framing.fixedLength}
              onChange={(event) =>
                replaceScript(selected.id, {
                  framing: { ...selected.framing, fixedLength: Number(event.target.value) }
                })
              }
            />
          </label>
        )}
        {selected.framing.mode === 'delimiter' && (
          <label>
            分隔符
            <input
              value={selected.framing.delimiter}
              onChange={(event) =>
                replaceScript(selected.id, {
                  framing: { ...selected.framing, delimiter: event.target.value }
                })
              }
            />
          </label>
        )}
        {selected.framing.mode === 'header-footer' && (
          <>
            <label>
              帧头 HEX
              <input
                value={selected.framing.header}
                onChange={(event) =>
                  replaceScript(selected.id, {
                    framing: { ...selected.framing, header: event.target.value }
                  })
                }
              />
            </label>
            <label>
              帧尾 HEX
              <input
                value={selected.framing.footer}
                onChange={(event) =>
                  replaceScript(selected.id, {
                    framing: { ...selected.framing, footer: event.target.value }
                  })
                }
              />
            </label>
          </>
        )}
        {selected.framing.mode === 'idle' && (
          <label>
            空闲时间
            <input
              type="number"
              min="1"
              value={selected.framing.idleTimeout}
              onChange={(event) =>
                replaceScript(selected.id, {
                  framing: { ...selected.framing, idleTimeout: Number(event.target.value) }
                })
              }
            />
          </label>
        )}
        <fieldset>
          <legend>目标串口（不选表示全部）</legend>
          {props.ports.length ? (
            props.ports.map((port) => (
              <label key={port}>
                <input
                  type="checkbox"
                  checked={selected.ports.includes(port)}
                  onChange={(event) =>
                    replaceScript(selected.id, {
                      ports: event.target.checked
                        ? [...selected.ports, port]
                        : selected.ports.filter((item) => item !== port)
                    })
                  }
                />
                {port}
              </label>
            ))
          ) : (
            <span>暂无串口配置</span>
          )}
        </fieldset>
      </section>
    </div>
  )
}
