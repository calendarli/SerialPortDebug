# SerialFlow 串口调试助手

[![License: GPL-3.0-only](https://img.shields.io/badge/License-GPL--3.0--only-blue.svg)](LICENSE)

> **开源协议：GPL-3.0（仅第 3 版）**。SerialFlow 原创代码采用 GPL-3.0-only，完整条款见 [LICENSE](LICENSE)；第三方代码及驱动的授权范围见下方[开源协议说明](#开源协议)。

SerialFlow 是一款基于 Electron、React 和 TypeScript 开发的桌面串口调试工具，适用于常规设备联调，以及电机 PWM、PID 参数、传感器遥测等高频数据收发场景。

应用支持多串口、ASCII/HEX 收发、快捷指令、自动回复、CRC、自动发送和 JavaScript/TypeScript 编程。数据交互区使用虚拟列表和受限缓存，持续显示实际收到与发出的数据，不主动减帧。

项目仓库：[calendarli/SerialPortDebug](https://github.com/calendarli/SerialPortDebug)。应用侧栏提供“帮助”入口，编程接口参见 [编程手册](src/renderer/public/programming-manual.html)。

## 主要功能

### 协议分帧与高吞吐管线

- 每个串口可独立选择原始数据块、分隔符、固定长度、帧头帧尾或空闲超时分帧。
- 完整帧统一进入数据显示、条件暂停和自动回复处理，避免系统数据块拆帧或粘包造成误匹配。
- 接收链路使用二进制批量 IPC，按时间窗口或数据量合并跨进程通知，不使用 Base64 中转，也不丢弃原始帧。

### 实时曲线与 PID 分析

- 交互区上方提供多通道实时曲线，可识别 `PWM=10,Speed=20` 或 `10,20,30` 等数值格式。
- 支持通道开关、曲线颜色、横轴窗口和纵轴范围调整，以及悬停查看采样值。
- PID 分析提供上升时间、稳定时间、超调和参数调整建议；建议不会自动写入设备。

### Modbus RTU 与配置共享

- “Modbus RTU”页面支持保持寄存器读取、定时轮询，以及 H06/H10 写入。
- 寄存器支持 HEX16、UINT16、INT32、UINT32、FLOAT32 显示和字序设置。
- 支持 MBP 导入及 Modbus JSON 配置导入、导出。
- 串口配置、快捷指令、自动回复及常用设置可导入或导出为 `.serialflow` 工程文件；快捷指令和自动回复也支持单独导入、导出。

### 多串口管理

- 保存多套串口配置，并可同时打开多个串口。
- 支持端口、波特率、数据位、停止位、校验位和流控制配置。
- 支持使用 SerialFlow 自有 UMDF 2 驱动创建、查看和删除本地虚拟串口对。
- “管理与安装”可自动检测并安装开发版驱动所需的测试签名证书；证书已安装时不再显示安装按钮。
- 普通发送、快捷指令、指令组和自动回复均可选择目标端口。
- 串口配置、面板尺寸和常用显示选项会自动持久化。
- 打开失败时同时显示底部状态和弹窗，并针对端口占用、设备断开、参数不受支持等情况给出提示。

### 数据交互

- 在同一交互区展示 RX 和 TX，并使用方向、端口、时间戳和颜色加以区分。
- 使用虚拟列表降低数千条数据持续更新时的渲染开销；收到多少显示多少，不主动丢弃显示帧。
- 默认自动跟随到最新数据，鼠标悬停时突出当前记录。
- 支持 ASCII/HEX 接收显示、时间戳、暂停显示和条件自动暂停。
- 条件暂停支持 ASCII/HEX 内容匹配及正则表达式。
- `Ctrl + F` 搜索内容，可选正则、向上、向下或循环查找。
- 右键可复制当前记录或清空列表；`Ctrl + 鼠标滚轮` 可缩放交互区字体。
- 底部状态栏显示 RX/TX 通讯次数、缓存占用和实时收发频率。

交互历史默认最多使用 8 MB 缓存并保留 5,000 条记录。容量和条数均可修改；条数设为 `0` 表示不限制条数，但仍受缓存容量限制。达到限制后按 FIFO 淘汰最早记录，避免内存无限增长。

### 数据发送

- 支持 ASCII/HEX 输入；切换编码时会同步转换编辑框内容。
- 可选 CRLF、CRC、自动发送周期和自动发送次数。
- 自动发送最短周期为 1 ms，次数为 `0` 时持续发送，直到手动停止。
- 勾选“自动发送”只启用配置，按下发送按钮后才开始周期发送。
- 可选择已打开的目标串口。
- 发送区高度可拖拽调整并自动保存。

支持以下 CRC 格式：

- CRC-8
- CRC-16/MODBUS
- CRC-16/CCITT-FALSE
- CRC-16/XMODEM
- CRC-32

### 快捷指令与指令组

- 通过右键菜单新建、编辑或删除指令和指令组。
- 指令组支持任意层级嵌套，分组卡片清晰展示层级关系。
- 指令可配置名称、目标端口、最终发送编码、CRC、按下发送内容及可选的抬起发送内容。
- 指令可配置自动发送周期和次数；必须按下发送按钮后才会启动。
- 指令组可循环发送内部指令，并配置指令间延迟和循环次数；次数为 `0` 时持续循环。
- 编辑指令组时可批量修改组内所有指令的目标端口。
- 参数支持中文名称、点击复制完整占位符，以及 ASCII、DEC、HEX 三种输入方式。

HEX 指令参数可以指定占用字节数。DEC/HEX 数值会按无符号大端顺序左侧补零，例如 2 字节参数输入十进制 `10`，最终发送 `00 0A`；ASCII 模式输入 `10` 时发送字符字节 `31 30`。

快捷指令可切换为**编程模式**，使用同步 JavaScript 函数 `process(data, context)` 处理整条报文。`data` 是参数替换、ASCII/HEX 编码后的字节数组；返回非空字节数组或 `Uint8Array`，每项必须是 `0~255` 的整数。可以在函数内定义辅助函数、重组报文或追加非标准校验。例如追加异或校验：

```javascript
function process(data, context) {
  const checksum = data.reduce((value, byte) => value ^ byte, 0)
  return [...data, checksum]
}
```

处理顺序为「参数替换 → 编码 → 处理函数 → 标准 CRC」，如果函数已经生成完整校验，请关闭标准 CRC。`context.phase` 为 `press`（主指令）、`release`（抬起指令）或 `companion`（被其他指令附带执行），并提供 `context.text`、`context.parameters` 和 `context.port`。所有发送入口均经过处理函数，执行失败或超时的报文不会发送。顶层变量在该指令的多次执行间保留，修改程序后重新初始化。编辑器支持 Tab 缩进、Ctrl+S 保存。

**附带执行**可选择另一条已有快捷指令，使用所选指令自己的端口、参数、编程处理和 CRC。例如：先新建“读取 X 坐标”，再编辑“X 持续左移”，将前者选为附带指令，勾选循环并设置 `200ms`。按住“X 持续左移”时先发送主指令，成功后立即查询一次，此后每次查询发送完成再等待 `200ms`；松开按钮即取消后续查询，并发送配置的抬起指令（例如停止移动）。未勾选循环时只附带执行一次。

主指令启用自动发送时，附带执行跟随其启动、停止及次数完成；组循环中每条主指令只附带执行一次，节奏由组循环控制。引用执行不会启动被引用指令的自动发送、抬起指令或其他附带指令。失去窗口焦点会结束按住操作；断开连接、删除或修改正在执行的指令会停止相关执行，重新连接不会自动续发。附带指令的引用、循环设置及处理程序均随本地配置和导入导出保存。

附带执行也可切换为**自定义输入**，直接填写 ASCII/HEX 内容并引用主指令的参数占位符。此时使用主指令的端口、编码、参数、处理函数和 CRC，处理函数中的 `context.phase` 为 `companion`。**已有快捷指令与自定义输入二选一，仅执行当前选中的来源**，两者均支持单次执行或按指定间隔循环。

快捷指令和自动回复的编程编辑器均直接支持 **JavaScript / TypeScript**，无需手动切换语言，原有 JavaScript 配置继续使用。源码统一转译后执行，支持类型标注、接口、泛型及枚举；会报告语法错误位置，不进行完整静态类型检查，也不支持 `import / export`。源码随配置保存和导入导出，转译结果缓存复用，仍由原有 QuickJS 沙箱执行。

```typescript
// 快捷指令：返回完整报文字节
function process(data: number[]): Uint8Array {
  return new Uint8Array([...data, 0xff])
}

// 自动回复：返回发送模板所引用的参数
function calculate(input: string): Record<string, number> {
  return { 长度: input.length }
}
```

### 自动回复

- 按目标端口匹配收到的数据，并从同一端口发送回复。
- 接收条件支持 ASCII/HEX 完整匹配，也可启用正则表达式。
- 规则可通过右键菜单新建、编辑和删除，也可单独启用、停用或重置状态。
- 回复指令使用完整参数名占位符，例如 `AA {{计数}} BB`。
- 支持参数模式和编程模式。

参数模式适合固定或手动调整的参数。每个参数都可独立选择 ASCII、DEC 或 HEX，并设置 HEX 最终编码下的占用字节数。

编程模式会在每次规则匹配时执行一次 JavaScript `calculate(input, match, context)`，函数应返回一个对象，对象键对应发送指令中的占位符。顶层变量会在多次触发之间保留，点击规则上的“重置状态”可重新初始化。

```javascript
/**
 * 根据本次匹配计算发送指令中的参数。
 * @param {string} input 本次匹配到的输入内容
 * @param {string[]} match 正则匹配结果；未启用正则时为空数组
 * @param {object} context 上下文，包含 port、groups 等信息
 * @returns {Record<string, string | number>} 参数名与参数值组成的对象
 */
function calculate(input, match, context) {
  global.counter ??= 0
  global.counter++
  return {
    计数: global.counter
  }
}
```

配合发送指令：

```text
AA {{计数}} BB
```

当最终发送编码为 HEX 时，程序返回的数字按十进制数值转换为偶数位 HEX，例如 `1 → 01`、`10 → 0A`、`256 → 0100`；返回字符串则按原始 HEX 文本校验。编辑器会实时识别发送指令中的占位符并提供点击复制。编程框内按 `Tab` 插入制表符，按 `Ctrl + S` 保存规则。

编程模式可通过 `global.counter` 读写所属自动回复分组的共享变量。快捷指令分组使用独立的 `global`，指令模板通过 `{{global.counter}}` 读取、`{{global.counter++}}` 发送后递增，或通过 `{{++global.counter}}` 递增后发送。各分组互不影响，变量随本地配置和导出的工程保存；“重置 global”会清空当前分组变量。

## 快速开始

### 使用安装程序

Windows 安装程序采用引导式安装，用户可自行选择安装目录，并可创建桌面和开始菜单快捷方式。

如果需要使用开发版 SerialFlow 虚拟串口驱动：

1. 打开“虚拟串口对”页面，找到“管理与安装”。
2. 如果页面显示“安装测试签名证书”，点击按钮并允许 Windows 管理员授权。
3. 应用会将随安装包提供的证书安装到本机的“受信任的根证书颁发机构”和“受信任的发布者”。
4. 安装成功后按钮会自动隐藏，此时可创建虚拟串口对。

证书安装只需在每台电脑上执行一次。该操作不会关闭 Secure Boot，也不会启用 Windows 测试模式；如果系统仍拒绝加载开发版驱动，需要根据副电脑的安全策略手动处理。正式发布版本应使用 Microsoft 签名的驱动，不依赖测试证书。

### 从源码运行

环境要求：Node.js 20.19+（20.x）或 22.12+、npm，以及当前 Electron 平台可用的原生编译工具链。

```bash
git clone https://github.com/calendarli/SerialPortDebug.git
cd SerialPortDebug
npm ci
npm run dev
```

## 开发与构建

```bash
# 代码格式化
npm run format

# ESLint 检查
npm run lint

# 主进程和渲染进程类型检查
npm run typecheck

# 生产构建
npm run build

# 生成 Windows 安装程序
npm run build:win

# 生成未打包应用目录
npm run build:unpack
```

构建配置还提供 `npm run build:mac` 和 `npm run build:linux`。当前 `extraResources` 包含 Windows 虚拟串口驱动路径，跨平台打包前需调整这些资源配置；虚拟串口驱动仅适用于 Windows。

Windows 打包前需准备 `electron-builder.yml` 中列出的驱动管理器、驱动包和证书，构建要求参见 [驱动说明](driver/SerialFlowVirtualSerial/README.md)。仅运行 `npm run build` 不会编译驱动。

已有自动化测试可通过 `node --test tests/*.test.cjs` 运行。

切换 Electron 版本或运行环境后，如果 `serialport` 原生模块不匹配，请执行：

```bash
npm run postinstall
```

## 常见问题

### 无法打开串口或提示端口被占用

关闭其他串口助手、烧录工具或可能占用该端口的程序，确认设备仍在线，然后刷新端口列表并重试。多个 SerialFlow 配置也不能同时打开同一个系统串口。

### `SetCommState: The parameter is incorrect`

Windows 串口驱动拒绝了当前参数组合。请先尝试常见配置，例如 8 数据位、1 停止位、无校验、关闭流控制，并确认设备驱动支持所选波特率。部分 USB 转串口设备不支持特殊波特率或特定的数据位/停止位组合。

### 提示 HEX 数据格式错误

HEX 文本只能包含 `0-9`、`A-F`，并应组成完整字节，例如 `AA 01 BB`。在自动回复编程模式中，若希望十进制数自动转为 HEX，应返回数字 `10`，不要返回字符串 `'10'`。

### 高频收发时频率低于设置值

1 ms 是调度允许的最小配置值，不代表操作系统、USB 串口芯片和设备一定能达到 1,000 次/秒。实际频率还受波特率、单帧长度、驱动缓冲、Electron 事件循环和界面渲染影响。可减少时间戳与编程处理、合理限制缓存条数，并确保波特率能够容纳目标数据量。

### 无法安装测试签名证书或虚拟串口驱动

确认使用的是 Windows 版本，并在管理员授权窗口中选择“是”。如果曾取消授权，可重新点击“安装测试签名证书”。按钮消失表示证书已经同时存在于本机的受信任根证书库和受信任发布者证书库。

证书受信任不等于系统一定允许加载测试签名驱动。启用了 Secure Boot、组织安全策略或驱动签名强制时，Windows 仍可能拒绝开发版驱动。SerialFlow 不会自动修改这些系统安全设置；请优先使用 Microsoft 正式签名的驱动包。

## 技术栈

- Electron
- React 19
- TypeScript
- Vite
- serialport
- QuickJS/Emscripten
- TanStack Virtual

## 项目结构

- `src/main/`：Electron 主进程、串口通信及系统集成。
- `src/preload/`：主进程与界面的通信接口。
- `src/renderer/src/`：React 界面、协议处理及 QuickJS 编程运行时。
- `src/renderer/public/`：帮助页面与编程手册。
- `driver/SerialFlowVirtualSerial/`：Windows 虚拟串口驱动及管理器。
- `tests/`：协议与快捷指令等自动化测试。

## 反馈与贡献

提交问题时请附上应用版本、操作系统、串口设备与参数、复现步骤和相关日志。提交代码前运行 `npm run lint`、`npm run typecheck` 及与修改相关的测试。项目版本更新规则见 [AGENTS.md](AGENTS.md)。

## 开源协议

除另有授权声明的第三方代码外，SerialFlow 原创代码采用 **GNU General Public License v3.0（GPL-3.0-only，仅第 3 版）**，完整协议见 [LICENSE](LICENSE)。

- 允许使用、复制、修改和分发，包括商业使用。
- 分发本项目或其衍生作品时，须遵守 GPL-3.0，保留版权和许可声明，注明修改，并按协议要求提供对应源代码；分发衍生作品时须继续采用 GPL-3.0。
- 软件按现状提供，不附带任何担保，具体责任限制以协议全文为准。

以上为简要说明，具体条款以 [GNU 官方协议文本](https://www.gnu.org/licenses/gpl-3.0.html) 和仓库中的 [LICENSE](LICENSE) 为准。

### 第三方代码与驱动

`driver/SerialFlowVirtualSerial/` 基于 Microsoft `serial/VirtualSerial2` 示例开发，该部分按其 [驱动说明](driver/SerialFlowVirtualSerial/README.md) 保留 **Microsoft Public License（Ms-PL）** 授权及 Microsoft 版权声明，不由本项目的 GPL-3.0 声明重新授权。Ms-PL 条款参见 [协议全文](https://opensource.org/license/ms-pl)。

Electron、React、serialport、QuickJS 等第三方依赖继续遵循各自许可证。分发源码或安装包时，也须保留并遵守相关第三方许可及版权声明。
