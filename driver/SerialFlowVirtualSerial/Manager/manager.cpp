#include <windows.h>
#include <newdev.h>
#include <setupapi.h>
#include <devguid.h>
#include <iostream>
#include <string>
#include <vector>

#pragma comment(lib, "newdev.lib")
#pragma comment(lib, "setupapi.lib")
#pragma comment(lib, "ole32.lib")

static const wchar_t* HardwareId = L"ROOT\\SERIALFLOWVSP";

static void PrintError(const wchar_t* action) {
    std::wcerr << action << L" failed (Win32 " << GetLastError() << L")\n";
}

static bool IsSerialFlowDevice(HDEVINFO devices, SP_DEVINFO_DATA* device) {
    DWORD bytes = 0;
    SetupDiGetDeviceRegistryPropertyW(devices, device, SPDRP_HARDWAREID, nullptr, nullptr, 0, &bytes);
    if (!bytes || GetLastError() != ERROR_INSUFFICIENT_BUFFER) return false;
    std::vector<BYTE> buffer(bytes);
    if (!SetupDiGetDeviceRegistryPropertyW(devices, device, SPDRP_HARDWAREID, nullptr,
            buffer.data(), bytes, nullptr)) return false;
    const wchar_t* value = reinterpret_cast<const wchar_t*>(buffer.data());
    while (*value) {
        if (_wcsicmp(value, HardwareId) == 0) return true;
        value += wcslen(value) + 1;
    }
    return false;
}

static std::wstring GetInstanceId(HDEVINFO devices, SP_DEVINFO_DATA* device) {
    DWORD chars = 0;
    SetupDiGetDeviceInstanceIdW(devices, device, nullptr, 0, &chars);
    if (!chars || GetLastError() != ERROR_INSUFFICIENT_BUFFER) return L"";
    std::vector<wchar_t> value(chars);
    return SetupDiGetDeviceInstanceIdW(devices, device, value.data(), chars, nullptr)
        ? value.data() : L"";
}

static bool SetDeviceValue(HDEVINFO devices, SP_DEVINFO_DATA* device, const wchar_t* name,
        DWORD type, const BYTE* value, DWORD bytes) {
    HKEY key = SetupDiOpenDevRegKey(devices, device, DICS_FLAG_GLOBAL, 0, DIREG_DEV,
        KEY_SET_VALUE | KEY_QUERY_VALUE);
    if (key == INVALID_HANDLE_VALUE) return false;
    const LONG result = RegSetValueExW(key, name, 0, type, value, bytes);
    RegCloseKey(key);
    if (result != ERROR_SUCCESS) SetLastError(result);
    return result == ERROR_SUCCESS;
}

static std::wstring GetDeviceString(HDEVINFO devices, SP_DEVINFO_DATA* device, const wchar_t* name) {
    HKEY key = SetupDiOpenDevRegKey(devices, device, DICS_FLAG_GLOBAL, 0, DIREG_DEV, KEY_QUERY_VALUE);
    if (key == INVALID_HANDLE_VALUE) return L"";
    wchar_t value[128] = {};
    DWORD type = 0, bytes = sizeof(value);
    const LONG result = RegQueryValueExW(key, name, nullptr, &type,
        reinterpret_cast<BYTE*>(value), &bytes);
    RegCloseKey(key);
    return result == ERROR_SUCCESS && type == REG_SZ ? value : L"";
}

static bool OpenDevice(const std::wstring& instanceId, HDEVINFO* devices, SP_DEVINFO_DATA* device) {
    *devices = SetupDiCreateDeviceInfoList(nullptr, nullptr);
    if (*devices == INVALID_HANDLE_VALUE) return false;
    *device = { sizeof(*device) };
    if (!SetupDiOpenDeviceInfoW(*devices, instanceId.c_str(), nullptr, 0, device)) {
        SetupDiDestroyDeviceInfoList(*devices);
        *devices = INVALID_HANDLE_VALUE;
        return false;
    }
    return true;
}

