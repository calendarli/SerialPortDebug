# SerialFlow 串口调试助手

基于 Electron、React 和 TypeScript 的桌面串口调试工具，面向常规设备调试以及电机 PWM、PID 等高速遥测场景。

## 功能

- 串口参数配置：端口、波特率、数据位、停止位与校验位
- ASCII / HEX 数据收发
- 接收时间戳、暂停显示与收发字节统计
- 定时自动发送，最短周期 1 ms
- 正则表达式匹配与自动回复
- 实时接收：串口数据块到达后立即推送和显示，不做减帧；交互历史按用户设置的容量和条数进行 FIFO 淘汰

> 数据交互区默认保留最多 8 MB、5000 条收发记录，两项限制均可在标题栏调整并自动保存；条数设为 0 时不限制条数，但仍受容量限制。

## 开发

```bash
npm install
npm run dev
```

## 检查与构建

```bash
npm run typecheck
npm run build
npm run build:win
```

原生串口访问由 `serialport` 提供。切换 Electron 版本或运行环境后，如原生模块不匹配，可执行 `npm run postinstall` 重新构建依赖。
