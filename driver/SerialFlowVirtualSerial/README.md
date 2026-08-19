# SerialFlow Virtual Serial Pair Driver

此目录是 SerialFlow 自有虚拟串口驱动工程，基于下方保留的 Microsoft
`serial/VirtualSerial2` 示例（Microsoft Public License）建立，目标为 Windows 10 1803+
和 Windows 11、UMDF 2、x64/ARM64。

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

构建需要 Visual Studio 2022 C++、Windows 11 SDK/WDK。开发安装需要管理员权限和测试签名；
正式发布必须完成 Microsoft 驱动签名。本应用不得自动关闭 Secure Boot 或启用测试模式。

```powershell
msbuild .\VirtualSerial.sln /t:Build /p:Configuration=Debug /p:Platform=x64
```

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
