import { useEffect, useRef, useState } from 'react'
import { Pin, PinOff } from 'lucide-react'

export function WindowPinButton(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef(false)

  useEffect(() => {
    let cancelled = false
    void window.api.getAlwaysOnTop().then(
      (value) => {
        if (!cancelled) {
          setEnabled(value)
          setBusy(false)
        }
      },
      () => {
        if (!cancelled) {
          setError('读取窗口置顶状态失败，请点击重试')
          setBusy(false)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async (): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      setEnabled(await window.api.setAlwaysOnTop(!enabled))
    } catch {
      setError('切换窗口置顶失败，请重试')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const label = enabled ? '取消窗口置顶' : '启用窗口置顶'
  const Icon = enabled ? Pin : PinOff
  return (
    <div className="window-pin-control">
      {error && <span role="alert">{error}</span>}
      <button
        type="button"
        className={`window-pin-button ${enabled ? 'active' : ''}`}
        title={label}
        aria-label={label}
        aria-pressed={enabled}
        disabled={busy}
        onClick={() => void toggle()}
      >
        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  )
}
