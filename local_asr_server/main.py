from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import whisper
import ffmpeg
import tempfile
import os
import glob
import httpx
import base64
import asyncio
import edge_tts
import json
import uuid
from datetime import datetime
from pathlib import Path

# 计划任务以管理员运行时 WinGet/用户 PATH 可能缺失，手动补上 ffmpeg 路径
_FFMPEG_PATTERNS = [
    r"C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin",
    r"C:\ffmpeg\bin",
    r"C:\Program Files\ffmpeg\bin",
    r"C:\Program Files (x86)\ffmpeg\bin",
]
for _pat in _FFMPEG_PATTERNS:
    _matches = glob.glob(_pat)
    if _matches:
        _fp = _matches[0]
        if _fp not in os.environ.get("PATH", ""):
            os.environ["PATH"] = _fp + os.pathsep + os.environ.get("PATH", "")
        print(f"[ASR] ffmpeg PATH: {_fp}")
        break

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

print("正在加载 Whisper medium 模型（首次约需1-2分钟下载）...")
model = whisper.load_model("medium")
print("Whisper 模型加载完成！")


# ===================== 转写接口 =====================
@app.post("/asr/transcribe")
async def transcribe(payload: dict):
    task_id = payload.get("taskId", "")
    mp4_url = payload.get("mp4Url", "")

    if not mp4_url:
        raise HTTPException(status_code=400, detail="mp4Url 不能为空")

    try:
      return await _do_transcribe(task_id, mp4_url)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)[:400]}\n{traceback.format_exc()[-600:]}")

