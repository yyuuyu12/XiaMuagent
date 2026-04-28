#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
快速预览：直接生成 ASS 文件，不需要视频
用法: python preview_ass.py
生成 preview.ass 后用 PotPlayer / VLC 挂载查看效果
"""
import sys
sys.path.insert(0, ".")
from subtitle_burner import make_ass

# 测试字幕（模拟抖音风格）
TEST_SUBS = [
    {"start": "0:00:00.00", "end": "0:00:02.50", "text": "能够好好过日子的人"},
    {"start": "0:00:02.50", "end": "0:00:05.00", "text": "我们需要学会感恩生活"},
    {"start": "0:00:05.00", "end": "0:00:07.50", "text": "坚持努力才能实现梦想"},
    {"start": "0:00:07.50", "end": "0:00:10.00", "text": "珍惜身边每一个人"},
    {"start": "0:00:10.00", "end": "0:00:13.00", "text": "这个世界需要更多温暖"},
]

# 竖屏 1080×1920
W, H = 1080, 1920
ass = make_ass(TEST_SUBS, W, H)

out = "preview.ass"
with open(out, "w", encoding="utf-8") as f:
    f.write(ass)

print(f"✓ ASS 文件已生成: {out}")
print("  → 用 PotPlayer 打开任意视频，字幕 → 加载字幕文件，选择 preview.ass 预览效果")
print("\n--- ASS 前50行 ---")
for i, line in enumerate(ass.splitlines()[:50]):
    print(line)
