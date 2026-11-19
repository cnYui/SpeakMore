"""从生图得到的原图里“去背景”，提取出图标本体，生成后续所有尺寸 / 变体的母版。

原图（`source/original-generated.webp`）是一块白色圆角方块放在近乎同色的白色画布上，外面带一圈生图自带的阴影。
底板和画布几乎同色（254 对 254），所以不能靠颜色抠图，做法是：

1. 从图中心向外沿射线找“进入阴影”的位置，得到底板外缘上的一圈点（上缘阴影几乎为零，找不到的射线直接略过）；
2. 用这些点鲁棒地拟合一个超椭圆（苹果图标那种圆角方块）：`|x/a|^n + |y/b|^n = 1`；
3. 用拟合出的形状生成抗锯齿遮罩，阴影和画布全部去掉；
4. 把图形拆成“黑色竖条”和“蓝色竖条”两层透明度遮罩，之后可以按任意颜色重新合成（深色版、单色菜单栏图标等）。

输出（`source/`，已提交）：
- `tile-1024.png`    只含底板和图形，四角透明，铺满 1024×1024
- `bars-black.png`   四根黑色竖条的透明度遮罩（白色 = 不透明），1024×1024，位置和底板对齐
- `bars-blue.png`    蓝色竖条的透明度遮罩，同上
- `geometry.json`    每根竖条的位置和尺寸（相对底板，0~1），小尺寸图标按它重绘
- `colors.json`      底板、黑条、蓝条的颜色，重新合成深色版 / 单色版时用

用法：python packaging/icons/extract_source.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.optimize import least_squares
from scipy.ndimage import label

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "source"
ORIGINAL = SOURCE / "original-generated.webp"
SIZE = 1024
SUPERSAMPLE = 4


def trace_edge_points(luma: np.ndarray) -> np.ndarray:
    """沿射线找底板外缘（进入阴影的位置），返回 (x, y) 点列。"""
    h, w = luma.shape
    cx, cy = w / 2, h / 2
    points = []
    for angle in np.deg2rad(np.arange(0, 360, 0.5)):
        cos, sin = np.cos(angle), np.sin(angle)
        for radius in np.arange(420, 660, 0.5):  # 图形在半径 ~330 以内，从 420 开始找
            x, y = cx + radius * cos, cy + radius * sin
            x2, y2 = cx + (radius + 1) * cos, cy + (radius + 1) * sin
            if not (0 <= x2 < w - 1 and 0 <= y2 < h - 1):
                break
            # 连续两个采样点都明显偏暗才算进入阴影，躲开零星噪点
            if luma[int(round(y)), int(round(x))] < 251.5 and luma[int(round(y2)), int(round(x2))] < 251.5:
                points.append((x, y))
                break
    return np.array(points)


def superellipse_residual(params: np.ndarray, points: np.ndarray) -> np.ndarray:
    cx, cy, a, b, n = params
    value = (np.abs(points[:, 0] - cx) / a) ** n + (np.abs(points[:, 1] - cy) / b) ** n
    # 用“归一化半径误差”做残差，单位约等于像素
    return (value ** (1 / n) - 1) * (a + b) / 2


def fit_superellipse(points: np.ndarray) -> np.ndarray:
    initial = np.array([points[:, 0].mean(), points[:, 1].mean(), 527.0, 527.0, 5.0])
    result = least_squares(
        superellipse_residual,
        initial,
        args=(points,),
        loss="soft_l1",
        f_scale=2.0,  # 对噪点、阴影误检的离群点不敏感
        bounds=([0, 0, 300, 300, 2.0], [2000, 2000, 900, 900, 12.0]),
    )
    return result.x


def render_mask(params: np.ndarray, shape: tuple[int, int], scale: int = SUPERSAMPLE) -> np.ndarray:
    """按拟合出的超椭圆生成抗锯齿遮罩（0~1）。"""
    cx, cy, a, b, n = params
    h, w = shape
    ys, xs = np.mgrid[0:h * scale, 0:w * scale]
    x = (xs + 0.5) / scale
    y = (ys + 0.5) / scale
    inside = (np.abs(x - cx) / a) ** n + (np.abs(y - cy) / b) ** n <= 1.0
    return inside.reshape(h, scale, w, scale).mean(axis=(1, 3))


def main() -> None:
    SOURCE.mkdir(exist_ok=True)
    rgb = np.asarray(Image.open(ORIGINAL).convert("RGB")).astype(np.float64)
    luma = rgb.mean(axis=2)
    h, w = luma.shape

    points = trace_edge_points(luma)
    cx, cy, a, b, n = fit_superellipse(points)
    residual = superellipse_residual(np.array([cx, cy, a, b, n]), points)
    inliers = np.abs(residual) < 3
    print(f"拟合：中心 ({cx:.1f}, {cy:.1f})，半宽 {a:.1f} / 半高 {b:.1f}，指数 n={n:.2f}")
    print(f"边缘点 {len(points)} 个，其中 {inliers.sum()} 个落在 3 px 以内，残差均值 {np.abs(residual[inliers]).mean():.2f} px")

    params = np.array([cx, cy, a, b, n])
    # 外缘处的像素混着阴影，遮罩向内收 1.2 px，保证边缘全是底板自己的白色
    shrunk = params.copy()
    shrunk[2] -= 1.2
    shrunk[3] -= 1.2
    mask = render_mask(shrunk, (h, w))

    # 裁成以底板为中心的正方形，再缩放到 1024
    half = max(a, b)
    left, top = int(round(cx - half)), int(round(cy - half))
    side = int(round(half * 2))
    box = (left, top, left + side, top + side)

    # ---- 图形拆层：黑条 / 蓝条的透明度遮罩 ----
    ink = np.clip((254.0 - luma) / 248.0, 0, 1) * (mask > 0.5)        # 深色区域，约等于图形的不透明度
    bluish = (rgb[..., 2] - rgb[..., 0]) > 60                           # 蓝条：蓝通道明显高于红通道
    blue_alpha = np.clip((254.0 - rgb[..., 0]) / (254.0 - 26.0), 0, 1) * (mask > 0.5)

    labels, count = label(ink > 0.15)
    components = []
    for index in range(1, count + 1):
        ys, xs = np.where(labels == index)
        if len(xs) < 500:  # 噪点
            continue
        components.append((index, xs.min(), xs.max(), ys.min(), ys.max(), bluish[labels == index].mean()))
    components.sort(key=lambda item: item[1])
    print("图形连通域：", [(c[1], c[2], round(c[5], 2)) for c in components])
    assert len(components) == 5, f"应该有 5 根竖条，实际 {len(components)}"

    black = np.zeros((h, w))
    blue = np.zeros((h, w))
    geometry = []
    for index, x0, x1, y0, y1, blue_ratio in components:
        pad = 6
        region = np.zeros((h, w), dtype=bool)
        region[max(0, y0 - pad):y1 + pad + 1, max(0, x0 - pad):x1 + pad + 1] = True
        is_blue = blue_ratio > 0.5
        (blue if is_blue else black)[region] = (blue_alpha if is_blue else ink)[region]
        geometry.append({
            "x": round(float((x0 - left) / side), 5),
            "y": round(float((y0 - top) / side), 5),
            "width": round(float((x1 - x0 + 1) / side), 5),
            "height": round(float((y1 - y0 + 1) / side), 5),
            "blue": bool(is_blue),
        })

    # ---- 重建底板：白底 + 黑条层 + 蓝条层 ----
    # 直接裁原图的话，底板边缘会带进阴影最内侧的一圈灰；底板本来就是纯白，所以用抠出来的两层重新合成。
    base = np.array([254.0, 254.0, 254.0])
    black_color = np.median(rgb[(ink > 0.97) & ~bluish], axis=0)
    blue_color = np.median(rgb[(blue_alpha > 0.97) & bluish], axis=0)
    print("底板色", base, "黑条色", black_color, "蓝条色", blue_color)
    canvas = np.tile(base, (h, w, 1))
    canvas = canvas * (1 - black[..., None]) + black_color * black[..., None]
    canvas = canvas * (1 - blue[..., None]) + blue_color * blue[..., None]
    tile_rgba = np.dstack([canvas, mask * 255.0]).astype(np.uint8)
    tile = Image.fromarray(tile_rgba, "RGBA").crop(box).resize((SIZE, SIZE), Image.LANCZOS)
    tile.save(SOURCE / "tile-1024.png", optimize=True)
    (SOURCE / "colors.json").write_text(json.dumps({
        "tile": [int(v) for v in base],
        "black": [int(round(v)) for v in black_color],
        "blue": [int(round(v)) for v in blue_color],
    }, indent=2) + "\n", encoding="utf-8")

    def to_layer(alpha: np.ndarray, name: str) -> None:
        layer = np.dstack([np.full((h, w, 3), 255.0), alpha * 255.0]).astype(np.uint8)
        Image.fromarray(layer, "RGBA").crop(box).resize((SIZE, SIZE), Image.LANCZOS).save(SOURCE / name, optimize=True)

    to_layer(black, "bars-black.png")
    to_layer(blue, "bars-blue.png")
    (SOURCE / "geometry.json").write_text(json.dumps({"bars": geometry}, indent=2) + "\n", encoding="utf-8")
    print("输出：", ", ".join(sorted(p.name for p in SOURCE.iterdir())))


if __name__ == "__main__":
    main()
