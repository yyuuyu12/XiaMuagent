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
import hashlib
import threading
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
# 说话人参考音频持久化缓存目录：同一个声音始终用同一个文件路径，
# 使 tts.cache_audio_prompt 路径匹配，直接复用 cache_cond_mel，跳过耗时的音频编码
SPK_CACHE_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spk_cache")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(SPK_CACHE_DIR, exist_ok=True)

# voice_id → spk_path 映射（启动时扫描已有缓存文件重建，后续 register_voice 追加）
# voice_id = md5(音频bytes)，与 _get_spk_path 的命名规则一致
_voice_path_map: dict = {}
for _f in os.listdir(SPK_CACHE_DIR):
    _stem, _ext = os.path.splitext(_f)
    if _ext in (".wav", ".mp3") and len(_stem) == 32:
        _voice_path_map[_stem] = os.path.join(SPK_CACHE_DIR, _f)
print(f"[SPK_CACHE] 启动时扫描到 {len(_voice_path_map)} 个已注册声音")


def _get_spk_path(spk_bytes: bytes) -> str:
    """
    按参考音频内容 hash 生成固定路径（而非随机临时文件）。
    相同声音 → 相同路径 → tts 内部 cache_cond_mel 命中 → 跳过 conditioning 提取，大幅提速。
    """
    md5 = hashlib.md5(spk_bytes).hexdigest()
    suffix = ".mp3" if (spk_bytes[:3] == b"ID3" or spk_bytes[:2] == b"\xff\xfb") else ".wav"
    path = os.path.join(SPK_CACHE_DIR, f"{md5}{suffix}")
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(spk_bytes)
        print(f"[SPK_CACHE] 新声音已缓存: {md5}{suffix}")
    else:
        print(f"[SPK_CACHE] 命中缓存，跳过音频编码: {md5}{suffix}")
    return path

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
# 调低 happy/excited 默认权重，避免过于激动（用户反馈 happy 0.6 太夸张）
EMOTION_ALPHA = {
    "neutral": 0.0,   # 不叠加任何情感模板，完全克隆参考音频
    "happy":   0.3,   # 开心：轻柔叠加，自然愉悦（原0.6太激动）
    "excited": 0.6,   # 激动：中等叠加（原0.9过于夸张）
    "sad":     0.5,   # 忧郁：适度（原0.8太沉重）
    "calm":    0.45,  # 平静：轻柔引导（原0.75偏重）
}
# ==============================

print("正在加载 IndexTTS2 v2 模型（首次约需 30~60 秒）...")
tts = IndexTTS2(
    model_dir=CHECKPOINTS_DIR,
    cfg_path=os.path.join(CHECKPOINTS_DIR, "config.yaml"),
    use_fp16=torch.cuda.is_available(),
    use_deepspeed=False,
    use_cuda_kernel=False,  # 显存紧张时关闭，避免额外占用 ~2GB
)
print(f"IndexTTS2 v2 加载完成！GPU: {torch.cuda.is_available()}")

inference_lock = asyncio.Lock()
_tasks: dict = {}
_tasks_lock = threading.Lock()

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

    # 解码说话人参考音频，写入持久化缓存（相同声音 → 相同路径 → cache_cond_mel 命中）
    try:
        spk_bytes = base64.b64decode(prompt_audio_b64)
    except Exception:
        raise HTTPException(400, "prompt_audio base64 解码失败")

    spk_path    = _get_spk_path(spk_bytes)
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
        # spk_path 是持久化缓存文件，不删除（相同声音下次可直接复用）
        try:
            if os.path.exists(output_path):
                os.unlink(output_path)
        except Exception:
            pass


@app.post("/tts/register_voice")
async def register_voice(payload: dict):
    """
    预注册声音：上传参考音频 → 写入 spk_cache → 返回 voice_id（md5）。
    后续 /tts/submit 传 prompt_audio_key=voice_id 即可跳过音频传输，直接走本地缓存。
    """
    prompt_audio_b64 = payload.get("prompt_audio", "")
    if not prompt_audio_b64:
        raise HTTPException(400, "prompt_audio 不能为空")
    try:
        spk_bytes = base64.b64decode(prompt_audio_b64)
    except Exception:
        raise HTTPException(400, "prompt_audio base64 解码失败")
    spk_path = _get_spk_path(spk_bytes)
    voice_id = hashlib.md5(spk_bytes).hexdigest()
    _voice_path_map[voice_id] = spk_path
    return {"voice_id": voice_id}


@app.post("/tts/submit")
async def tts_submit(payload: dict):
    """异步提交：立即返回 task_id，推理在后台运行"""
    task_id = uuid.uuid4().hex
    with _tasks_lock:
        _tasks[task_id] = {"status": "pending", "audio": None, "format": "wav", "error": None}
    asyncio.create_task(_run_tts_task(task_id, payload))
    return {"task_id": task_id}


@app.get("/tts/task/{task_id}")
def tts_task_status(task_id: str):
    """查询任务状态"""
    t = _tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    # 返回时不包含 audio（可能几十MB），只在 done 时返回
    if t["status"] == "done":
        return {"status": "done", "audio": t["audio"], "format": t["format"]}
    return {"status": t["status"], "error": t.get("error")}


