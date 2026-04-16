"""
IndexTTS 语音克隆服务 - 端口 8766
运行方式:
  C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe indextts_server.py

依赖竞品的 Python 3.11 venv 和模型文件，不需要额外安装。
"""
import os
import sys

# ===== 必须在导入 torch 之前设置 PATH =====
VOICE_MODULE_DIR = r"C:\ChaojiIP\aigc-human\python-modules\voiceV2Module"
VENV_DIR = os.path.join(VOICE_MODULE_DIR, "venv")
TORCH_LIB = os.path.join(VENV_DIR, "Lib", "site-packages", "torch", "lib")
FFMPEG_BIN = os.path.join(VOICE_MODULE_DIR, "..", "..", "resources", "ffmpeg", "bin")
FFMPEG_BIN = os.path.normpath(FFMPEG_BIN)

for _p in [TORCH_LIB, FFMPEG_BIN]:
    if os.path.exists(_p) and _p not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _p + os.pathsep + os.environ.get("PATH", "")

sys.path.insert(0, VOICE_MODULE_DIR)
sys.path.insert(0, os.path.join(VOICE_MODULE_DIR, "indextts"))

# BigVGAN CUDA kernel 在某些环境会触发 SVML 错误，禁用走 torch 实现
os.environ["INDEXTTS_DISABLE_BIGVGAN_CUDA"] = "1"
# ==========================================

import asyncio
import base64
import tempfile
import traceback
import uuid

import uvicorn
from fastapi import FastAPI, HTTPException

import torch
from indextts.infer import IndexTTS

CHECKPOINTS_DIR = os.path.join(VOICE_MODULE_DIR, "checkpoints")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tts_outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ========== 情绪 → 生成参数映射 ==========
# temperature 控制随机性/表现力，top_p/top_k 控制采样范围
EMOTION_PARAMS = {
    "neutral": {"temperature": 1.0,  "top_p": 0.80, "top_k": 30},  # 自然
    "happy":   {"temperature": 1.2,  "top_p": 0.90, "top_k": 40},  # 开心
    "excited": {"temperature": 1.45, "top_p": 0.95, "top_k": 50},  # 激动
    "sad":     {"temperature": 0.72, "top_p": 0.70, "top_k": 20},  # 忧郁
    "calm":    {"temperature": 0.60, "top_p": 0.70, "top_k": 20},  # 平静
}
# ==========================================

print("正在加载 IndexTTS 模型（首次约需 20~40 秒）...")
tts = IndexTTS(
    cfg_path=os.path.join(CHECKPOINTS_DIR, "config.yaml"),
    model_dir=CHECKPOINTS_DIR,
    use_fp16=torch.cuda.is_available(),
    use_cuda_kernel=False,   # 禁用 BigVGAN CUDA kernel 避免 SVML 问题
)
print("IndexTTS 模型加载完成！")

# 同时只跑一个推理（GPU 资源限制）
inference_lock = asyncio.Lock()

app = FastAPI(title="IndexTTS Server")


@app.post("/tts/generate")
async def generate(payload: dict):
    text            = (payload.get("text") or "").strip()
    prompt_audio_b64 = payload.get("prompt_audio", "")  # 参考音频 base64
    emotion         = payload.get("emotion", "neutral")
    speed           = float(payload.get("speed", 1.0))

    if not text:
        raise HTTPException(400, "text 不能为空")
    if not prompt_audio_b64:
        raise HTTPException(400, "prompt_audio 不能为空（需要参考音频来克隆音色）")

    emo = EMOTION_PARAMS.get(emotion, EMOTION_PARAMS["neutral"])

    # 保存参考音频到临时文件
    try:
        audio_bytes = base64.b64decode(prompt_audio_b64)
    except Exception:
        raise HTTPException(400, "prompt_audio base64 解码失败")

    # 判断格式：WAV / MP3（torchaudio 都能读，但需 ffmpeg 解 mp3）
    suffix = ".mp3" if audio_bytes[:3] == b"ID3" or audio_bytes[:2] == b"\xff\xfb" else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio_bytes)
        prompt_path = f.name

    output_path = os.path.join(OUTPUT_DIR, f"{uuid.uuid4()}.wav")

    try:
        async with inference_lock:
            await asyncio.to_thread(
                _run_inference,
                prompt_path, text, output_path, speed, emo,
            )

        with open(output_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        return {"audio": audio_b64, "format": "wav"}

    except Exception as e:
        raise HTTPException(500, f"IndexTTS 推理失败: {type(e).__name__}: {str(e)[:400]}\n{traceback.format_exc()[-400:]}")
    finally:
        for p in [prompt_path, output_path]:
            try:
                if os.path.exists(p):
                    os.unlink(p)
            except Exception:
                pass


def _run_inference(prompt_path, text, output_path, speed, emo):
    """在线程池中同步执行，不阻塞事件循环"""
    tts.infer(
        audio_prompt=prompt_path,
        text=text,
        output_path=output_path,
        verbose=False,
        max_text_tokens_per_segment=120,
        # 情绪参数
        temperature=emo["temperature"],
        top_p=emo["top_p"],
        top_k=emo["top_k"],
        # 其他生成参数
        do_sample=True,
        num_beams=1,          # beam=1 配合 temperature 采样更自然
        repetition_penalty=10.0,
        length_penalty=0.0,
        max_mel_tokens=600,
    )


@app.get("/health")
def health():
    return {"status": "ok", "model": "IndexTTS-v1", "gpu": torch.cuda.is_available()}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8766)
