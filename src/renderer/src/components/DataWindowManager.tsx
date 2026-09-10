import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { PanelsTopLeft, X } from 'lucide-react'
import {
  dataWindowKey,
  dataWindowListKey,
  readDataWindowConfig,
  readDataWindowIds
} from '../data-window-config'

export function DataWindowManager(): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [ids, setIds] = useState(readDataWindowIds)
  const [, refresh] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    const update = (): void => {
      setIds(readDataWindowIds())
      refresh((value) => value + 1)
    }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  const open = async (id: string): Promise<void> => {
    try {
      await window.api.openDataWindow(id)
      setError('')
    } catch {
      setError('打开数据窗口失败，请重试')
    }
  }
  const create = async (): Promise<void> => {
    try {
      const id = crypto.randomUUID()
      const next = [...ids, id]
      localStorage.setItem(dataWindowListKey, JSON.stringify(next))
      setIds(next)
      await open(id)
    } catch {
      setError('保存窗口配置失败')
    }
  }
  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('删除此数据窗口及其配置？')) return
    try {
      await window.api.closeDataWindow(id)
      const next = ids.filter((entry) => entry !== id)
      localStorage.setItem(dataWindowListKey, JSON.stringify(next))
      localStorage.removeItem(dataWindowKey(id))
      setIds(next)
      setError('')
    } catch {
      setError('删除数据窗口失败，请重试')
    }
  }
  return (
    <>
      <button className="data-window-launch" title="独立数据窗口" onClick={() => setVisible(true)}>
        <PanelsTopLeft size={18} />
        数据窗口
      </button>
      {visible &&
        createPortal(
          <div className="data-window-overlay" onClick={() => setVisible(false)}>
            <section
              className="data-window-manager"
              role="dialog"
              aria-modal="true"
              aria-label="数据窗口"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="data-window-heading">
                <strong>数据窗口</strong>
                <button aria-label="关闭" onClick={() => setVisible(false)}>
                  <X size={18} />
                </button>
              </div>
              <p>
                可创建多个独立置顶窗口，每个窗口单独配置接收串口和匹配模板。配置自动保留，下次可从此处重新打开。
              </p>
              <button className="primary" onClick={() => void create()}>
                ＋ 新建数据窗口
              </button>
              <div className="data-window-saved-list">
                {ids.map((id, index) => {
                  const config = readDataWindowConfig(id)
                  return (
                    <article key={id}>
                      <div>
                        <strong>
                          {config.name} {index + 1}
                        </strong>
                        <small>
                          {config.port || '未配置串口'} · {config.template}
                        </small>
                      </div>
                      <button onClick={() => void open(id)}>打开</button>
                      <button onClick={() => void remove(id)}>删除</button>
                    </article>
                  )
                })}
              </div>
              {error && (
                <p className="data-window-error" role="alert">
                  {error}
                </p>
              )}
            </section>
          </div>,
          document.body
        )}
    </>
  )
}
