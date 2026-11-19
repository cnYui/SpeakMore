"""从母版（`source/`，由 extract_source.py 从生图原图提取）生成所有图标。

用法（需要 Pillow、numpy）：
    python packaging/icons/generate_icons.py

输出：
  packaging/icons/
    icon.png            1024 铺满底板（四角透明）
    icon-mac.png        1024 画布 + 824 底板居中，苹果图标网格的留白（electron-builder 转 icns）
    icon.ico            Windows 图标，16~256 多尺寸（≤32 用三根竖条的简化版）
    icon-dark.png       深色版：深色底板 + 白色竖条，保留蓝色那根
    glyph-black.png     只有图形、黑色、透明背景（文档 / 网页用）
    glyph-white.png     只有图形、白色、透明背景
    menubar-template.png / menubar-template@2x.png   macOS 菜单栏模板图标（黑色 + 透明，系统会自动着色）
    layers/             分层的彩色图形（黑条层 / 蓝条层），用于在 Icon Composer 里做 macOS 26 的分层图标
  electron-app/assets/
    app-icon.png        窗口图标 256
    tray-icon.png       托盘图标 32（简化版）
    tray-iconTemplate.png / tray-iconTemplate@2x.png   macOS 托盘模板图标
  macos-app/SpeakMore/Resources/Assets.xcassets/
    AppIcon.appiconset  macOS 应用图标 16~512 @1x/@2x
    MenuBarGlyph.imageset  菜单栏模板图标
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ICON_DIR = ROOT / "packaging" / "icons"
SOURCE = ICON_DIR / "source"
ASSET_DIR = ROOT / "electron-app" / "assets"
XCASSETS = ROOT / "macos-app" / "SpeakMore" / "Resources" / "Assets.xcassets"

SS = 4  # 小尺寸重绘用的超采样倍数
SQUIRCLE_N = 5.68  # 从原图拟合出的底板形状指数（extract_source.py 的输出）
MAC_TILE_RATIO = 824 / 1024  # 苹果图标网格：1024 画布里底板占 824
DARK_TILE = (28, 28, 30)
LIGHT_BAR = (245, 245, 247)


def load_masters() -> dict:
    colors = json.loads((SOURCE / "colors.json").read_text(encoding="utf-8"))
    geometry = json.loads((SOURCE / "geometry.json").read_text(encoding="utf-8"))["bars"]
    return {
        "tile": Image.open(SOURCE / "tile-1024.png").convert("RGBA"),
        "black_mask": np.asarray(Image.open(SOURCE / "bars-black.png").convert("RGBA"))[..., 3] / 255.0,
        "blue_mask": np.asarray(Image.open(SOURCE / "bars-blue.png").convert("RGBA"))[..., 3] / 255.0,
        "colors": {key: tuple(value) for key, value in colors.items()},
        "geometry": geometry,
    }


M = load_masters()


def squircle_mask(size: int) -> np.ndarray:
    scale = SS
    ys, xs = np.mgrid[0:size * scale, 0:size * scale]
    x = ((xs + 0.5) / scale / size - 0.5) * 2
    y = ((ys + 0.5) / scale / size - 0.5) * 2
    inside = np.abs(x) ** SQUIRCLE_N + np.abs(y) ** SQUIRCLE_N <= 1.0
    return inside.reshape(size, scale, size, scale).mean(axis=(1, 3))


def draw_bars(size: int, bars: list[dict], colors: list[tuple[int, int, int]], box: tuple[float, float, float, float]) -> np.ndarray:
    """在 size×size 的 RGBA 画布上画圆角竖条。bars 的坐标是 0~1（相对底板），box 是把它们映射到画布的区域。"""
    from PIL import ImageDraw

    layer = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bx, by, bw, bh = box
    for bar, color in zip(bars, colors):
        x0 = (bx + bar["x"] * bw) * size * SS
        x1 = (bx + (bar["x"] + bar["width"]) * bw) * size * SS
        y0 = (by + bar["y"] * bh) * size * SS
        y1 = (by + (bar["y"] + bar["height"]) * bh) * size * SS
        draw.rounded_rectangle((x0, y0, x1, y1), radius=(x1 - x0) / 2, fill=(*color, 255))
    return np.asarray(layer.resize((size, size), Image.LANCZOS)).astype(np.float64)


def composite(base_rgb: tuple[int, int, int], layer: np.ndarray, mask: np.ndarray) -> Image.Image:
    alpha = layer[..., 3:4] / 255.0
    rgb = np.array(base_rgb, dtype=np.float64) * (1 - alpha) + layer[..., :3] * alpha
    return Image.fromarray(np.dstack([rgb, mask * 255.0]).astype(np.uint8), "RGBA")


def simple_bars() -> tuple[list[dict], list[tuple[int, int, int]]]:
    """小尺寸用的三根竖条：左边较矮的黑条、中间最高的黑条、右边的蓝条，比例取自原图并加粗。"""
    geometry = M["geometry"]
    left, center, blue = geometry[1], geometry[2], geometry[4]
    centre_x = 0.5 + (blue["x"] + blue["width"] / 2 - 0.5) * 0.0  # 三根整体水平居中
    width = 0.13
    gap = 0.075
    total = 3 * width + 2 * gap
    x0 = 0.5 - total / 2 + 0.01 * (centre_x - 0.5)
    shapes = []
    for index, source in enumerate((left, center, blue)):
        height = source["height"] * 1.12
        shapes.append({"x": x0 + index * (width + gap), "width": width, "y": 0.5 - height / 2, "height": height})
    colors = [M["colors"]["black"], M["colors"]["black"], M["colors"]["blue"]]
    return shapes, colors


def render_tile(size: int) -> Image.Image:
    """底板图标：≥48 px 用提取出的原图缩小，更小的尺寸用重绘的简化版。"""
    if size >= 48:
        return M["tile"].resize((size, size), Image.LANCZOS)
    shapes, colors = simple_bars()
    layer = draw_bars(size, shapes, colors, (0, 0, 1, 1))
    return composite(M["colors"]["tile"], layer, squircle_mask(size))


def tile_on_mac_canvas(size: int, tile_image: Image.Image | None = None) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = round(size * MAC_TILE_RATIO)
    tile = (tile_image or M["tile"]).resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(tile, ((size - inner) // 2, (size - inner) // 2))
    return canvas


def dark_tile(size: int = 1024) -> Image.Image:
    mask = np.asarray(M["tile"].resize((size, size), Image.LANCZOS))[..., 3] / 255.0
    black = np.asarray(Image.fromarray((M["black_mask"] * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)) / 255.0
    blue = np.asarray(Image.fromarray((M["blue_mask"] * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)) / 255.0
    rgb = np.tile(np.array(DARK_TILE, dtype=np.float64), (size, size, 1))
    rgb = rgb * (1 - black[..., None]) + np.array(LIGHT_BAR, dtype=np.float64) * black[..., None]
    rgb = rgb * (1 - blue[..., None]) + np.array(M["colors"]["blue"], dtype=np.float64) * blue[..., None]
    return Image.fromarray(np.dstack([rgb, mask * 255.0]).astype(np.uint8), "RGBA")


def glyph(color: tuple[int, int, int], size: int = 1024) -> Image.Image:
    alpha = np.maximum(M["black_mask"], M["blue_mask"])
    alpha_image = Image.fromarray((alpha * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    layer = Image.new("RGBA", (size, size), (*color, 0))
    layer.putalpha(alpha_image)
    return layer


def colored_layer(mask: np.ndarray, color: tuple[int, int, int]) -> Image.Image:
    alpha_image = Image.fromarray((mask * 255).astype(np.uint8))
    layer = Image.new("RGBA", alpha_image.size, (*color, 0))
    layer.putalpha(alpha_image)
    return layer


def menubar_template(width: int, height: int) -> Image.Image:
    """菜单栏模板图标：五根竖条，纯黑 + 透明（系统按菜单栏明暗自动着色）。"""
    bars = M["geometry"]
    min_x = min(bar["x"] for bar in bars)
    max_x = max(bar["x"] + bar["width"] for bar in bars)
    min_y = min(bar["y"] for bar in bars)
    max_y = max(bar["y"] + bar["height"] for bar in bars)
    span_x, span_y = max_x - min_x, max_y - min_y
    pad = 1 if height >= 24 else 0.5
    scale = min((width - 2 * pad) / span_x, (height - 2 * pad) / span_y)
    # 先在大画布上按比例画，再缩到目标尺寸，保证边缘平滑
    big = 16
    canvas_w, canvas_h = width * big, height * big
    from PIL import ImageDraw

    layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    offset_x = (width - span_x * scale) / 2
    offset_y = (height - span_y * scale) / 2
    for bar in bars:
        x0 = (offset_x + (bar["x"] - min_x) * scale) * big
        x1 = (offset_x + (bar["x"] + bar["width"] - min_x) * scale) * big
        y0 = (offset_y + (bar["y"] - min_y) * scale) * big
        y1 = (offset_y + (bar["y"] + bar["height"] - min_y) * scale) * big
        draw.rounded_rectangle((x0, y0, x1, y1), radius=(x1 - x0) / 2, fill=(0, 0, 0, 255))
    return layer.resize((width, height), Image.LANCZOS)


def write_appiconset(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    images = []
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            pixels = size * scale
            name = f"icon_{size}x{size}@{scale}x.png"
            tile_on_mac_canvas(pixels, render_tile(round(pixels * MAC_TILE_RATIO))).save(destination / name, optimize=True)
            images.append({"filename": name, "idiom": "mac", "scale": f"{scale}x", "size": f"{size}x{size}"})
    (destination / "Contents.json").write_text(
        json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n", encoding="utf-8"
    )


def write_menubar_imageset(destination: Path, template_1x: Image.Image, template_2x: Image.Image) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    template_1x.save(destination / "menubar@1x.png", optimize=True)
    template_2x.save(destination / "menubar@2x.png", optimize=True)
    (destination / "Contents.json").write_text(json.dumps({
        "images": [
            {"filename": "menubar@1x.png", "idiom": "universal", "scale": "1x"},
            {"filename": "menubar@2x.png", "idiom": "universal", "scale": "2x"},
        ],
        "info": {"author": "xcode", "version": 1},
        "properties": {"template-rendering-intent": "template"},
    }, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    (ICON_DIR / "layers").mkdir(parents=True, exist_ok=True)

    # 主图标
    M["tile"].save(ICON_DIR / "icon.png", optimize=True)
    tile_on_mac_canvas(1024).save(ICON_DIR / "icon-mac.png", optimize=True)
    dark_tile().save(ICON_DIR / "icon-dark.png", optimize=True)
    glyph((0, 0, 0)).save(ICON_DIR / "glyph-black.png", optimize=True)
    glyph((255, 255, 255)).save(ICON_DIR / "glyph-white.png", optimize=True)
    colored_layer(M["black_mask"], M["colors"]["black"]).save(ICON_DIR / "layers" / "bars-black.png", optimize=True)
    colored_layer(M["blue_mask"], M["colors"]["blue"]).save(ICON_DIR / "layers" / "bars-blue.png", optimize=True)

    # Windows ICO
    sizes = (256, 128, 64, 48, 40, 32, 24, 20, 16)
    frames = [render_tile(size) for size in sizes]
    frames[0].save(ICON_DIR / "icon.ico", sizes=[(size, size) for size in sizes], append_images=frames[1:])

    # Electron：窗口、托盘（Windows 用彩色底板，macOS 用模板）
    render_tile(256).save(ASSET_DIR / "app-icon.png", optimize=True)
    render_tile(32).save(ASSET_DIR / "tray-icon.png", optimize=True)
    template_1x, template_2x = menubar_template(20, 14), menubar_template(40, 28)
    template_1x.save(ICON_DIR / "menubar-template.png", optimize=True)
    template_2x.save(ICON_DIR / "menubar-template@2x.png", optimize=True)
    template_1x.save(ASSET_DIR / "tray-iconTemplate.png", optimize=True)
    template_2x.save(ASSET_DIR / "tray-iconTemplate@2x.png", optimize=True)

    # 原生 macOS 应用
    write_appiconset(XCASSETS / "AppIcon.appiconset")
    write_menubar_imageset(XCASSETS / "MenuBarGlyph.imageset", template_1x, template_2x)
    print("icons written")


if __name__ == "__main__":
    main()
