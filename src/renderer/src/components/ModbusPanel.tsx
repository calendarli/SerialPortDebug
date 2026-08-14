import { useState } from 'react'
import { appendCrc, bytesToHex } from '../serial-utils'

type Props = {
  ports: string[]
  onSend: (text: string, hex: boolean, port: string) => Promise<boolean>
}

function word(value: number): [number, number] {
  const safe = Math.min(0xffff, Math.max(0, Math.floor(value) || 0))
  return [(safe >> 8) & 0xff, safe & 0xff]
}

export function ModbusPanel({ ports, onSend }: Props): React.JSX.Element {
  const [port, setPort] = useState('')
  const [slave, setSlave] = useState(1)
  const [functionCode, setFunctionCode] = useState(3)
  const [address, setAddress] = useState(0)
  const [value, setValue] = useState(1)
  const [message, setMessage] = useState('')
  const targetPort = ports.includes(port) ? port : ports[0] || ''
  const isWrite = functionCode === 5 || functionCode === 6
  const request = appendCrc(
    Uint8Array.from([
      Math.min(247, Math.max(1, slave)),
      functionCode,
      ...word(address),
      ...(functionCode === 5 ? (value ? [0xff, 0] : [0, 0]) : word(value))
    ]),
    'modbus'
  )

  return (
    <section className="protocol-panel">
      <header>
        <div>
          <strong>Modbus RTU</strong>
          <span>内置生成常用主站请求并自动附加 CRC-16/MODBUS</span>
        </div>
      </header>
      <div className="protocol-form">
        <label>
          目标串口
          <select value={targetPort} onChange={(event) => setPort(event.target.value)}>
            <option value="">选择已打开串口</option>
            {ports.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          从站地址
          <input
            type="number"
            min="1"
            max="247"
            value={slave}
            onChange={(event) => setSlave(Number(event.target.value))}
          />
        </label>
        <label>
          功能码
          <select
            value={functionCode}
            onChange={(event) => setFunctionCode(Number(event.target.value))}
          >
            <option value="1">01 读取线圈</option>
            <option value="2">02 读取离散输入</option>
            <option value="3">03 读取保持寄存器</option>
            <option value="4">04 读取输入寄存器</option>
            <option value="5">05 写单个线圈</option>
            <option value="6">06 写单个寄存器</option>
          </select>
        </label>
        <label>
          起始地址
          <input
            type="number"
            min="0"
            max="65535"
            value={address}
            onChange={(event) => setAddress(Number(event.target.value))}
          />
        </label>
        {functionCode === 5 ? (
          <label>
            线圈值
            <select
              value={value ? 1 : 0}
              onChange={(event) => setValue(Number(event.target.value))}
            >
              <option value="1">ON</option>
              <option value="0">OFF</option>
            </select>
          </label>
        ) : (
          <label>
            {isWrite ? '写入值' : '读取数量'}
            <input
              type="number"
              min="1"
              max="65535"
              value={value}
              onChange={(event) => setValue(Number(event.target.value))}
            />
          </label>
        )}
        <div className="protocol-preview">
          <span>请求帧</span>
          <code>{bytesToHex(request)}</code>
        </div>
        <button
          className="protocol-send"
          disabled={!targetPort}
          onClick={async () => {
            const success = await onSend(bytesToHex(request), true, targetPort)
            setMessage(success ? 'Modbus 请求已发送' : '发送失败')
          }}
        >
          发送 Modbus 请求
        </button>
        {message && <p>{message}</p>}
      </div>
    </section>
  )
}
