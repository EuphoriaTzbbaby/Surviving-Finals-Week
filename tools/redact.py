#!/usr/bin/env python3
"""截图打码工具：把指定矩形区域涂成不透明色块，覆盖隐私信息后再留证。

用法:
  python3 redact.py 输入.png 输出.png x,y,w,h [x,y,w,h ...]
坐标用逻辑像素（和 screencapture -R 一致），脚本按图片实际分辨率自动换算。
"""
import sys
from PIL import Image, ImageDraw

LOGICAL_WIDTH = 1470  # 本机主屏逻辑宽度，2940 物理像素 @2x


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 1
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert('RGB')
    scale = im.width / LOGICAL_WIDTH
    d = ImageDraw.Draw(im)
    for spec in sys.argv[3:]:
        x, y, w, h = (float(v) for v in spec.split(','))
        box = [round(x * scale), round(y * scale),
               round((x + w) * scale), round((y + h) * scale)]
        d.rectangle(box, fill=(28, 30, 44))
        d.rectangle(box, outline=(120, 126, 160), width=max(1, round(scale)))
    im.save(dst)
    print(f'{dst}  {im.width}x{im.height}  已打码 {len(sys.argv) - 3} 处')
    return 0


if __name__ == '__main__':
    sys.exit(main())