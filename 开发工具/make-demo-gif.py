#!/usr/bin/env python3
# 把界面截图拼成一个演示 GIF（README 顶部用）
# 用法：python make_demo_gif.py

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '截图')
OUT = os.path.join(SRC, '演示.gif')
W = 1000
BAR = 52
DUR = 2200

ITEMS = [
    ('界面-开局.png', '单挑开局：位置、要跟多少、所需胜率、起手牌参考'),
    ('界面-6人桌.png', '6 人桌：AI 会冒行动气泡，还能切 9 人桌'),
    ('界面-规则-怎么玩.png', '新手教学：从发牌一路讲到比牌'),
    ('界面-规则-牌型.png', '十种牌型，从大到小，每种配一副真实牌面'),
    ('界面-结算.png', '每手结束的复盘讲评：每个决定都标好坏'),
    ('界面-牌谱回放.png', '牌谱逐步回放，能跳到任意一个动作'),
    ('界面-统计.png', 'VPIP / PFR / 盈亏曲线 / 按位置统计'),
]

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def main():
    font = load_font(20)
    frames = []
    for fn, cap in ITEMS:
        path = os.path.join(SRC, fn)
        if not os.path.exists(path):
            print('跳过（不存在）：' + fn)
            continue
        im = Image.open(path).convert('RGB')
        h = int(im.height * W / im.width)
        im = im.resize((W, h), Image.LANCZOS)
        canvas = Image.new('RGB', (W, h + BAR), (18, 24, 21))
        canvas.paste(im, (0, 0))
        d = ImageDraw.Draw(canvas)
        d.text((18, h + (BAR - 20) // 2 - 2), cap, fill=(255, 212, 121), font=font)
        frames.append(canvas)

    if not frames:
        raise SystemExit('没有可用截图')

    # 统一成同一尺寸（以最小高度为准，裁掉多余底部）
    min_h = min(f.height for f in frames)
    frames = [f.crop((0, 0, W, min_h)) for f in frames]

    # 量化到 128 色，压体积
    frames = [f.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
              for f in frames]

    frames[0].save(
        OUT, save_all=True, append_images=frames[1:],
        duration=DUR, loop=0, optimize=True, disposal=2
    )
    size = os.path.getsize(OUT)
    print(f'已生成 {OUT}（{len(frames)} 帧，{size / 1024:.0f} KB）')


if __name__ == '__main__':
    main()
