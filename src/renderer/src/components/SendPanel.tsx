import { useRef, useState } from 'react'
import type { CrcMode } from '../types'

type Props = {
  text: string
  hex: boolean
  appendCrlf: boolean
  autoSend: boolean
  autoSendRunning: boolean
  interval: number
  crcEnabled: boolean
  crcMode: CrcMode
  openedPorts: string[]
  targetPort: string
  onTextChange: (value: string) => void
  onHexChange: (value: boolean) => void
  onAppendCrlfChange: (value: boolean) => void
  onAutoSendChange: (value: boolean) => void
  onIntervalChange: (value: number) => void
  onSend: () => void
  onCrcEnabledChange: (value: boolean) => void
  onCrcModeChange: (value: CrcMode) => void
  onTargetPortChange: (value: string) => void
  height: number
  onHeightChange: (value: number) => void
  onHeightCommit: (value: number) => void
}

export function SendPanel(props: Props): React.JSX.Element {
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef({ y: 0, height: props.height })
  const latestHeight = useRef(props.height)
  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragStart.current = { y: event.clientY, height: props.height }
    latestHeight.current = props.height
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    const nextHeight = dragStart.current.height - (event.clientY - dragStart.current.y)
    latestHeight.current = nextHeight
    props.onHeightChange(nextHeight)
  }
  const finishResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    props.onHeightCommit(latestHeight.current)
    setResizing(false)
  }
  return (
    <div className="sender card">
      <div
        className={`send-panel-resizer ${resizing ? 'resizing' : ''}`}
        title="拖拽调整发送区高度，双击恢复默认"
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onDoubleClick={() => props.onHeightCommit(230)}
      >
        <i />
      </div>
      <div className="card-head">
        <strong>发送数据</strong>
        <div className="head-tools">
          <select
            className="send-port-select"
            aria-label="发送串口"
            value={props.targetPort}
            onChange={(event) => props.onTargetPortChange(event.target.value)}
          >
            <option value="">选择目标串口</option>
            {props.openedPorts.map((path) => (
              <option key={path}>{path}</option>
            ))}
          </select>
          <div className="segmented">
            <button className={!props.hex ? 'active' : ''} onClick={() => props.onHexChange(false)}>
              ASCII
            </button>
            <button className={props.hex ? 'active' : ''} onClick={() => props.onHexChange(true)}>
              HEX
            </button>
          </div>
          <label className="head-check">
            <input
              type="checkbox"
              checked={props.appendCrlf}
              onChange={(event) => props.onAppendCrlfChange(event.target.checked)}
            />
            CRLF
          </label>
          <label className="head-check">
            <input
              type="checkbox"
              checked={props.crcEnabled}
              onChange={(event) => props.onCrcEnabledChange(event.target.checked)}
            />
            CRC
          </label>
          <select
            className="crc-select"
            aria-label="CRC 格式"
            disabled={!props.crcEnabled}
            value={props.crcMode}
            onChange={(event) => props.onCrcModeChange(event.target.value as CrcMode)}
          >
            <option value="crc8">CRC-8</option>
            <option value="modbus">CRC-16/MODBUS</option>
            <option value="ccitt-false">CRC-16/CCITT-FALSE</option>
            <option value="xmodem">CRC-16/XMODEM</option>
            <option value="crc32">CRC-32</option>
          </select>
          <label className="head-check">
            <input
              type="checkbox"
              checked={props.autoSend}
              onChange={(event) => props.onAutoSendChange(event.target.checked)}
            />
            自动发送
          </label>
          <div className="interval">
            <input
              aria-label="自动发送周期"
              type="number"
              min="1"
              value={props.interval}
              onChange={(event) => props.onIntervalChange(Number(event.target.value))}
            />
            <span>ms</span>
          </div>
        </div>
      </div>
      <textarea
        value={props.text}
        onChange={(event) => props.onTextChange(event.target.value)}
        placeholder={props.hex ? '例如：01 03 00 00 00 02' : '输入要发送的数据…'}
      />
      <div className="send-actions">
        <button
          className={`send-button ${props.autoSendRunning ? 'stop' : ''}`}
          onClick={props.onSend}
        >
          {props.autoSend ? (props.autoSendRunning ? '停止发送' : '启动发送') : '发送'}{' '}
          <kbd>Ctrl ↵</kbd>
        </button>
      </div>
    </div>
  )
}
