"""
IndexTTS2 语音克隆服务 - 端口 8766
运行方式:
  C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe indextts_server.py

使用竞品的 Python 3.11 venv + 模型文件，无需额外安装。
"""
import os
import sys

# ===== 必须在导入 torch 之前设置，顺序不能变 =====
VOICE_MODULE_DIR = r"C:\ChaojiIP\aigc-human\python-modules\voiceV2Module"
VENV_DIR         = os.path.join(VOICE_MODULE_DIR, "venv")
HF_CACHE         = os.path.join(VOICE_MODULE_DIR, "hf_cache")
SVML_DIR         = r"C:\ProgramData\Waves Audio\Modules\AdditionalDLLs_x64"
FFMPEG_BIN       = os.path.normpath(os.path.join(VOICE_MODULE_DIR, "..", "..", "resources", "ffmpeg", "bin"))

for _p in [
    os.path.join(VENV_DIR, "Lib", "site-packages", "torch", "lib"),
    os.path.join(VENV_DIR, "Library", "bin"),
    SVML_DIR,
    FFMPEG_BIN,
]:
    if os.path.exists(_p) and _p not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _p + os.pathsep + os.environ.get("PATH", "")

# HuggingFace 离线模式（模型已缓存，不联网）
os.environ["HF_HOME"]               = HF_CACHE
os.environ["TRANSFORMERS_CACHE"]    = os.path.join(HF_CACHE, "transformers")
os.environ["HUGGINGFACE_HUB_CACHE"] = os.path.join(HF_CACHE, "hub")
os.environ["TRANSFORMERS_OFFLINE"]  = "1"
os.environ["HF_DATASETS_OFFLINE"]   = "1"

# BigVGAN CUDA kernel 禁用（避免潜在编译问题）
os.environ["INDEXTTS_DISABLE_BIGVGAN_CUDA"] = "1"

os.chdir(VOICE_MODULE_DIR)  # infer_v2 里有相对路径，必须切换到这里
sys.path.insert(0, VOICE_MODULE_DIR)
sys.path.insert(0, os.path.join(VOICE_MODULE_DIR, "indextts"))
# ===================================================

import asyncio
import base64
import tempfile
import traceback
import uuid
import warnings
warnings.filterwarnings("ignore")

import uvicorn
from fastapi import FastAPI, HTTPException

import torch
from indextts.infer_v2 import IndexTTS2

CHECKPOINTS_DIR = os.path.join(VOICE_MODULE_DIR, "checkpoints")
OUTPUT_DIR      = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tts_outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ========== 情绪配置 ==========
# v2 支持真实情感控制：emo_audio_prompt（情感参考音频）+ emo_alpha（权重）
# 没有情感参考音频时，用 examples/ 里的样本做默认情绪模板
EXAMPLES_DIR = os.path.join(VOICE_MODULE_DIR, "examples")
EMOTION_TEMPLATES = {
    "neutral": None,                                                     # 自然：不叠加任何模板，纯克隆参考音频，最忠实
    "happy":   os.path.join(EXAMPLES_DIR, "voice_01.wav"),              # 开心
    "excited": os.path.join(EXAMPLES_DIR, "voice_02.wav"),              # 激动
    "sad":     os.path.join(EXAMPLES_DIR, "emo_sad.wav"),               # 忧郁
    "calm":    os.path.join(EXAMPLES_DIR, "voice_03.wav"),              # 平静：用模板引导
}
# emo_alpha 权重：0=忽略情感，1=完全按情感音频
EMOTION_ALPHA = {
    "neutral": 0.0,   # 不叠加任何情感模板，完全克隆参考音频
    "happy":   0.6,
    "excited": 0.9,
    "sad":     0.8,
    "calm":    0.75,
}
# ==============================

print("正在加载 IndexTTS2 v2 模型（首次约需 30~60 秒）...")
tts = IndexTTS2(
    model_dir=CHECKPOINTS_DIR,
    cfg_path=os.path.join(CHECKPOINTS_DIR, "config.yaml"),
    use_fp16=torch.cuda.is_available(),
    use_deepspeed=False,
    use_cuda_kernel=False,
)
print(f"IndexTTS2 v2 加载完成！GPU: {torch.cuda.is_available()}")

inference_lock = asyncio.Lock()

app = FastAPI(title="IndexTTS2 Server")


@app.post("/tts/generate")
async def generate(payload: dict):
    text             = (payload.get("text") or "").strip()
    prompt_audio_b64 = payload.get("prompt_audio", "")   # 说话人参考音频（音色）
    emotion           = payload.get("emotion", "neutral")
    emo_alpha_override = payload.get("emo_alpha_override")  # 前端 0-10 → 0.0-1.0，None 表示用默认
    speed             = float(payload.get("speed", 1.0))

    if not text:
        raise HTTPException(400, "text 不能为空")
    if not prompt_audio_b64:
        raise HTTPException(400, "prompt_audio 不能为空（需要参考音频来克隆音色）")

    # 解码说话人参考音频
    try:
        spk_bytes = base64.b64decode(prompt_audio_b64)
    except Exception:
        raise HTTPException(400, "prompt_audio base64 解码失败")

    suffix = ".mp3" if (spk_bytes[:3] == b"ID3" or spk_bytes[:2] == b"\xff\xfb") else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(spk_bytes)
        spk_path = f.name

    output_path = os.path.join(OUTPUT_DIR, f"{uuid.uuid4()}.wav")

    # 情感参考音频（可选：用 examples/ 里的模板）
    emo_path  = EMOTION_TEMPLATES.get(emotion)
    # 优先用前端传来的强度覆盖，否则用默认表
    if emo_alpha_override is not None:
        emo_alpha = float(emo_alpha_override)
    else:
        emo_alpha = EMOTION_ALPHA.get(emotion, 0.0)
    if emo_path and not os.path.exists(emo_path):
        emo_path  = None
        emo_alpha = 0.0

    try:
        async with inference_lock:
            await asyncio.to_thread(
                _run_inference,
                spk_path, text, output_path, speed, emo_path, emo_alpha,
            )

        with open(output_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        return {"audio": audio_b64, "format": "wav"}

    except Exception as e:
        raise HTTPException(500, f"推理失败: {type(e).__name__}: {str(e)[:400]}\n{traceback.format_exc()[-400:]}")
    finally:
        for p in [spk_path, output_path]:
            try:
                if os.path.exists(p):
                    os.unlink(p)
            except Exception:
                pass


def _run_inference(spk_path, text, output_path, speed, emo_path, emo_alpha):
    tts.infer(
        spk_audio_prompt=spk_path,
        text=text,
        output_path=output_path,
        verbose=False,
        max_text_tokens_per_segment=120,
        emo_audio_prompt=emo_path,      # v2 真实情感控制
        emo_alpha=emo_alpha,
        use_random=False,
        speed=speed,
    )


@app.get("/health")
def health():
    return {"status": "ok", "model": "IndexTTS2-v2", "gpu": torch.cuda.is_available()}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8766)
