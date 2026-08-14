import { useEffect, useRef, useState } from 'react'
import type { InteractionEntry } from '../types'

type TestStep = {
  id: number
  name: string
  send: string
  hex: boolean
  expect: string
  timeout: number
}
type Props = {
  entries: InteractionEntry[]
  ports: string[]
  onSend: (text: string, hex: boolean, port: string) => Promise<boolean>
}
const key = 'serialflow.testSteps'

function loadSteps(): TestStep[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    if (Array.isArray(value) && value.length) return value
  } catch {
    /* use default */
  }
  return [
    {
      id: Date.now(),
      name: '步骤 1',
      send: 'AA 01 BB',
      hex: true,
      expect: 'AA .* BB',
      timeout: 500
    }
  ]
}

export function TestPanel({ entries, ports, onSend }: Props): React.JSX.Element {
  const [steps, setSteps] = useState<TestStep[]>(loadSteps)
  const [port, setPort] = useState('')
  const [running, setRunning] = useState(false)
  const [statuses, setStatuses] = useState<Record<number, string>>({})
  const entriesRef = useRef(entries)
  const cancelled = useRef(false)
  const targetPort = ports.includes(port) ? port : ports[0] || ''
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])
  useEffect(() => localStorage.setItem(key, JSON.stringify(steps)), [steps])
  const patchStep = (id: number, patch: Partial<TestStep>): void =>
    setSteps((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const run = async (): Promise<void> => {
    if (!targetPort || running) return
    cancelled.current = false
    setRunning(true)
    setStatuses({})
    for (const step of steps) {
      if (cancelled.current) break
      setStatuses((current) => ({ ...current, [step.id]: '发送中' }))
      const baseline = entriesRef.current.at(-1)?.id || 0
      if (!(await onSend(step.send, step.hex, targetPort))) {
        setStatuses((current) => ({ ...current, [step.id]: '发送失败' }))
        break
      }
      if (!step.expect.trim()) {
        setStatuses((current) => ({ ...current, [step.id]: '通过' }))
        continue
      }
      let expression: RegExp
      try {
        expression = new RegExp(step.expect)
      } catch {
        setStatuses((current) => ({ ...current, [step.id]: '正则错误' }))
        break
      }
      const deadline = performance.now() + Math.max(1, step.timeout)
      let matched = false
      while (!cancelled.current && performance.now() < deadline) {
        matched = entriesRef.current.some(
          (entry) =>
            entry.id > baseline &&
            entry.direction === 'rx' &&
            entry.port === targetPort &&
            expression.test(entry.text)
        )
        if (matched) break
        await new Promise((resolve) => window.setTimeout(resolve, 15))
      }
      setStatuses((current) => ({ ...current, [step.id]: matched ? '通过' : '超时' }))
      if (!matched) break
    }
    setRunning(false)
  }
  return (
    <section className="test-panel">
      <header className="test-toolbar">
        <div>
          <strong>自动化测试</strong>
          <span>依次发送、等待正则回复并进行超时判定</span>
        </div>
        <select value={targetPort} onChange={(event) => setPort(event.target.value)}>
          <option value="">选择已打开串口</option>
          {ports.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <button onClick={() => void run()} disabled={running || !targetPort}>
          运行全部
        </button>
        <button
          onClick={() => {
            cancelled.current = true
            setRunning(false)
          }}
          disabled={!running}
        >
          停止
        </button>
      </header>
      <div className="test-step-list">
        {steps.map((step, index) => (
          <section className="test-step" key={step.id}>
            <b>{index + 1}</b>
            <input
              value={step.name}
              onChange={(event) => patchStep(step.id, { name: event.target.value })}
              placeholder="步骤名称"
            />
            <div className="mini-segment">
              <button
                className={!step.hex ? 'active' : ''}
                onClick={() => patchStep(step.id, { hex: false })}
              >
                ASCII
              </button>
              <button
                className={step.hex ? 'active' : ''}
                onClick={() => patchStep(step.id, { hex: true })}
              >
                HEX
              </button>
            </div>
            <input
              value={step.send}
              onChange={(event) => patchStep(step.id, { send: event.target.value })}
              placeholder="发送内容"
            />
            <input
              value={step.expect}
              onChange={(event) => patchStep(step.id, { expect: event.target.value })}
              placeholder="期望回复正则；留空则不等待"
            />
            <label>
              超时{' '}
              <input
                type="number"
                min="1"
                value={step.timeout}
                onChange={(event) =>
                  patchStep(step.id, { timeout: Math.max(1, Number(event.target.value) || 500) })
                }
              />{' '}
              ms
            </label>
            <span className={`test-status ${statuses[step.id] || ''}`}>
              {statuses[step.id] || '待运行'}
            </span>
            <button
              className="delete"
              disabled={running || steps.length === 1}
              onClick={() => setSteps((current) => current.filter((item) => item.id !== step.id))}
            >
              删除
            </button>
          </section>
        ))}
      </div>
      <button
        className="add-test-step"
        disabled={running}
        onClick={() =>
          setSteps((current) => [
            ...current,
            {
              id: Date.now(),
              name: `步骤 ${current.length + 1}`,
              send: '',
              hex: true,
              expect: '',
              timeout: 500
            }
          ])
        }
      >
        ＋ 添加测试步骤
      </button>
    </section>
  )
}
