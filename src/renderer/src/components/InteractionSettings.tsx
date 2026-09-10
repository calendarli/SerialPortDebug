import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, X } from 'lucide-react'
import {
  displayEncodings,
  normalizeInteractionDisplay,
  type InteractionDisplay
} from '../interaction-settings'

type Props = {
  display: InteractionDisplay
  fontSize: number
  cacheSizeMb: number
  cacheEntryLimit: number
  onDisplayChange: (value: InteractionDisplay) => void
  onFontSizeChange: (value: number) => void
  onCacheSizeChange: (value: number) => void
  onCacheEntryLimitChange: (value: number) => void
}
export function InteractionSettings(props: Props): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(props.display)
  const [fontSize, setFontSize] = useState(props.fontSize)
  const [cacheMb, setCacheMb] = useState(props.cacheSizeMb)
  const [entryLimit, setEntryLimit] = useState(props.cacheEntryLimit)
  const [error, setError] = useState('')
  const open = (): void => {
    setDraft(props.display)
    setFontSize(props.fontSize)
    setCacheMb(props.cacheSizeMb)
    setEntryLimit(props.cacheEntryLimit)
    setError('')
    dialog.current?.showModal()
  }
  const save = (): void => {
    if (
      !Number.isInteger(fontSize) ||
      fontSize < 8 ||
      fontSize > 24 ||
      !Number.isInteger(cacheMb) ||
      cacheMb < 1 ||
      cacheMb > 1024 ||
      !Number.isInteger(entryLimit) ||
      entryLimit < 0 ||
      entryLimit > 1000000
    ) {
      setError('请检查数值：默认字号 8～24，缓存 1～1024 MB，条数 0～1000000。')
      return
    }
    try {
      props.onDisplayChange(normalizeInteractionDisplay(draft))
      props.onFontSizeChange(fontSize)
      props.onCacheSizeChange(cacheMb)
      props.onCacheEntryLimitChange(entryLimit)
      dialog.current?.close()
    } catch {
      setError('保存设置失败，请检查本地存储空间后重试')
    }
  }
  return (
    <>
      <button type="button" className="receive-display-toggle" title="数据交互设置" onClick={open}>
        <Settings2 size={15} aria-hidden="true" />
        设置
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="interaction-settings"
          aria-labelledby="interaction-settings-title"
        >
          <div className="interaction-settings-head">
            <strong id="interaction-settings-title">数据交互设置</strong>
            <button type="button" aria-label="关闭设置" onClick={() => dialog.current?.close()}>
              <X size={18} />
            </button>
          </div>
          <div className="interaction-settings-body">
            <div className="interaction-settings-grid">
              <label>
                默认字号（px）
                <input
                  type="number"
                  min={8}
                  max={24}
                  value={Number.isNaN(fontSize) ? '' : fontSize}
                  onChange={(event) => setFontSize(event.target.valueAsNumber)}
                />
              </label>
              <label>
                缓存容量（MB）
                <input
                  type="number"
                  min={1}
                  max={1024}
                  value={Number.isNaN(cacheMb) ? '' : cacheMb}
                  onChange={(event) => setCacheMb(event.target.valueAsNumber)}
                />
              </label>
              <label>
                缓存条数
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  value={Number.isNaN(entryLimit) ? '' : entryLimit}
                  onChange={(event) => setEntryLimit(event.target.valueAsNumber)}
                />
                <small>0 表示不限制条数</small>
              </label>
              <label>
                文本显示编码
                <select
                  value={draft.encoding}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      encoding: event.target.value as InteractionDisplay['encoding']
                    })
                  }
                >
                  {displayEncodings.map((encoding) => (
                    <option key={encoding} value={encoding}>
                      {encoding.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(['rx', 'tx'] as const).map((direction) => (
              <fieldset key={direction}>
                <legend>
                  {direction.toUpperCase()} {direction === 'rx' ? '接收' : '发送'}显示
                </legend>
                <div className="interaction-settings-direction">
                  <label>
                    文字颜色
                    <input
                      type="color"
                      value={draft[direction].color}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          [direction]: { ...draft[direction], color: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label>
                    字体
                    <select
                      value={draft[direction].font}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          [direction]: { ...draft[direction], font: event.target.value }
                        })
                      }
                    >
                      {[
                        ...new Set([
                          'Consolas',
                          'Cascadia Mono',
                          'Courier New',
                          'Microsoft YaHei',
                          'SimSun',
                          draft[direction].font
                        ])
                      ].map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    字号
                    <select
                      value={draft[direction].size ?? ''}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          [direction]: {
                            ...draft[direction],
                            size: event.target.value ? Number(event.target.value) : null
                          }
                        })
                      }
                    >
                      <option value="">跟随默认</option>
                      {Array.from({ length: 17 }, (_, index) => (
                        <option key={index} value={index + 8}>
                          {index + 8} px
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div
                  className="interaction-settings-preview"
                  style={{
                    color: draft[direction].color,
                    fontFamily: `"${draft[direction].font}", monospace`,
                    fontSize: draft[direction].size ?? (Number.isFinite(fontSize) ? fontSize : 14)
                  }}
                >
                  {direction.toUpperCase()} · 示例数据 123.45 · AA 02 BB
                </div>
              </fieldset>
            ))}
            <p className="interaction-settings-hint">
              编码只影响此处后续 RX/TX 文本记录，HEX 显示保持原始字节。默认字号也可通过 Ctrl +
              鼠标滚轮调整；指定字号的方向使用独立设置。
            </p>
            {error && (
              <p role="alert" className="data-window-error">
                {error}
              </p>
            )}
          </div>
          <div className="interaction-settings-actions">
            <button type="button" onClick={() => dialog.current?.close()}>
              取消
            </button>
            <button type="button" className="primary" onClick={save}>
              保存设置
            </button>
          </div>
        </dialog>,
        document.body
      )}
    </>
  )
}
