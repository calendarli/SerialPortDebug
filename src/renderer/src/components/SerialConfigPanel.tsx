import type { DataBits, Parity, Port, SerialConfig, StopBits } from '../types'

type Props = {
  ports: Port[]
  configs: SerialConfig[]
  openedPorts: Set<string>
  busy: boolean
  onChange: (id: number, patch: Partial<SerialConfig>) => void
  onAdd: () => void
  onRemove: (id: number) => void
  onRefresh: () => void
  onToggle: (config: SerialConfig) => void
  onDataBitsChange: (config: SerialConfig, value: DataBits) => void
}

const baudRates = [
  9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000, 3000000
]

export function SerialConfigPanel(props: Props): React.JSX.Element {
  return (
    <div className="serial-config-content multi-serial-config">
      <div className="panel-title">
        <span>多串口配置</span>
        <div>
          <button
            className="icon-button"
            title="刷新串口"
            disabled={props.busy}
            onClick={props.onRefresh}
          >
            ↻
          </button>
          <button
            className="icon-button add-port"
            title="添加串口配置"
            disabled={props.busy}
            onClick={props.onAdd}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="serial-profile-list">
        {props.configs.map((config, index) => {
          const isOpen = props.openedPorts.has(config.path)
          const disabled = isOpen || props.busy
          return (
            <section className={`serial-profile ${isOpen ? 'open' : ''}`} key={config.id}>
              <div className="serial-profile-head">
                <strong>串口 {index + 1}</strong>
                <span>{isOpen ? '已打开' : '未打开'}</span>
                <button
                  title="删除配置"
                  disabled={disabled || props.configs.length === 1}
                  onClick={() => props.onRemove(config.id)}
                >
                  ×
                </button>
              </div>
              <label>
                端口
                <select
                  value={config.path}
                  disabled={disabled}
                  onChange={(event) => props.onChange(config.id, { path: event.target.value })}
                >
                  <option value="">选择串口</option>
                  {props.ports.map((port) => (
                    <option
                      key={port.path}
                      value={port.path}
                      disabled={props.configs.some(
                        (item) => item.id !== config.id && item.path === port.path
                      )}
                    >
                      {port.path}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                波特率
                <select
                  value={config.baudRate}
                  disabled={disabled}
                  onChange={(event) =>
                    props.onChange(config.id, { baudRate: Number(event.target.value) })
                  }
                >
                  {baudRates.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <div className="grid-two">
                <label>
                  数据位
                  <select
                    value={config.dataBits}
                    disabled={disabled}
                    onChange={(event) =>
                      props.onDataBitsChange(config, Number(event.target.value) as DataBits)
                    }
                  >
                    {[5, 6, 7, 8].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  停止位
                  <select
                    value={config.stopBits}
                    disabled={disabled}
                    onChange={(event) =>
                      props.onChange(config.id, {
                        stopBits: Number(event.target.value) as StopBits
                      })
                    }
                  >
                    <option value={1}>1</option>
                    {config.dataBits === 5 && <option value={1.5}>1.5</option>}
                    {config.dataBits !== 5 && <option value={2}>2</option>}
                  </select>
                </label>
              </div>
              <label>
                校验位
                <select
                  value={config.parity}
                  disabled={disabled}
                  onChange={(event) =>
                    props.onChange(config.id, { parity: event.target.value as Parity })
                  }
                >
                  <option value="none">无校验</option>
                  <option value="even">偶校验</option>
                  <option value="odd">奇校验</option>
                  <option value="mark">Mark</option>
                  <option value="space">Space</option>
                </select>
              </label>
              <button
                className={`connect ${isOpen ? 'disconnect' : ''}`}
                disabled={props.busy || !config.path}
                onClick={() => props.onToggle(config)}
              >
                {props.busy ? '正在处理…' : isOpen ? '关闭此串口' : '打开此串口'}
              </button>
            </section>
          )
        })}
      </div>
    </div>
  )
}