static bool RemoveInstance(const std::wstring& instanceId) {
    HDEVINFO devices;
    SP_DEVINFO_DATA device;
    if (!OpenDevice(instanceId, &devices, &device)) return false;
    SP_REMOVEDEVICE_PARAMS parameters = {};
    parameters.ClassInstallHeader.cbSize = sizeof(SP_CLASSINSTALL_HEADER);
    parameters.ClassInstallHeader.InstallFunction = DIF_REMOVE;
    parameters.Scope = DI_REMOVEDEVICE_GLOBAL;
    const bool success = SetupDiSetClassInstallParamsW(devices, &device,
            &parameters.ClassInstallHeader, sizeof(parameters)) &&
        SetupDiCallClassInstaller(DIF_REMOVE, devices, &device);
    SetupDiDestroyDeviceInfoList(devices);
    return success;
}

static bool RestartInstance(const std::wstring& instanceId) {
    HDEVINFO devices;
    SP_DEVINFO_DATA device;
    if (!OpenDevice(instanceId, &devices, &device)) return false;
    SP_PROPCHANGE_PARAMS parameters = {};
    parameters.ClassInstallHeader.cbSize = sizeof(SP_CLASSINSTALL_HEADER);
    parameters.ClassInstallHeader.InstallFunction = DIF_PROPERTYCHANGE;
    parameters.StateChange = DICS_PROPCHANGE;
    parameters.Scope = DICS_FLAG_GLOBAL;
    const bool success = SetupDiSetClassInstallParamsW(devices, &device,
            &parameters.ClassInstallHeader, sizeof(parameters)) &&
        SetupDiCallClassInstaller(DIF_PROPERTYCHANGE, devices, &device);
    SetupDiDestroyDeviceInfoList(devices);
    return success;
}

static bool CreateEndpoint(std::wstring* instanceId) {
    HDEVINFO devices = SetupDiCreateDeviceInfoList(&GUID_DEVCLASS_PORTS, nullptr);
    if (devices == INVALID_HANDLE_VALUE) return false;
    SP_DEVINFO_DATA device = { sizeof(device) };
    bool success = SetupDiCreateDeviceInfoW(devices, L"SerialFlow Virtual Serial Port",
        &GUID_DEVCLASS_PORTS, nullptr, nullptr, DICD_GENERATE_ID, &device) != FALSE;
    if (success) {
        const DWORD bytes = static_cast<DWORD>((wcslen(HardwareId) + 2) * sizeof(wchar_t));
        success = SetupDiSetDeviceRegistryPropertyW(devices, &device, SPDRP_HARDWAREID,
            reinterpret_cast<const BYTE*>(HardwareId), bytes) != FALSE;
    }
    if (success) success = SetupDiCallClassInstaller(DIF_REGISTERDEVICE, devices, &device) != FALSE;
    if (success) {
        *instanceId = GetInstanceId(devices, &device);
        success = !instanceId->empty();
    }
    if (!success) PrintError(L"Create endpoint");
    SetupDiDestroyDeviceInfoList(devices);
    return success;
}

static bool ConfigureEndpoint(const std::wstring& instanceId, const wchar_t* pairId,
        DWORD side, const wchar_t* portName) {
    HDEVINFO devices;
    SP_DEVINFO_DATA device;
    if (!OpenDevice(instanceId, &devices, &device)) return false;
    bool success = SetDeviceValue(devices, &device, L"PairId", REG_SZ,
        reinterpret_cast<const BYTE*>(pairId),
        static_cast<DWORD>((wcslen(pairId) + 1) * sizeof(wchar_t)));
    if (success) success = SetDeviceValue(devices, &device, L"PairSide", REG_DWORD,
        reinterpret_cast<const BYTE*>(&side), sizeof(side));
    if (success) success = SetDeviceValue(devices, &device, L"PortName", REG_SZ,
        reinterpret_cast<const BYTE*>(portName),
        static_cast<DWORD>((wcslen(portName) + 1) * sizeof(wchar_t)));
    SetupDiDestroyDeviceInfoList(devices);
    if (!success) PrintError(L"Configure endpoint");
    return success;
}