async def _run_tts_task(task_id: str, payload: dict):
    """后台执行推理"""
    text             = (payload.get("text") or "").strip()
    prompt_audio_b64 = payload.get("prompt_audio", "")
    prompt_audio_key = payload.get("prompt_audio_key", "")   # voice_id（md5），跳过音频传输
    emotion           = payload.get("emotion", "neutral")
    emo_alpha_override = payload.get("emo_alpha_override")
    speed             = float(payload.get("speed", 1.0))

    if not text:
        with _tasks_lock:
            _tasks[task_id]["status"] = "error"
            _tasks[task_id]["error"] = "text 不能为空"
        return

    # 优先用 key（本地缓存路径），避免通过 frp 传输 MB 级音频
    if prompt_audio_key and prompt_audio_key in _voice_path_map:
        spk_path = _voice_path_map[prompt_audio_key]
        print(f"[SPK_CACHE] 命中 prompt_audio_key={prompt_audio_key}，跳过音频传输")
    elif prompt_audio_b64:
        try:
            spk_bytes = base64.b64decode(prompt_audio_b64)
        except Exception:
            with _tasks_lock:
                _tasks[task_id]["status"] = "error"
                _tasks[task_id]["error"] = "prompt_audio base64 解码失败"
            return
        spk_path = _get_spk_path(spk_bytes)
        # 顺手注册到 map，下次可通过 key 跳过传输
        voice_id = hashlib.md5(spk_bytes).hexdigest()
        _voice_path_map[voice_id] = spk_path
    else:
        with _tasks_lock:
            _tasks[task_id]["status"] = "error"
            _tasks[task_id]["error"] = "prompt_audio 或 prompt_audio_key 不能同时为空"
        return

    output_path = os.path.join(OUTPUT_DIR, f"{task_id}.wav")
    emo_path  = EMOTION_TEMPLATES.get(emotion)
    emo_alpha = float(emo_alpha_override) if emo_alpha_override is not None else EMOTION_ALPHA.get(emotion, 0.0)
    if emo_path and not os.path.exists(emo_path):
        emo_path, emo_alpha = None, 0.0

    import time as _time
    t_submit = _time.perf_counter()
    char_count = len(text)
    print(f"[TIMING][{task_id[:8]}] 任务开始，文字{char_count}字，等待推理锁...")

    try:
        with _tasks_lock:
            _tasks[task_id]["status"] = "running"
        t_lock_wait_start = _time.perf_counter()
        async with inference_lock:
            t_lock_acquired = _time.perf_counter()
            print(f"[TIMING][{task_id[:8]}] 获得推理锁，等锁耗时 {t_lock_acquired - t_lock_wait_start:.2f}s，开始推理...")
            await asyncio.to_thread(_run_inference, spk_path, text, output_path, speed, emo_path, emo_alpha)
            t_infer_done = _time.perf_counter()
            print(f"[TIMING][{task_id[:8]}] 推理完成，耗时 {t_infer_done - t_lock_acquired:.2f}s")

        t_io_start = _time.perf_counter()
        with open(output_path, "rb") as f:
            raw = f.read()
        audio_b64 = base64.b64encode(raw).decode()
        t_io_done = _time.perf_counter()
        print(f"[TIMING][{task_id[:8]}] 读文件+base64编码 {t_io_done - t_io_start:.2f}s，音频大小 {len(raw)/1024:.1f}KB")
        print(f"[TIMING][{task_id[:8]}] 全程总耗时 {t_io_done - t_submit:.2f}s（等锁{t_lock_acquired-t_lock_wait_start:.2f}s + 推理{t_infer_done-t_lock_acquired:.2f}s + IO{t_io_done-t_io_start:.2f}s）")

        with _tasks_lock:
            _tasks[task_id].update({"status": "done", "audio": audio_b64, "format": "wav"})
    except Exception as e:
        print(f"[TIMING][{task_id[:8]}] 推理异常: {type(e).__name__}: {str(e)[:200]}")
        with _tasks_lock:
            _tasks[task_id].update({"status": "error", "error": f"{type(e).__name__}: {str(e)[:300]}"})
    finally:
        # spk_path 是持久化缓存文件，不删除（相同声音下次可直接复用）
        try:
            if os.path.exists(output_path): os.unlink(output_path)
        except Exception:
            pass


def _run_inference(spk_path, text, output_path, speed, emo_path, emo_alpha):
    import time as _time
    t0 = _time.perf_counter()
    print(f"[TIMING][infer] tts.infer 开始，spk={os.path.basename(spk_path)}，emo={emo_path and os.path.basename(emo_path)}，alpha={emo_alpha}")
    tts.infer(
        spk_audio_prompt=spk_path,
        text=text,
        output_path=output_path,
        verbose=False,
        max_text_tokens_per_segment=300,
        emo_audio_prompt=emo_path,      # v2 真实情感控制
        emo_alpha=emo_alpha,
        use_random=False,
        speed=speed,
    )
    print(f"[TIMING][infer] tts.infer 完成，耗时 {_time.perf_counter()-t0:.2f}s")


@app.get("/health")
def health():
    return {"status": "ok", "model": "IndexTTS2-v2", "gpu": torch.cuda.is_available()}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8766)
