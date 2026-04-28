#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
字幕烧录工具 - 短视频双层字幕风格（仿抖音/TikTok）
======================================================
参考样式：
  上层副标题 白色小字（首个短语）       ← 首个短语/功能词
             白色更小英文              ← 对应翻译
  下层主标题 金色大字（主体文字）        ← 主体句子，关键词高亮
             金色中等英文              ← 对应翻译

用法:
    python subtitle_burner.py input.mp4 subtitles.srt output.mp4
    python subtitle_burner.py input.mp4 subtitles.srt output.mp4 --no-translate

依赖安装:
    pip install jieba deep-translator
"""

import os
import sys
import re
import subprocess
import argparse
from pathlib import Path

# ─── 可选依赖 ────────────────────────────────────────────────────────────────
try:
    import jieba
    import jieba.posseg as pseg
    jieba.setLogLevel("WARN")
    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False
    print("[提示] 未安装 jieba，分词将使用简单切字模式。运行: pip install jieba")

try:
    from deep_translator import GoogleTranslator
    _gtrans = GoogleTranslator(source="auto", target="en")
    HAS_TRANS = True
except ImportError:
    HAS_TRANS = False
    print("[提示] 未安装 deep-translator，将跳过翻译。运行: pip install deep-translator")

# ─── ASS 颜色常量 (&HAABBGGRR，AA=00 为不透明) ───────────────────────────────
C_WHITE  = "&H00FFFFFF"   # 白色
C_GOLD   = "&H0000D7FF"   # 金黄 #FFD700
C_ORANGE = "&H00356BFF"   # 橙红 #FF6B35（关键词高亮）
C_BLACK  = "&H00000000"   # 黑色描边
C_TRANS  = "&HFF000000"   # 透明背景

# ─── SRT 解析 ────────────────────────────────────────────────────────────────

def parse_srt(path: str) -> list:
    """解析 SRT 文件 → [{start, end, text}, ...]"""
    content = Path(path).read_text(encoding="utf-8-sig", errors="replace")
    entries = []
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = [ln.strip() for ln in block.strip().splitlines() if ln.strip()]
        if len(lines) < 3:
            continue
        m = re.match(
            r"(\d+:\d+:\d+[,\.]\d+)\s*-->\s*(\d+:\d+:\d+[,\.]\d+)", lines[1]
        )
        if not m:
            continue
        entries.append(
            {
                "start": _srt2ass(m.group(1)),
                "end":   _srt2ass(m.group(2)),
                "text":  " ".join(lines[2:]).strip(),
            }
        )
    return entries


def _srt2ass(t: str) -> str:
    """00:01:23,456  →  0:01:23.45"""
    t = t.replace(",", ".")
    h, m, rest = t.split(":", 2)
    s = float(rest)
    cs = int(round((s % 1) * 100))
    return f"{int(h)}:{int(m):02d}:{int(s):02d}.{cs:02d}"


# ─── 翻译 ────────────────────────────────────────────────────────────────────

_trans_cache: dict = {}


def translate(text: str) -> str:
    if not text or not HAS_TRANS:
        return ""
    key = text.strip()
    if key in _trans_cache:
        return _trans_cache[key]
    try:
        result = _gtrans.translate(key) or ""
        _trans_cache[key] = result
        return result
    except Exception as e:
        _trans_cache[key] = ""
        return ""


# ─── 文本分割 ────────────────────────────────────────────────────────────────

def split_subtitle(text: str) -> tuple:
    """
    把中文字幕拆成 (副标题短语, 主体文字)
    策略：用 jieba 取首词；若首词 2~4 字且不超整句 50%，作副标题
    """
    text = text.strip()
    if len(text) <= 3:
        return ("", text)

    if HAS_JIEBA:
        words = list(jieba.cut(text))
        first = words[0] if words else ""
        # 首词 2~4 字 → 副标题
        if 2 <= len(first) <= 4 and len(first) <= len(text) * 0.5:
            return (first, text[len(first):])
        # 首词太短（1字），取前两词
        if len(first) == 1 and len(words) >= 2:
            two = first + words[1]
            if len(two) <= 5:
                return (two, text[len(two):])

    # fallback：按字数切前 2~3 字
    cut = 3 if len(text) >= 8 else 2
    return (text[:cut], text[cut:])


# ─── 关键词提取 ──────────────────────────────────────────────────────────────

def get_keywords(text: str) -> list:
    """jieba 词性标注，提取名词/动词关键词（最多 2 个，≥2 字）"""
    if not HAS_JIEBA or not text:
        return []
    kws = []
    for word, flag in pseg.cut(text):
        if len(word) >= 2 and (flag.startswith("n") or flag.startswith("v")):
            kws.append(word)
        if len(kws) >= 2:
            break
    return kws


# ─── 换行 ────────────────────────────────────────────────────────────────────

def wrap_cn(text: str, max_ch: int = 14) -> list:
    """中文按 jieba 词边界换行，最多 2 行"""
    if not text:
        return []
    if len(text) <= max_ch:
        return [text]
    words = list(jieba.cut(text)) if HAS_JIEBA else list(text)
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) <= max_ch:
            cur += w
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:2]


def wrap_en(text: str, max_ch: int = 28) -> list:
    """英文按单词边界换行，最多 2 行"""
    if not text:
        return []
    if len(text) <= max_ch:
        return [text]
    words = text.split()
    lines, cur = [], ""
    for w in words:
        need = (len(cur) + 1 + len(w)) if cur else len(w)
        if need <= max_ch:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:2]


# ─── 关键词高亮（ASS 内联颜色标签） ──────────────────────────────────────────

def highlight(text: str, keywords: list, base_color: str) -> str:
    """将关键词替换为橙色，其余恢复 base_color"""
    for kw in keywords:
        text = text.replace(
            kw,
            r"{\c" + C_ORANGE + r"}" + kw + r"{\c" + base_color + r"}",
        )
    return text


# ─── 视频信息 ────────────────────────────────────────────────────────────────

def get_video_size(video: str) -> tuple:
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=s=x:p=0",
                video,
            ],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        w, h = out.split("x")
        return int(w), int(h)
    except Exception:
        return 1080, 1920


# ─── ASS 生成 ────────────────────────────────────────────────────────────────

_ASS_HEADER = """\
[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: {W}
PlayResY: {H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,Microsoft YaHei,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,3,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Actor, Effect, Text
"""


def make_ass(subs: list, W: int, H: int) -> str:
    # ── 尺寸计算（基于视频宽度）────────────────────────────────────────────
    mg   = max(int(W * 0.040), 16)   # 左/底安全边距
    ms   = max(int(W * 0.065), 28)   # 主标题中文字号
    ss   = max(int(W * 0.035), 18)   # 副标题中文字号
    mes  = max(int(ms  * 0.70), 18)  # 主标题英文字号
    ses  = max(int(ss  * 0.70), 13)  # 副标题英文字号
    mb   = max(int(ms  * 0.08), 2)   # 主标题中文描边
    sb   = max(int(ss  * 0.08), 2)   # 副标题中文描边
    meb  = max(int(mes * 0.08), 2)   # 主标题英文描边
    seb  = max(int(ses * 0.08), 1)   # 副标题英文描边

    # 行高 = 字号 × 1.35（含行间距）
    mlh  = int(ms  * 1.35)
    slh  = int(ss  * 1.35)
    melh = int(mes * 1.35)
    selh = int(ses * 1.35)

    cn_en_gap   =  5   # 中文行与其英文行之间的间距（像素）
    block_gap   = 14   # 副标题块与主标题块之间的间距

    lines_out = [_ASS_HEADER.format(W=W, H=H)]

    for s in subs:
        st, en, raw = s["start"], s["end"], s["text"]

        # 1. 分割中文字幕
        sub_ph, main_body = split_subtitle(raw)
        kws = get_keywords(main_body or raw)

        # 2. 翻译
        main_en_str = translate(main_body or raw)
        sub_en_str  = translate(sub_ph) if sub_ph else ""

        # 3. 换行处理
        mcn = wrap_cn(main_body or raw)
        men = wrap_en(main_en_str)
        scn = wrap_cn(sub_ph)
        sen = wrap_en(sub_en_str)

        # 4. 计算 y 坐标（an7 = 左上角对齐，从底部往上排列）
        #    布局顺序（从上到下屏幕方向）：
        #      [sub CN] → [sub EN] → [main CN] → [main EN] → 底边距
        #
        y_men_bot   = H - mg
        y_men_top   = y_men_bot  - (len(men) or 1) * melh

        y_mcn_bot   = y_men_top  - cn_en_gap
        y_mcn_top   = y_mcn_bot  - (len(mcn) or 1) * mlh

        y_sen_bot   = y_mcn_top  - block_gap
        y_sen_top   = y_sen_bot  - (len(sen) or 1) * selh

        y_scn_bot   = y_sen_top  - cn_en_gap
        y_scn_top   = y_scn_bot  - (len(scn) or 1) * slh

        x = mg  # 左对齐 x

        # 5. 生成 ASS Dialogue 行（inline 样式标签）
        def dial(layer: int, y: int, color: str, font: str, size: int,
                  bord: int, text_lines: list) -> str:
            if not text_lines:
                return ""
            fn_tag  = f"\\fn{font}"
            pos_tag = f"\\an7\\pos({x},{y})"
            fmt_tag = f"\\c{color}\\fs{size}\\b1\\bord{bord}\\shad0"
            tags    = "{" + pos_tag + fn_tag + fmt_tag + "}"
            body    = r"\N".join(text_lines)
            return f"Dialogue: {layer},{st},{en},Base,,0,0,0,,{tags}{body}"

        # 主标题：金色大字（中文关键词高亮）
        hi_mcn = [highlight(ln, kws, C_GOLD) for ln in mcn]
        d = dial(0, y_mcn_top, C_GOLD,  "Microsoft YaHei", ms,  mb,  hi_mcn)
        if d: lines_out.append(d)

        # 主标题：金色英文
        d = dial(0, y_men_top, C_GOLD,  "Arial",           mes, meb, men)
        if d: lines_out.append(d)

        # 副标题：白色小字（有首个短语时才显示）
        if scn:
            d = dial(0, y_scn_top, C_WHITE, "Microsoft YaHei", ss,  sb,  scn)
            if d: lines_out.append(d)

            # 副标题：白色英文
            if sen:
                d = dial(0, y_sen_top, C_WHITE, "Arial",           ses, seb, sen)
                if d: lines_out.append(d)

    return "\n".join(lines_out) + "\n"


# ─── ffmpeg 烧录 ─────────────────────────────────────────────────────────────

def burn(video: str, ass: str, output: str) -> bool:
    """
    用 ffmpeg ass= filter 烧录字幕。
    Windows 路径含冒号/反斜杠会导致 ffmpeg 解析失败，
    改为 cwd=ass所在目录 + 相对路径规避。
    """
    ass_abs  = os.path.abspath(ass)
    ass_dir  = os.path.dirname(ass_abs)
    ass_name = os.path.basename(ass_abs)
    vid_abs  = os.path.abspath(video)
    out_abs  = os.path.abspath(output)

    cmd = [
        "ffmpeg", "-y",
        "-i", vid_abs,
        "-vf", f"ass={ass_name}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "copy",
        "-movflags", "+faststart",
        out_abs,
    ]
    print(f"[ffmpeg] 烧录字幕中，请稍候...")
    r = subprocess.run(
        cmd, cwd=ass_dir,
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if r.returncode != 0:
        print(f"[错误] ffmpeg 输出:\n{r.stderr[-800:]}")
        return False
    return True


# ─── 主入口 ──────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="短视频双层字幕烧录工具（抖音/TikTok 风格）"
    )
    ap.add_argument("video",  help="输入视频文件路径（.mp4）")
    ap.add_argument("srt",    help="SRT 字幕文件路径（.srt）")
    ap.add_argument("output", help="输出视频文件路径（.mp4）")
    ap.add_argument(
        "--no-translate", action="store_true",
        help="跳过中英翻译（不显示英文字幕）"
    )
    ap.add_argument(
        "--keep-ass", action="store_true",
        help="保留生成的 .ass 文件（默认生成在与输出视频同目录）"
    )
    args = ap.parse_args()

    global HAS_TRANS
    if args.no_translate:
        HAS_TRANS = False

    # 1. 解析 SRT
    print(f"\n[1/4] 解析字幕文件: {args.srt}")
    subs = parse_srt(args.srt)
    if not subs:
        print("  [错误] 未解析到字幕内容，请检查 SRT 文件格式")
        sys.exit(1)
    print(f"  解析完成，共 {len(subs)} 条字幕")

    # 2. 视频分辨率
    print(f"\n[2/4] 读取视频分辨率: {args.video}")
    W, H = get_video_size(args.video)
    print(f"  分辨率: {W} × {H}")

    # 3. 生成 ASS
    print(f"\n[3/4] 生成 ASS 字幕（含中英翻译）...")
    if HAS_TRANS:
        print(f"  正在翻译 {len(subs)} 条字幕，请稍候...")
    ass_content = make_ass(subs, W, H)
    ass_path = str(Path(args.output).with_suffix(".ass"))
    Path(ass_path).write_text(ass_content, encoding="utf-8")
    print(f"  ASS 文件: {ass_path}")

    # 4. 烧录
    print(f"\n[4/4] 烧录字幕到视频...")
    ok = burn(args.video, ass_path, args.output)

    # 清理 ass（可选保留）
    if not args.keep_ass:
        try:
            Path(ass_path).unlink(missing_ok=True)
        except Exception:
            pass

    if ok:
        size_mb = Path(args.output).stat().st_size / 1024 / 1024
        print(f"\n✓ 完成！输出: {args.output}  ({size_mb:.1f} MB)")
    else:
        print("\n✗ 烧录失败，请确认：")
        print("  1. ffmpeg 已安装且在 PATH 中")
        print("  2. 输入视频文件可正常播放")
        sys.exit(1)


if __name__ == "__main__":
    main()