static int CreatePair(const wchar_t* infPath, const wchar_t* first, const wchar_t* second) {
    GUID id;
    wchar_t pairId[64] = {};
    if (FAILED(CoCreateGuid(&id)) || StringFromGUID2(id, pairId, 64) == 0) return 2;
    std::wstring endpoint[2];
    if (!CreateEndpoint(&endpoint[0]) || !CreateEndpoint(&endpoint[1])) {
        if (!endpoint[0].empty()) RemoveInstance(endpoint[0]);
        if (!endpoint[1].empty()) RemoveInstance(endpoint[1]);
        return 2;
    }
    BOOL reboot = FALSE;
    if (!UpdateDriverForPlugAndPlayDevicesW(nullptr, HardwareId, infPath, INSTALLFLAG_FORCE, &reboot)) {
        PrintError(L"Install driver");
        RemoveInstance(endpoint[0]); RemoveInstance(endpoint[1]);
        return 3;
    }
    if (!ConfigureEndpoint(endpoint[0], pairId, 0, first) ||
        !ConfigureEndpoint(endpoint[1], pairId, 1, second) ||
        !RestartInstance(endpoint[0]) || !RestartInstance(endpoint[1])) {
        PrintError(L"Apply endpoint configuration");
        RemoveInstance(endpoint[0]); RemoveInstance(endpoint[1]);
        return 4;
    }
    std::wcout << L"{\"created\":2,\"pairId\":\"" << pairId
        << L"\",\"first\":\"" << first << L"\",\"second\":\"" << second
        << L"\",\"rebootRequired\":" << (reboot ? L"true" : L"false") << L"}\n";
    return reboot ? 1 : 0;
}

struct DeviceRecord { std::wstring instanceId; std::wstring portName; };

static std::vector<DeviceRecord> EnumerateSerialFlowDevices() {
    std::vector<DeviceRecord> result;
    HDEVINFO devices = SetupDiGetClassDevsW(nullptr, nullptr, nullptr,
        DIGCF_ALLCLASSES | DIGCF_PRESENT);
    if (devices == INVALID_HANDLE_VALUE) return result;
    for (DWORD index = 0;; ++index) {
        SP_DEVINFO_DATA device = { sizeof(device) };
        if (!SetupDiEnumDeviceInfo(devices, index, &device)) break;
        if (IsSerialFlowDevice(devices, &device))
            result.push_back({ GetInstanceId(devices, &device), GetDeviceString(devices, &device, L"PortName") });
    }
    SetupDiDestroyDeviceInfoList(devices);
    return result;
}

static int RemoveMatching(const wchar_t* first, const wchar_t* second) {
    DWORD removed = 0;
    for (const auto& device : EnumerateSerialFlowDevices()) {
        const bool removeAll = first == nullptr && second == nullptr;
        const bool matches = (first && _wcsicmp(device.portName.c_str(), first) == 0) ||
            (second && _wcsicmp(device.portName.c_str(), second) == 0);
        if (!removeAll && !matches) continue;
        if (!RemoveInstance(device.instanceId)) {
            PrintError(L"Remove endpoint");
            return 4;
        }
        ++removed;
    }
    std::wcout << L"{\"removed\":" << removed << L"}\n";
    return 0;
}

int wmain(int argc, wchar_t** argv) {
    if (argc == 5 && _wcsicmp(argv[1], L"create-pair") == 0)
        return CreatePair(argv[2], argv[3], argv[4]);
    if (argc == 2 && _wcsicmp(argv[1], L"remove-all") == 0)
        return RemoveMatching(nullptr, nullptr);
    if (argc == 4 && _wcsicmp(argv[1], L"remove-pair") == 0)
        return RemoveMatching(argv[2], argv[3]);
    std::wcerr << L"Usage: SerialFlowVirtualSerialManager create-pair <inf> <COM-A> <COM-B> | remove-pair <COM-A> <COM-B> | remove-all\n";
    return 64;
}
