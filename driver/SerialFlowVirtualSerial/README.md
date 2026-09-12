# SerialFlow Virtual Serial Pair Driver

此目录是 SerialFlow 自有虚拟串口驱动工程，基于下方保留的 Microsoft
`serial/VirtualSerial2` 示例（Microsoft Public License）建立，目标为 Windows 10 1803+
和 Windows 11、UMDF 2、x64/ARM64。

## 串口兼容性验证

修复了 GET_CHARS / GET_HANDFLOW 空响应、常用状态查询和 PURGE 请求缺失，
并增加 RXCHAR / TXEMPTY 通知。SerialFlow 对自有 UMDF 虚拟端口使用写入完成回调，
不调用该驱动不支持的 FlushFileBuffers；实体串口仍等待 drain。
这不表示对端应用已经读取或处理数据，也不表示实现了完整硬件流控或所有读超时语义。

关闭占用端口的软件，更新驱动并重新打开端口后，可运行：

```powershell
./scripts/test-virtual-serial.ps1 -First COM180 -Second COM181
```

端口必须是已经创建且空闲的一对。脚本验证 115200/8N1、接收事件、双向二进制收发、
缓冲区清空和 DTR/RTS 设置，不创建或删除设备。VOFA+ 本体仍需单独复测。

## 当前状态与安全边界

工程已包含串口 IOCTL、读取/写入队列、环形缓冲区和跨端点投递。设备实例按安装顺序
两两配对，最多支持 32 对；写入一端的数据只进入对端读取缓冲区。驱动使用独立的
`ROOT\SERIALFLOWVSP` 硬件 ID，避免与微软示例或 com0com 冲突。x64 Debug 构建已在
COM8↔COM9 上完成双向数据实测。

目标路径为：

```text
COM A WriteFile -> endpoint A -> pair broker -> endpoint B buffer -> COM B ReadFile
COM B WriteFile -> endpoint B -> pair broker -> endpoint A buffer -> COM A ReadFile
```

构建需要 Visual Studio 2022/2026 C++、匹配版本的 Windows SDK/WDK 与 Visual Studio WDK 扩展。开发安装需要管理员权限和测试签名；
正式发布必须完成 Microsoft 驱动签名。本应用不得自动关闭 Secure Boot 或启用测试模式。

```powershell
# 在仓库根目录运行；默认目标为当前机器架构
bun run build:driver
# 可选：构建 ARM64
$env:SERIALFLOW_ARCH = "arm64"
bun run build:driver
```

`bun install` 自动尝试 Release 构建；失败只警告，虚拟串口成为未包含的可选功能。
`MSBUILD_PATH` 可指定 MSBuild。构建产物保存在 `build/virtual-serial/<arch>`，完整驱动包
才会复制到 `resources/virtual-serial/win-<arch>`。不会安装驱动或导入证书。
目录内 `.gitignore` 只允许源码、工程与文档；已追踪的旧二进制需另行手动取消追踪。

原始文件中的 Microsoft 版权头必须保留。官方来源：
<https://github.com/microsoft/Windows-driver-samples/tree/main/serial/VirtualSerial2>

---
page_type: sample
urlFragment: virtual-serial-driver-sample-v2
description: "Demonstrates UMDF version 2 serial drivers and includes a simple virtual serial driver (ComPort) and a controller-less modem driver (FakeModem)."
languages:
- c
products:
- windows
- windows-wdk
---

# Virtual serial driver sample (V2)

This sample demonstrates these two serial drivers:

- A simple virtual serial driver (ComPort)

- A controller-less modem driver (FakeModem).This driver supports sending and receiving AT commands using the ReadFile and WriteFile calls or via a TAPI interface using an application such as, HyperTerminal.

This sample driver is a minimal driver meant to demonstrate the usage of the User-Mode Driver Framework. It is not intended for use in a production environment.

For more information, see the [Serial Controller Driver Design Guide](https://docs.microsoft.com/windows-hardware/drivers/serports/).

## Code tour

### internal.h

- This is the main header file for the sample driver.

### driver.c and driver.h

- Definition and implementation of the driver callback function (EVT_WDF_DRIVER_DEVICE_ADD) for the sample. This includes **DriverEntry** and events on the framework driver object.

### device.c and driver.h

- Definition and implementation of the device callback interface for the sample. This includes events on the framework device object.

### queue.c and queue.h

- Definition and implementation of the base queue callback interface. This includes events on the framework I/O queue object.

### ringbuffer.c and ringbuffer.h

- Definition and implement of ring buffer for pending data.

### VirtualSerial.rc /FakeModem.rc

- This file defines resource information for the sample driver.

### VirtualSerial.inf / FakeModem.inf

- INF file that contains installation information for this driver.