async def _do_transcribe(task_id: str, mp4_url: str):
    with tempfile.TemporaryDirectory() as tmpdir:
        mp4_path = os.path.join(tmpdir, "video.mp4")
        audio_path = os.path.join(tmpdir, "audio.wav")

        # 下载 MP4（需要移动端 UA + Referer，否则抖音 CDN 拒绝）
        headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "Referer": "https://www.douyin.com/",
        }
        async with httpx.AsyncClient(timeout=120, headers=headers, follow_redirects=True) as client:
            response = await client.get(mp4_url)
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail=f"视频下载失败: HTTP {response.status_code}")
            content = response.content
            if len(content) < 1000:
                raise HTTPException(status_code=502, detail=f"视频内容异常（{len(content)} 字节），可能被 CDN 拦截")
            with open(mp4_path, "wb") as f:
                f.write(content)

        # ffmpeg 提取音频（16kHz 单声道，Whisper 最优）
        try:
            (
                ffmpeg
                .input(mp4_path)
                .output(audio_path, ar=16000, ac=1)
                .overwrite_output()
                .run(quiet=True)
            )
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail=f"ffmpeg 未找到，请确认已安装 ffmpeg 并在 PATH 中。当前 PATH: {os.environ.get('PATH','')[:300]}")
        except ffmpeg.Error as e:
            raise HTTPException(status_code=500, detail=f"音频提取失败（ffmpeg）: {e.stderr.decode(errors='ignore')[-300:] if e.stderr else str(e)}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"音频提取异常: {type(e).__name__}: {str(e)[:300]}")

        # Whisper 语音识别
        result = model.transcribe(audio_path, language="zh", task="transcribe", word_timestamps=False, condition_on_previous_text=True, initial_prompt="以下是普通话内容，请加上标点符号。")
        text = result["text"].strip()

    return {"taskId": task_id, "text": text, "status": "done"}


# ===================== 语音合成接口（edge-tts）=====================
EDGE_VOICES = {
    'xiaoxiao': 'zh-CN-XiaoxiaoNeural',   # 女声·温柔
    'yunjian':  'zh-CN-YunjianNeural',     # 男声·磁性
    'xiaoyi':   'zh-CN-XiaoyiNeural',      # 女声·活泼
    'yunxi':    'zh-CN-YunxiNeural',       # 男声·阳光
    'yunyang':  'zh-CN-YunyangNeural',     # 男声·播报
}

# 使用 SSML express-as 风格让声音更自然平和（避免默认激动腔调）
# 各声音支持的最平和风格（经过测试验证可用）
EDGE_STYLES = {
    'yunjian':  'narration-professional',  # 专业叙述，不激动
    'yunxi':    'narration-relaxed',       # 放松叙述
    'xiaoxiao': 'calm',                    # 平静
    'xiaoyi':   'affectionate',            # 亲切，比 lyrical 平和
    'yunyang':  'narration-professional',
}

def _build_ssml(voice_name: str, style: str, rate_str: str, text: str) -> str:
    import html as html_mod
    safe_text = html_mod.escape(text)
    return (
        f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
        f"xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='zh-CN'>"
        f"<voice name='{voice_name}'>"
        f"<mstts:express-as style='{style}'>"
        f"<prosody rate='{rate_str}'>{safe_text}</prosody>"
        f"</mstts:express-as></voice></speak>"
    )

@app.post("/tts/synthesize")
async def tts_synthesize(payload: dict):
    text = payload.get("text", "").strip()
    voice_key = payload.get("voice", "xiaoxiao")
    rate_pct = int(payload.get("rate", 0))   # -50 ~ +100，0 = 正常速度

    if not text:
        raise HTTPException(status_code=400, detail="text 不能为空")

    voice = EDGE_VOICES.get(voice_key, "zh-CN-XiaoxiaoNeural")
    style = EDGE_STYLES.get(voice_key)
    rate_str = f"+{rate_pct}%" if rate_pct >= 0 else f"{rate_pct}%"

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        tmp_path = f.name

    try:
        if style:
            # SSML 方式：指定风格，声音更平和自然
            ssml = _build_ssml(voice, style, rate_str, text)
            communicate = edge_tts.Communicate(ssml, voice)
        else:
            communicate = edge_tts.Communicate(text, voice, rate=rate_str)
        await communicate.save(tmp_path)
        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()
        if not audio_bytes:
            # SSML 失败时降级为普通模式
            communicate = edge_tts.Communicate(text, voice, rate=rate_str)
            await communicate.save(tmp_path)
            with open(tmp_path, "rb") as f:
                audio_bytes = f.read()
        return {"audio": base64.b64encode(audio_bytes).decode(), "format": "mp3"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"edge-tts 合成失败: {str(e)[:300]}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ===================== IndexTTS 代理接口 =====================
INDEXTTS_URL = "http://localhost:8766"

@app.post("/tts/indextts")
async def tts_indextts_proxy(payload: dict):
    """代理到 IndexTTS 服务（端口 8766），需要先启动 start_indextts.bat"""
    try:
        async with httpx.AsyncClient(timeout=210) as client:  # 3.5分钟，低于Zeabur的4分钟
            resp = await client.post(f"{INDEXTTS_URL}/tts/generate", json=payload)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:400])
        return resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="IndexTTS 服务未启动，请运行 start_indextts.bat 后重试")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="IndexTTS 推理超时（>3.5分钟）。建议：参考音频控制在10~30秒，文案不超过500字")


@app.get("/health")
def health():
    return {"status": "ok"}


# ===================== 数字人视频代理接口（SadTalker/HeyGem 端口 7861）=====================
SADTALKER_URL = "http://localhost:7861"
AVATARS_DIR = Path(__file__).parent / "avatars"
AVATARS_DIR.mkdir(exist_ok=True)

@app.post("/video/generate")
async def video_generate_proxy(payload: dict):
    """代理到数字人服务（端口 7862 VideoReTalking）。支持 avatar_key（本地文件key）代替 video_b64"""
    # 若传入 avatar_key，从本地磁盘读取视频，避免前端重复上传大文件
    avatar_key = payload.pop("avatar_key", None)
    if avatar_key and not payload.get("video_b64"):
        avatar_path = AVATARS_DIR / avatar_key
        if not avatar_path.exists():
            raise HTTPException(404, f"数字人文件不存在: {avatar_key}")
        payload["video_b64"] = base64.b64encode(avatar_path.read_bytes()).decode()
        payload.setdefault("video_fmt", avatar_path.suffix.lstrip(".") or "mp4")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{SADTALKER_URL}/video/generate", json=payload)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:400])
        return resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="数字人服务未启动，请运行对应的启动脚本")

