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

        # 下载 MP4
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.get(mp4_url, follow_redirects=True)
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail=f"视频下载失败: HTTP {response.status_code}")
            with open(mp4_path, "wb") as f:
                f.write(response.content)

        # ffmpeg 提取音频（16kHz 单声道，Whisper 最优）
        (
            ffmpeg
            .input(mp4_path)
            .output(audio_path, ar=16000, ac=1)
            .overwrite_output()
            .run(quiet=True)
        )

        # Whisper 语音识别
        result = model.transcribe(audio_path, language="zh", task="transcribe", word_timestamps=False, condition_on_previous_text=True, initial_prompt="以下是普通话内容，请加上标点符号。")
        text = result["text"].strip()

    return {"taskId": task_id, "text": text, "status": "done"}


@app.get("/health")
def health():
    return {"status": "ok"}
