import { useEffect, useState } from 'react'
import appIcon from '../assets/app-icon.png'

const repositoryUrl = 'https://github.com/calendarli/SerialPortDebug'

type AppInfo = {
  version: string
  platform: string
  arch: string
}

const platformNames: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}

export function AboutPanel(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const versions = window.electron.process.versions

  useEffect(() => {
    let active = true
    void window.api
      .getAppInfo()
      .then((info) => {
        if (active) setAppInfo(info)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="about-panel">
      <div className="about-identity">
        <img className="about-logo" src={appIcon} alt="SerialFlow 图标" />
        <div>
          <h2>SerialFlow</h2>
          <p>高速串口调试助手</p>
        </div>
      </div>

      <p className="about-description">
        面向设备联调和高频数据场景，提供多串口通信、快捷指令、自动回复以及脚本化数据处理能力。
      </p>

      <dl className="about-details">
        <div>
          <dt>应用版本</dt>
          <dd>{appInfo ? `v${appInfo.version}` : '读取中…'}</dd>
        </div>
        <div>
          <dt>运行平台</dt>
          <dd>
            {appInfo
              ? `${platformNames[appInfo.platform] || appInfo.platform} · ${appInfo.arch}`
              : '读取中…'}
          </dd>
        </div>
        <div>
          <dt>Electron</dt>
          <dd>v{versions.electron}</dd>
        </div>
        <div>
          <dt>Chromium</dt>
          <dd>v{versions.chrome}</dd>
        </div>
        <div>
          <dt>Node.js</dt>
          <dd>v{versions.node}</dd>
        </div>
      </dl>

      <div className="about-repository">
        <span className="about-repository-icon" aria-hidden="true">
          &lt;/&gt;
        </span>
        <div>
          <strong>公开仓库</strong>
          <a
            href={repositoryUrl}
            target="_blank"
            rel="noreferrer"
            title="在浏览器中打开 GitHub 仓库"
          >
            github.com/calendarli/SerialPortDebug
          </a>
        </div>
      </div>

      <p className="about-footer">欢迎通过 GitHub 提交问题和改进建议。</p>
    </section>
  )
}
