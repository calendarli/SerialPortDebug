import { useCallback, useEffect, useState } from 'react'

type Status = {
  installed: boolean
  pairs: string[]
  commandPath?: string
  message?: string
}

export function SerialPairPanel(): React.JSX.Element {
  const [first, setFirst] = useState('COM10')
  const [second, setSecond] = useState('COM11')
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('正在检测 com0com…')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.getVirtualPortStatus()
      setStatus(next)
      setMessage(next.installed ? next.message || 'com0com 已就绪' : '未检测到 com0com 驱动工具')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const createPair = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.createVirtualPortPair(first, second)
      setMessage(`已创建 ${result.first} ↔ ${result.second}`)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="serial-pair-panel">
      <header>
        <div>
          <strong>虚拟串口对</strong>
          <span>使用 com0com 内核驱动连接两个本地 COM 端口</span>
        </div>
        <button onClick={() => void refresh()}>刷新状态</button>
      </header>

      <div className={`serial-pair-status ${status?.installed ? 'ready' : ''}`}>
        <i />
        <div>
          <strong>{status?.installed ? '驱动工具已检测到' : '需要安装 com0com'}</strong>
          <span>{message}</span>
          {status?.commandPath && <small>{status.commandPath}</small>}
        </div>
      </div>

      <div className="serial-pair-card">
        <h2>创建串口对</h2>
        <p>向其中一个端口发送的数据，会从另一个端口收到，适合双软件互联和协议模拟。</p>
        <div className="serial-pair-form">
          <label>
            端口 A
            <input
              value={first}
              onChange={(event) => setFirst(event.target.value.toUpperCase())}
              placeholder="COM10"
            />
          </label>
          <b>↔</b>
          <label>
            端口 B
            <input
              value={second}
              onChange={(event) => setSecond(event.target.value.toUpperCase())}
              placeholder="COM11"
            />
          </label>
          <button
            className="primary"
            disabled={!status?.installed || busy}
            onClick={() => void createPair()}
          >
            {busy ? '正在创建…' : '创建虚拟串口对'}
          </button>
        </div>
        <small>
          端口范围 COM1–COM999；已存在或被硬件占用的端口不能重复创建。系统可能要求管理员权限。
        </small>
      </div>

      <div className="serial-pair-card">
        <h2>管理与安装</h2>
        <div className="serial-pair-actions">
          <button
            disabled={!status?.installed}
            onClick={() => void window.api.openVirtualPortManager()}
          >
            打开 com0com 管理器
          </button>
          <button onClick={() => void window.api.openVirtualPortDownload()}>
            打开官方 SourceForge 下载页
          </button>
        </div>
        <p className="serial-pair-warning">
          com0com 是第三方内核驱动。Windows 10/11
          可能因驱动签名、安全启动或企业策略拒绝加载；本应用不会自动关闭这些安全设置。
        </p>
      </div>

      {Boolean(status?.pairs.length) && (
        <div className="serial-pair-card">
          <h2>com0com 当前配置</h2>
          <pre>{status!.pairs.join('\n')}</pre>
        </div>
      )}
    </section>
  )
}
