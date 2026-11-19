# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all
from pathlib import Path


ROOT = Path(SPECPATH).resolve().parents[1]
datas = []
binaries = []
hiddenimports = []

for package_name in [
    "funasr",
    "modelscope",
    "transformers",
    "torch",
    "torchaudio",
    "kaldiio",
    "omegaconf",
    "hydra",
    "sherpa_onnx",
]:
    package_datas, package_binaries, package_hiddenimports = collect_all(package_name)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

datas += [
    (str(ROOT / "server" / "index.html"), "."),
    (str(ROOT / "shared" / "translation-target-languages.json"), "shared"),
    (str(ROOT / "shared" / "asr-models.json"), "shared"),
]

# 运行时用不到的编译期文件：C/C++ 头文件、静态/导入库、CMake 配置。
# torch 的 collect_all 会把它们全部带上（约 90 MB），推理不需要。
BUILD_ONLY_SUFFIXES = (".h", ".hpp", ".cuh", ".lib", ".a", ".cmake")
BUILD_ONLY_DIRS = ("torch/include/", "torch/share/")


def is_runtime_file(dest_name):
    normalized = dest_name.replace("\\", "/")
    if normalized.lower().endswith(BUILD_ONLY_SUFFIXES):
        return False
    return not any(normalized.startswith(prefix) for prefix in BUILD_ONLY_DIRS)

a = Analysis(
    [str(ROOT / "server" / "main.py")],
    pathex=[str(ROOT), str(ROOT / "server")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
a.datas = [entry for entry in a.datas if is_runtime_file(entry[0])]
a.binaries = [entry for entry in a.binaries if is_runtime_file(entry[0])]

pyz = PYZ(a.pure)
# onedir：不再每次启动把约 900 MB 依赖解压到临时目录（onefile 冷启动约 20 秒，
# 且后端被强制结束时临时目录不会清理）。产物为 <distpath>/backend/speakmore-backend[.exe] + _internal/。
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="speakmore-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="backend",
)
