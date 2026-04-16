from fastapi import FastAPI, HTTPException
import whisper
import ffmpeg
import tempfile
import os
import httpx

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
        except ffmpeg.Error as e:
            raise HTTPException(status_code=500, detail=f"音频提取失败（ffmpeg）: {e.stderr.decode(errors='ignore')[-300:] if e.stderr else str(e)}")

        # Whisper 语音识别
        result = model.transcribe(audio_path, language="zh", task="transcribe", word_timestamps=False, condition_on_previous_text=True, initial_prompt="以下是普通话内容，请加上标点符号。")
        text = result["text"].strip()

    return {"taskId": task_id, "text": text, "status": "done"}


@app.get("/health")
def health():
    return {"status": "ok"}