@app.get("/video/task/{task_id}")
async def video_task_proxy(task_id: str):
    """轮询数字人任务状态"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{SADTALKER_URL}/video/task/{task_id}")
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
        return resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="数字人服务连接失败，请确认数字人服务已启动")


# ===================== 视频后期制作（字幕烧录）=====================

def _hex_to_ass(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB → &HAABBGGRR (ASS颜色格式)"""
    h = hex_color.lstrip('#')
    if len(h) != 6:
        return f"&H00{alpha:02X}FFFFFF"
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def _seconds_to_ass_time(s: float) -> str:
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = s % 60
    return f"{h}:{m:02d}:{sec:05.2f}"


async def _get_video_size(video_path: str) -> tuple[int, int]:
    """ffprobe 检测视频宽高，失败返回 (720, 1280)"""
    try:
        import json as _json
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", video_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        info = _json.loads(stdout)
        for s in info.get("streams", []):
            if s.get("codec_type") == "video":
                return int(s.get("width", 720)), int(s.get("height", 1280))
    except Exception:
        pass
    return 720, 1280


def _wrap_subtitle(text: str, max_chars: int) -> str:
    """中文字幕折行：每行不超过 max_chars 个字符，最多保留前两行"""
    text = text.strip()
    if not text:
        return text
    lines = []
    while text and len(lines) < 2:
        lines.append(text[:max_chars])
        text = text[max_chars:]
    return r"\N".join(lines)


def _build_ass(segments: list, fontsize: int, sub_color: str,
               outline_color: str, outline_width: float,
               vid_w: int = 720) -> str:
    primary = _hex_to_ass(sub_color)
    if outline_color.lower() in ('none', 'transparent', ''):
        ol_color = "&H00000000"
        ol_width = 0.0
    else:
        ol_color = _hex_to_ass(outline_color)
        ol_width = outline_width

    # ASS PlayResX = 视频宽度，Margin 相对于 PlayResX
    # 中文全角字符宽 ≈ fontsize * 1.5（粗体+字间距），两边各留 12% 空白
    margin_lr = max(60, int(vid_w * 0.12))   # 12% 左右边距，最少 60px
    usable_w  = vid_w - margin_lr * 2
    char_w    = fontsize * 1.5               # 粗体中文实际宽度更大
    max_chars = min(14, max(5, int(usable_w / char_w)))  # 硬上限14字/行

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {vid_w}\n"
        "WrapStyle: 1\n"          # 超宽自动折行（libass 支持）
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,Microsoft YaHei,{fontsize},{primary},&H000000FF,"
        f"{ol_color},&H00000000,-1,0,0,0,100,100,0,0,1,{ol_width:.1f},0,"
        f"2,{margin_lr},{margin_lr},120,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = []
    for seg in segments:
        text = _wrap_subtitle(seg["text"].strip(), max_chars)
        if not text:
            continue
        start = _seconds_to_ass_time(max(0.0, seg["start"]))
        end   = _seconds_to_ass_time(seg["end"])
        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")
    return header + "\n".join(lines)


async def _ffmpeg_burn_subtitles(video_path: str, ass_path: str, output_path: str):
    """用 FFmpeg 把 ASS 字幕烧录进视频"""
    # Windows路径转义：反斜杠→正斜杠，驱动器冒号前加反斜杠
    ass_esc = ass_path.replace("\\", "/")
    if len(ass_esc) >= 2 and ass_esc[1] == ":":
        ass_esc = ass_esc[0] + "\\:" + ass_esc[2:]

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"ass='{ass_esc}'",
        "-c:a", "aac",
        "-c:v", "libx264",
        "-preset", "faster",
        "-crf", "18",
        output_path,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg字幕烧录失败: {stderr.decode(errors='replace')[-400:]}")


