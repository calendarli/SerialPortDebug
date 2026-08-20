import { useEffect, useMemo, useState } from 'react'

type Progress = Parameters<Parameters<typeof window.api.onFileTransferProgress>[0]>[0]

type Props = { ports: string[] }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function FileTransferPanel({ ports }: Props): React.JSX.Element {
  const [sendPort, setSendPort] = useState('')
  const [receivePort, setReceivePort] = useState('')
  const [file, setFile] = useState<{ path: string; name: string; size: number } | null>(null)
  const [directory, setDirectory] = useState('')
  const [chunkSize, setChunkSize] = useState(1024)
  const [protocol, setProtocol] = useState<'serialflow' | 'raw'>('serialflow')
  const [receiverEnabled, setReceiverEnabled] = useState(false)
  const [tasks, setTasks] = useState<Record<string, Progress>>({})
  const [message, setMessage] = useState('请选择已打开的串口开始文件传输')
  const selectedSendPort = ports.includes(sendPort) ? sendPort : ports[0] || ''
  const selectedReceivePort = ports.includes(receivePort) ? receivePort : ports[0] || ''

  useEffect(
    () =>
      window.api.onFileTransferProgress((progress) => {
        setTasks((current) => ({ ...current, [progress.taskId]: progress }))
        setMessage(progress.message)
      }),
    []
  )

  useEffect(() => {
    if (receiverEnabled && !ports.includes(receivePort)) {
      void window.api.setFileReceiver(receivePort).finally(() => {
        setReceiverEnabled(false)
        setMessage('接收串口已断开，文件接收已停止')
      })
    }
  }, [ports, receivePort, receiverEnabled])

  const activeTasks = useMemo(
    () => Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt),
    [tasks]
  )

  const chooseFile = async (): Promise<void> => {
    const selected = await window.api.selectTransferFile()
    if (selected) {
      setFile(selected)
      setMessage(`已选择 ${selected.name}`)
    }
  }

  const chooseDirectory = async (): Promise<void> => {
    const selected = await window.api.selectTransferDirectory()
    if (selected) {
      setDirectory(selected)
      setMessage(`接收目录：${selected}`)
    }
  }

  const toggleReceiver = async (): Promise<void> => {
    try {
      if (receiverEnabled) {
        await window.api.setFileReceiver(receivePort)
        setReceiverEnabled(false)
        setMessage('文件接收已停止')
      } else {
        if (!selectedReceivePort) throw new Error('请先打开并选择接收串口')
        if (!directory) throw new Error('请选择接收文件保存目录')
        await window.api.setFileReceiver(selectedReceivePort, directory)
        setReceivePort(selectedReceivePort)
        setReceiverEnabled(true)
        setMessage(`${selectedReceivePort} 正在等待文件…`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const send = async (): Promise<void> => {
    try {
      if (!selectedSendPort) throw new Error('请先打开并选择发送串口')
      if (!file) throw new Error('请选择要发送的文件')
      setSendPort(selectedSendPort)
      await window.api.startFileTransfer(selectedSendPort, file.path, chunkSize, protocol)
      setMessage('文件传输任务已启动')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="file-transfer-panel">
      <header>
        <div>
          <strong>串口文件传输</strong>
          <span>分块确认、CRC32 帧校验、断点续传和 SHA-256 文件校验</span>
        </div>
        <span className="file-transfer-message">{message}</span>
      </header>

      <div className="file-transfer-grid">
        <div className="serial-pair-card">
          <h2>发送文件</h2>
          <p>可靠模式用于两个 SerialFlow 之间传输；原始模式可直接向不支持确认协议的下位机发送。</p>
          <label>
            传输协议
            <select
              value={protocol}
              onChange={(event) => setProtocol(event.target.value as 'serialflow' | 'raw')}
            >
              <option value="serialflow">SerialFlow 可靠传输（需要接收端确认）</option>
              <option value="raw">原始二进制（不等待回应）</option>
            </select>
          </label>
          <label>
            发送串口
            <select value={selectedSendPort} onChange={(event) => setSendPort(event.target.value)}>
              {!ports.length && <option value="">没有已打开的串口</option>}
              {ports.map((port) => (
                <option key={port}>{port}</option>
              ))}
            </select>
          </label>
          <label>
            数据块大小
            <select
              value={chunkSize}
              onChange={(event) => setChunkSize(Number(event.target.value))}
            >
              <option value={256}>256 B（低质量链路）</option>
              <option value={512}>512 B</option>
              <option value={1024}>1 KB（推荐）</option>
              <option value={4096}>4 KB（高速链路）</option>
            </select>
          </label>
          <div className="file-picker-row">
            <button onClick={() => void chooseFile()}>选择文件</button>
            <span>{file ? `${file.name} · ${formatBytes(file.size)}` : '尚未选择文件'}</span>
          </div>
          <button
            className="primary"
            disabled={!selectedSendPort || !file}
            onClick={() => void send()}
          >
            开始发送
          </button>
          {protocol === 'raw' && (
            <p className="file-transfer-raw-warning">
              原始模式发送完成只表示数据已写入串口，无法确认下位机是否完整接收。
            </p>
          )}
        </div>

        <div className="serial-pair-card">
          <h2>接收文件</h2>
          <p>文件先保存为临时文件，完整校验成功后才会改为正式文件名。</p>
          <label>
            接收串口
            <select
              disabled={receiverEnabled}
              value={selectedReceivePort}
              onChange={(event) => setReceivePort(event.target.value)}
            >
              {!ports.length && <option value="">没有已打开的串口</option>}
              {ports.map((port) => (
                <option key={port}>{port}</option>
              ))}
            </select>
          </label>
          <div className="file-picker-row">
            <button disabled={receiverEnabled} onClick={() => void chooseDirectory()}>
              选择保存目录
            </button>
            <span title={directory}>{directory || '尚未选择保存目录'}</span>
          </div>
          <button
            className={receiverEnabled ? 'danger' : 'primary'}
            onClick={() => void toggleReceiver()}
          >
            {receiverEnabled ? '停止接收' : '启用文件接收'}
          </button>
        </div>
      </div>

      <div className="serial-pair-card file-transfer-tasks">
        <h2>传输任务</h2>
        {!activeTasks.length && <p>暂无文件传输任务。</p>}
        {activeTasks.map((task) => {
          const percent = task.totalBytes
            ? Math.min(100, (task.transferredBytes / task.totalBytes) * 100)
            : 0
          const canCancel = !['completed', 'error', 'cancelled'].includes(task.state)
          return (
            <article key={task.taskId}>
              <div className="file-transfer-task-title">
                <strong>
                  {task.direction === 'send' ? '发送' : '接收'} · {task.fileName}
                  {task.direction === 'send' && ` · ${task.protocol === 'raw' ? '原始' : '可靠'}`}
                </strong>
                <span>
                  {task.port} · {task.message}
                </span>
              </div>
              <div className="file-transfer-progress">
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="file-transfer-task-meta">
                <span>{percent.toFixed(1)}%</span>
                <span>
                  {formatBytes(task.transferredBytes)} / {formatBytes(task.totalBytes)}
                </span>
                <span>{formatBytes(task.bytesPerSecond)}/s</span>
                <span>重试 {task.retries}</span>
                {canCancel && (
                  <button onClick={() => void window.api.cancelFileTransfer(task.taskId)}>
                    取消
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
