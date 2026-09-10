"""Fetch the pinned, official Windows x64 esptool bundle and verify its release digest."""
import hashlib
import io
from pathlib import Path
import urllib.request
import zipfile

VERSION = '5.3.1'
URL = f'https://github.com/espressif/esptool/releases/download/v{VERSION}/esptool-v{VERSION}-windows-amd64.zip'
SHA256 = '2b4a73c45db27426685896f64ce3e557f63a64f43cc100cb65c0cc3486af96d3'
DESTINATION = Path(__file__).resolve().parents[1] / 'resources' / 'firmware' / 'esp32'

def main():
    with urllib.request.urlopen(URL, timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError('esptool release checksum mismatch')
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in ['esptool.exe', 'LICENSE', 'README.md']:
            (DESTINATION / name).write_bytes(archive.read('esptool-windows-amd64/' + name))
    print(f'Installed official esptool {VERSION}; SHA-256 verified.')

if __name__ == '__main__':
    main()