@app.post("/video/postprocess")
async def video_postprocess(payload: dict):
    """
    视频后期制作：Whisper识别时间轴 → ASS字幕 → FFmpeg烧录
    payload: video_b64, audio_b64, audio_fmt,
             sub_color(#RRGGBB), outline_color(#RRGGBB|none),
             outline_width(0~4), fontsize(24~60)
    """
    video_b64   = payload.get("video_b64", "")
    audio_b64   = payload.get("audio_b64", "")
    audio_fmt   = payload.get("audio_fmt", "mp3")
    sub_color   = payload.get("sub_color", "#FFFFFF")
    outline_col = payload.get("outline_color", "#000000")
    outline_w   = float(payload.get("outline_width", 2.0))
    fontsize    = int(payload.get("fontsize", 44))

    if not video_b64 or not audio_b64:
        raise HTTPException(400, "video_b64 和 audio_b64 不能为空")

    with tempfile.TemporaryDirectory() as tmpdir:
        video_in  = os.path.join(tmpdir, "input.mp4")
        audio_in  = os.path.join(tmpdir, f"audio.{audio_fmt}")
        ass_file  = os.path.join(tmpdir, "subs.ass")
        video_out = os.path.join(tmpdir, "output.mp4")

        try:
            Path(video_in).write_bytes(base64.b64decode(video_b64))
            Path(audio_in).write_bytes(base64.b64decode(audio_b64))
        except Exception as e:
            raise HTTPException(400, f"base64解码失败: {e}")

        # Whisper 识别音频时间轴
        try:
            result = await asyncio.to_thread(
                model.transcribe,
                audio_in,
                language="zh",
                task="transcribe",
                word_timestamps=False,
                condition_on_previous_text=True,
                initial_prompt="以下是普通话内容，请加上标点符号。",
            )
        except Exception as e:
            raise HTTPException(500, f"Whisper识别失败: {e}")

        segments = [
            {"start": s["start"], "end": s["end"], "text": s["text"]}
            for s in result.get("segments", [])
        ]
        if not segments:
            raise HTTPException(500, "未识别到任何语音内容，无法生成字幕")

        # 检测视频宽度（决定折行字符数）
        vid_w, _ = await _get_video_size(video_in)

        # 生成 ASS 字幕
        ass_content = _build_ass(segments, fontsize, sub_color, outline_col, outline_w, vid_w)
        Path(ass_file).write_text(ass_content, encoding="utf-8-sig")

        # FFmpeg 烧录
        try:
            await _ffmpeg_burn_subtitles(video_in, ass_file, video_out)
        except Exception as e:
            raise HTTPException(500, str(e))

        result_b64 = base64.b64encode(Path(video_out).read_bytes()).decode()
        return {
            "video_b64": result_b64,
            "format": "mp4",
            "segments_count": len(segments),
        }


# ===================== 数字人管理 =====================

async def _extract_thumbnail(video_path: str) -> str:
    """抽取第一帧作为缩略图，返回 data:image/jpeg;base64,xxx"""
    thumb_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            thumb_path = f.name
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", video_path,
            "-vframes", "1", "-q:v", "5", "-vf", "scale=320:-1",
            thumb_path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=15)
        if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
            data = base64.b64encode(Path(thumb_path).read_bytes()).decode()
            return f"data:image/jpeg;base64,{data}"
    except Exception:
        pass
    finally:
        if thumb_path and os.path.exists(thumb_path):
            try: os.unlink(thumb_path)
            except: pass
    return ""


