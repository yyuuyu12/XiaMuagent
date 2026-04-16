from fastapi import FastAPI, HTTPException
import whisper
import ffmpeg
import tempfile
import os
import glob
import httpx
import base64
import edge_tts

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

@app.post("/tts/synthesize")
async def tts_synthesize(payload: dict):
    text = payload.get("text", "").strip()
    voice_key = payload.get("voice", "xiaoxiao")
    rate_pct = int(payload.get("rate", 0))   # -50 ~ +100，0 = 正常速度

    if not text:
        raise HTTPException(status_code=400, detail="text 不能为空")

    voice = EDGE_VOICES.get(voice_key, "zh-CN-XiaoxiaoNeural")
    rate_str = f"+{rate_pct}%" if rate_pct >= 0 else f"{rate_pct}%"

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        tmp_path = f.name

    try:
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


@app.get("/health")
def health():
    return {"status": "ok"}
