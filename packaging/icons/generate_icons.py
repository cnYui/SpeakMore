"""生成 SpeakMore 应用图标。

设计：深色圆角方块上放一个蓝色渐变对话气泡（Speak），气泡里是一组
从左到右逐渐升高的白色声波条（More：声音越说越多）。16~32 px 的小尺寸
改用 3 根更粗的声波条，保证托盘和任务栏里仍然看得清。

用法（需要 Pillow）：
    python packaging/icons/generate_icons.py

输出：
    packaging/icons/icon.ico          Windows exe 图标（16~256 多尺寸）
    packaging/icons/icon-mac.png      macOS 图标源（1024，四周 10% 留白，electron-builder 转 icns）
    packaging/icons/icon.png          1024 满版，用于 README 或发布页
    electron-app/assets/app-icon.png  窗口图标（256）
    electron-app/assets/tray-icon.png 托盘图标（32，3 根声波条简化版）
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
ICON_DIR = ROOT / "packaging" / "icons"
ASSET_DIR = ROOT / "electron-app" / "assets"

SS = 4  # 超采样倍数：先画大图再缩小，边缘更平滑
TILE_TOP = (44, 44, 50)
TILE_BOTTOM = (16, 16, 19)
BUBBLE_TOP = (56, 189, 248)
BUBBLE_BOTTOM = (99, 102, 241)
FULL_BARS = (0.3, 0.5, 0.72, 1.0, 0.6)
SIMPLE_BARS = (0.42, 0.72, 1.0)


def lerp(a: tuple[int, ...], b: tuple[int, ...], t: float) -> tuple[int, ...]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def vertical_gradient(size: int, top: tuple[int, ...], bottom: tuple[int, ...]) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        draw.line([(0, y), (size, y)], fill=lerp(top, bottom, y / max(1, size - 1)) + (255,))
    return img


def draw_icon(px: int, inset: float = 0.0, simple: bool = False) -> Image.Image:
    """inset：四周留白比例（macOS 用 0.1）；simple：小尺寸的 3 根粗声波条版本。"""
    s = px * SS
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    o = s * inset
    w = s - 2 * o

    def x(f: float) -> float:
        return o + w * f

    # 背景圆角方块
    tile_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(tile_mask).rounded_rectangle((o, o, s - o, s - o), radius=w * 0.225, fill=255)
    canvas.paste(vertical_gradient(s, TILE_TOP, TILE_BOTTOM), (0, 0), tile_mask)

    # 对话气泡：圆角矩形 + 左下角尾巴
    bx0, by0, bx1, by1 = x(0.18), x(0.2), x(0.82), x(0.7)
    bubble_mask = Image.new("L", (s, s), 0)
    bd = ImageDraw.Draw(bubble_mask)
    bd.rounded_rectangle((bx0, by0, bx1, by1), radius=(by1 - by0) * 0.42, fill=255)
    bd.polygon([(x(0.27), x(0.6)), (x(0.46), x(0.68)), (x(0.25), x(0.82))], fill=255)

    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    shadow.putalpha(bubble_mask.filter(ImageFilter.GaussianBlur(w * 0.025)).point(lambda a: a * 0.5))
    canvas.alpha_composite(shadow, (0, round(w * 0.015)))
    canvas.paste(vertical_gradient(s, BUBBLE_TOP, BUBBLE_BOTTOM), (0, 0), bubble_mask)

    # 声波条：整体居中在气泡主体里，从左到右逐渐升高
    heights = SIMPLE_BARS if simple else FULL_BARS
    bar_w = w * (0.095 if simple else 0.064)
    gap = w * (0.07 if simple else 0.045)
    total = len(heights) * bar_w + (len(heights) - 1) * gap
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    max_h = (by1 - by0) * (0.7 if simple else 0.66)
    bars = ImageDraw.Draw(canvas)
    for i, h in enumerate(heights):
        left = cx - total / 2 + i * (bar_w + gap)
        half = max_h * h / 2
        bars.rounded_rectangle((left, cy - half, left + bar_w, cy + half), radius=bar_w / 2, fill=(255, 255, 255, 255))

    return canvas.resize((px, px), Image.LANCZOS)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    draw_icon(1024).save(ICON_DIR / "icon.png", optimize=True)
    draw_icon(1024, inset=0.1).save(ICON_DIR / "icon-mac.png", optimize=True)
    draw_icon(256).save(ASSET_DIR / "app-icon.png", optimize=True)
    draw_icon(32, simple=True).save(ASSET_DIR / "tray-icon.png", optimize=True)

    sizes = (256, 128, 64, 48, 40, 32, 24, 20, 16)
    frames = [draw_icon(size, simple=size <= 32) for size in sizes]
    frames[0].save(ICON_DIR / "icon.ico", sizes=[(size, size) for size in sizes], append_images=frames[1:])
    print("icons written to", ICON_DIR, "and", ASSET_DIR)


if __name__ == "__main__":
    main()