@app.post("/avatar/upload")
async def avatar_upload(
    user_id: str = Form(...),
    name: str = Form("未命名数字人"),
    video: UploadFile = File(...),
):
    if not user_id:
        raise HTTPException(400, "user_id 不能为空")
    user_dir = AVATARS_DIR / f"u{user_id}"
    user_dir.mkdir(exist_ok=True)

    avatar_id = uuid.uuid4().hex[:12]
    ext = "mp4"
    if video.filename and "." in video.filename:
        ext = video.filename.rsplit(".", 1)[-1].lower()
    video_path = user_dir / f"{avatar_id}.{ext}"

    try:
        video_bytes = await video.read()
        video_path.write_bytes(video_bytes)
    except Exception as e:
        raise HTTPException(400, f"视频保存失败: {e}")

    thumbnail = await _extract_thumbnail(str(video_path))
    meta = {
        "id": avatar_id,
        "name": (name.strip() or "未命名数字人")[:30],
        "filename": f"{avatar_id}.{ext}",
        "key": f"u{user_id}/{avatar_id}.{ext}",
        "size": len(video_bytes),
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "thumbnail": thumbnail,
    }
    (user_dir / f"{avatar_id}.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )
    return {"ok": True, "avatar_id": avatar_id, "name": meta["name"],
            "key": meta["key"], "thumbnail": thumbnail}


@app.get("/avatar/list/{user_id}")
async def avatar_list(user_id: str):
    user_dir = AVATARS_DIR / f"u{user_id}"
    if not user_dir.exists():
        return {"avatars": []}
    avatars = []
    for mf in sorted(user_dir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            meta = json.loads(mf.read_text(encoding="utf-8"))
            if (user_dir / meta["filename"]).exists():
                avatars.append(meta)
        except Exception:
            pass
    return {"avatars": avatars}


@app.delete("/avatar/{user_id}/{avatar_id}")
async def avatar_delete(user_id: str, avatar_id: str):
    user_dir = AVATARS_DIR / f"u{user_id}"
    for p in user_dir.glob(f"{avatar_id}.*"):
        try: p.unlink()
        except: pass
    return {"ok": True}


@app.get("/avatar/file/{user_id}/{avatar_id}")
async def avatar_file(user_id: str, avatar_id: str):
    user_dir = AVATARS_DIR / f"u{user_id}"
    for ext in ["mp4", "mov", "avi", "mkv"]:
        f = user_dir / f"{avatar_id}.{ext}"
        if f.exists():
            return FileResponse(str(f), media_type="video/mp4")
    raise HTTPException(404, "数字人视频不存在")


# ===================== 行业精选视频采集（本地执行）=====================

@app.post("/industry/collect")
async def industry_collect(payload: dict):
    """
    由 Zeabur 后台触发，在本地执行视频搜索+ASR转录，
    结果直接 POST 到 Zeabur 的 /api/industry-videos/admin/submit
    """
    tikhub_key  = payload.get("tikhub_key", "")
    submit_url  = payload.get("submit_url", "")
    admin_token = payload.get("admin_token", "")
    industries  = payload.get("industries", {})
    keep_latest = payload.get("keep_latest", 15)
    min_chars   = payload.get("min_chars", 15)

    if not tikhub_key:
        raise HTTPException(400, "tikhub_key 未提供")
    if not submit_url:
        raise HTTPException(400, "submit_url 未提供")

    # 异步后台执行，立即返回
    asyncio.create_task(_run_industry_collect(
        tikhub_key, submit_url, admin_token, industries, keep_latest, min_chars
    ))
    return {"ok": True, "msg": "采集任务已在本地启动"}


async def _search_videos(keyword: str, tikhub_key: str, count: int = 20):
    """搜索抖音高赞视频"""
    payload = {
        "keyword": keyword,
        "cursor": 0,
        "sort_type": "1",
        "publish_time": "0",
        "filter_duration": "0",
        "content_type": "1",
        "search_id": "",
        "backtrace": "",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.tikhub.io/api/v1/douyin/search/fetch_general_search_v1",
            json=payload,
            headers={"Authorization": f"Bearer {tikhub_key}"},
        )
    if r.status_code != 200:
        raise Exception(f"TikHub HTTP {r.status_code}: {r.text[:200]}")
    data = r.json().get("data", {})
    raw = data.get("data", [])
    videos = []
    for item in raw:
        if item.get("type") != 1:
            continue
        v = item.get("aweme_info", {})
        aweme_id = v.get("aweme_id")
        video_url = (v.get("video", {}).get("play_addr", {}).get("url_list") or
                     v.get("video", {}).get("download_addr", {}).get("url_list") or [None])[0]
        if not aweme_id or not video_url:
            continue
        videos.append({
            "aweme_id": aweme_id,
            "author":   v.get("author", {}).get("nickname", ""),
            "cover_url": (v.get("video", {}).get("cover", {}).get("url_list") or [""])[0],
            "video_url": video_url,
            "likes":    v.get("statistics", {}).get("digg_count", 0),
        })
    videos.sort(key=lambda x: -x["likes"])
    return videos[:count]


async def _transcribe_local(video_url: str):
    """本地直接下载+Whisper转录（不走ngrok）"""
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Referer": "https://www.douyin.com/",
    }
    async with httpx.AsyncClient(timeout=120, headers=headers, follow_redirects=True) as client:
        resp = await client.get(video_url)
    if resp.status_code != 200:
        raise Exception(f"视频下载失败 HTTP {resp.status_code}")
    content = resp.content
    if len(content) < 1000:
        raise Exception(f"视频内容异常({len(content)}字节)")

    with tempfile.TemporaryDirectory() as tmpdir:
        mp4_path   = os.path.join(tmpdir, "video.mp4")
        audio_path = os.path.join(tmpdir, "audio.wav")
        with open(mp4_path, "wb") as f:
            f.write(content)
        (
            ffmpeg.input(mp4_path)
            .output(audio_path, ar=16000, ac=1)
            .overwrite_output()
            .run(quiet=True)
        )
        result = model.transcribe(
            audio_path, language="zh", task="transcribe",
            word_timestamps=False, condition_on_previous_text=True,
            initial_prompt="以下是普通话内容，请加上标点符号。"
        )
    return result["text"].strip()


async def _run_industry_collect(tikhub_key, submit_url, admin_token, industries, keep_latest, min_chars):
    print("[IndustryCollect] 本地采集开始")
    seen = set()
    for industry, keywords in industries.items():
        print(f"[IndustryCollect] 行业: {industry}")
        results = []
        for keyword in keywords:
            print(f"[IndustryCollect]   搜索: {keyword}")
            try:
                videos = await _search_videos(keyword, tikhub_key)
                print(f"[IndustryCollect]   找到 {len(videos)} 个视频")
            except Exception as e:
                print(f"[IndustryCollect]   搜索失败: {e}")
                continue

            for v in videos:
                if v["aweme_id"] in seen:
                    continue
                seen.add(v["aweme_id"])
                print(f"[IndustryCollect]   转录: {v['aweme_id']} ({v['likes']}赞)")
                try:
                    text = await _transcribe_local(v["video_url"])
                    print(f"[IndustryCollect]   结果: {text[:50]!r} ({len(text)}字)")
                    if len(text) >= min_chars:
                        results.append({**v, "transcript": text})
                    else:
                        print(f"[IndustryCollect]   跳过（无口播{len(text)}字）")
                except Exception as e:
                    print(f"[IndustryCollect]   转录失败: {e}")

        # 按点赞降序，只提交前 keep_latest 条
        results.sort(key=lambda x: -x["likes"])
        to_submit = results[:keep_latest]
        print(f"[IndustryCollect] {industry} 提交 {len(to_submit)} 条到 Zeabur")

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    submit_url,
                    json={"industry": industry, "videos": to_submit},
                    headers={"Authorization": f"Bearer {admin_token}"},
                )
            print(f"[IndustryCollect] submit 响应: {r.status_code} {r.text[:100]}")
        except Exception as e:
            print(f"[IndustryCollect] submit 失败: {e}")

    print("[IndustryCollect] 本地采集完成")
