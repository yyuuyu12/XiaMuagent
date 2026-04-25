"""
HeyGem V2 数字人视频生成服务（hdModule - 高清模型V2）
端口: 7861
使用 hdModule venv 启动:
  C:\ChaojiIP\aigc-human\python-modules\hdModule\venv\python.exe heygem_server_v2.py
"""
import multiprocessing
multiprocessing.freeze_support()

import os
import sys
import uuid
import base64
import asyncio
import glob
import json
import subprocess
import threading
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ===== 路径配置（V2 = hdModule）=====
HEYGEM_DIR = Path(r"C:\ChaojiIP\aigc-human\python-modules\hdModule")
OUTPUT_DIR = Path(__file__).parent / "heygem_outputs"
TEMP_DIR   = Path(__file__).parent / "heygem_temp"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# 计划任务以管理员运行时可能拿不到用户 PATH，这里补上常见 ffmpeg 安装位置。
_FFMPEG_PATTERNS = [
    r"C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin",
    r"C:\ffmpeg\bin",
    r"C:\Program Files\ffmpeg\bin",
    r"C:\Program Files (x86)\ffmpeg\bin",
]
for _pat in _FFMPEG_PATTERNS:
    _matches = glob.glob(_pat)
    if _matches:
        _ffmpeg_bin = _matches[0]
        if _ffmpeg_bin not in os.environ.get("PATH", ""):
            os.environ["PATH"] = _ffmpeg_bin + os.pathsep + os.environ.get("PATH", "")
        print(f"[HeyGemV2] ffmpeg PATH: {_ffmpeg_bin}")
        break

# ===== FastAPI =====
app = FastAPI(title="HeyGem Server V2")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

tasks: dict[str, dict] = {}
_task_lock = threading.Lock()
_hd_module = None   # hdModule main，主进程初始化后赋值


class GenerateReq(BaseModel):
    audio_b64: str
    video_b64: str
    audio_fmt: str = "wav"
    video_fmt: str = "mp4"
    enhancer:  bool = False


@app.get("/health")
def health():
    return {"status": "ok", "model": "heygem-v2"}


@app.post("/video/generate")
async def generate(req: GenerateReq):
    if _hd_module is None:
        raise HTTPException(503, "V2模型尚未初始化")
    task_id = uuid.uuid4().hex
    with _task_lock:
        tasks[task_id] = {"status": "pending", "progress": 0, "msg": "等待中", "video_b64": None, "error": None}

    audio_path = TEMP_DIR / f"{task_id}.{req.audio_fmt}"
    video_path = TEMP_DIR / f"{task_id}_src.{req.video_fmt}"
    try:
        audio_path.write_bytes(base64.b64decode(req.audio_b64))
        video_path.write_bytes(base64.b64decode(req.video_b64))
    except Exception as e:
        raise HTTPException(400, f"base64解码失败: {e}")

    asyncio.create_task(_run_heygem_v2(task_id, str(audio_path), str(video_path)))
    return {"task_id": task_id}


@app.get("/video/task/{task_id}")
def get_task(task_id: str):
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    return t


@app.post("/video/cancel/{task_id}")
def cancel_task(task_id: str):
    with _task_lock:
        t = tasks.get(task_id)
        if not t:
            raise HTTPException(404, "任务不存在")
        t.update({"status": "cancelled", "progress": 0, "msg": "已停止生成", "error": "已停止生成"})
    return {"status": "cancelled", "task_id": task_id}


def _task_cancelled(task_id: str) -> bool:
    with _task_lock:
        return tasks.get(task_id, {}).get("status") == "cancelled"


def _run_cmd(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as e:
        raise RuntimeError("数字人生成需要 ffmpeg/ffprobe，请确认本机已安装并在 PATH 中") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("媒体预处理超时，请换一段更短的头像视频后重试") from e


def _ratio_to_float(value: str | None) -> float:
    if not value or value == "0/0":
        return 0.0
    if "/" in value:
        top, bottom = value.split("/", 1)
        bottom_float = float(bottom)
        if bottom_float == 0:
            return 0.0
        return float(top) / bottom_float
    return float(value)


def _probe(path: str) -> dict:
    proc = _run_cmd([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration,size",
        "-show_streams",
        "-of", "json",
        path,
    ], timeout=20)
    if proc.returncode != 0:
        raise ValueError(f"无法读取媒体文件，请重新上传 MP4 视频或重新生成语音。{proc.stderr[-160:]}")
    try:
        return json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as e:
        raise ValueError("媒体文件信息读取失败，请重新上传 MP4 视频或重新生成语音") from e


def _first_stream(info: dict, stream_type: str) -> dict | None:
    for stream in info.get("streams", []):
        if stream.get("codec_type") == stream_type:
            return stream
    return None


def _media_duration(info: dict, stream: dict | None = None) -> float:
    values = []
    if stream:
        values.append(stream.get("duration"))
    values.append((info.get("format") or {}).get("duration"))
    for value in values:
        try:
            duration = float(value)
            if duration > 0:
                return duration
        except (TypeError, ValueError):
            continue
    return 0.0


def _validate_audio(path: str):
    info = _probe(path)
    stream = _first_stream(info, "audio")
    duration = _media_duration(info, stream)
    if not stream or duration <= 0.2:
        raise ValueError("语音内容太短或生成失败，请先重新生成语音后再生成数字人")


def _validate_video(path: str):
    info = _probe(path)
    stream = _first_stream(info, "video")
    if not stream:
        raise ValueError("头像视频没有可读取的视频画面，请重新上传 3-15 秒清晰正脸 MP4")
    duration = _media_duration(info, stream)
    fps = _ratio_to_float(stream.get("avg_frame_rate")) or _ratio_to_float(stream.get("r_frame_rate"))
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if duration <= 0.5 or fps <= 0 or width <= 0 or height <= 0:
        raise ValueError("头像视频时长或帧率读取异常，请重新上传 3-15 秒清晰正脸 MP4")


def _normalize_audio(task_id: str, audio_path: str) -> str:
    out_path = TEMP_DIR / f"{task_id}_audio_norm.wav"
    proc = _run_cmd([
        "ffmpeg", "-y",
        "-i", audio_path,
        "-vn",
        "-ac", "1",
        "-ar", "22050",
        "-c:a", "pcm_s16le",
        str(out_path),
    ], timeout=90)
    if proc.returncode != 0 or not out_path.exists() or out_path.stat().st_size < 1000:
        raise ValueError(f"语音格式转换失败，请重新生成语音。{proc.stderr[-160:]}")
    _validate_audio(str(out_path))
    return str(out_path)


def _normalize_video(task_id: str, video_path: str) -> str:
    out_path = TEMP_DIR / f"{task_id}_video_norm.mp4"
    proc = _run_cmd([
        "ffmpeg", "-y",
        "-i", video_path,
        "-map", "0:v:0",
        "-an",
        "-vf", "fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-movflags", "+faststart",
        str(out_path),
    ], timeout=180)
    if proc.returncode != 0 or not out_path.exists() or out_path.stat().st_size < 1000:
        raise ValueError(f"头像视频格式转换失败，请重新上传 MP4 视频。{proc.stderr[-160:]}")
    _validate_video(str(out_path))
    return str(out_path)


def _friendly_error(e: Exception) -> str:
    raw = str(e) or e.__class__.__name__
    lowered = raw.lower()
    if "float division by zero" in lowered or "division by zero" in lowered:
        return "数字人生成失败：头像视频帧率读取异常。请重新上传 3-15 秒清晰正脸 MP4，系统会自动转码后再生成。"
    if isinstance(e, ValueError):
        return raw[:300]
    return f"数字人生成失败：{raw[:260]}"


def _do_work_v2(task_id, audio_path, video_path):
    """在线程中调用 hdModule.generateDigitalHuman"""
    with _task_lock:
        tasks[task_id].update({"status": "running", "progress": 10, "msg": "正在检查素材..."})

    normalized_paths: list[str] = []
    try:
        _validate_audio(audio_path)
        _validate_video(video_path)
        with _task_lock:
            tasks[task_id].update({"progress": 18, "msg": "正在整理视频格式..."})

        norm_audio = _normalize_audio(task_id, audio_path)
        norm_video = _normalize_video(task_id, video_path)
        normalized_paths.extend([norm_audio, norm_video])

        if _task_cancelled(task_id):
            return None

        with _task_lock:
            tasks[task_id].update({"progress": 28, "msg": "V2 GPU高清推理中..."})

        # hdModule 的 generateDigitalHuman 直接接受文件路径，output_dir 指定输出目录
        result = _hd_module.generateDigitalHuman(
            audio_file=norm_audio,
            video_file=norm_video,
            watermark=False,
            digital_auth=False,
            output_dir=str(OUTPUT_DIR),
        )
        print(f"[HeyGemV2] generateDigitalHuman 返回: {result}")
        return result
    finally:
        for p in normalized_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass


async def _run_heygem_v2(task_id: str, audio_path: str, video_path: str):
    result = None
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_do_work_v2, task_id, audio_path, video_path),
            timeout=600
        )
        if _task_cancelled(task_id):
            return

        # 查找输出视频：优先用函数返回值，再遍历候选路径
        candidates = []
        if result and isinstance(result, str) and os.path.exists(result):
            candidates.insert(0, result)
        # hdModule 输出规律：output_dir/{task_id}.mp4 或 output_dir/result.mp4
        candidates += [
            str(OUTPUT_DIR / f"{task_id}.mp4"),
            str(OUTPUT_DIR / f"{task_id}-r.mp4"),
            str(HEYGEM_DIR / "outputs" / f"{task_id}.mp4"),
            str(HEYGEM_DIR / "outputs" / f"{task_id}-r.mp4"),
        ]
        # 也检查 output_dir 里最新生成的 mp4
        mp4s = sorted(OUTPUT_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        for mp4 in mp4s[:3]:
            candidates.append(str(mp4))

        result_path = None
        for p in candidates:
            if os.path.exists(p):
                result_path = p
                break

        if _task_cancelled(task_id):
            return

        if not result_path:
            with _task_lock:
                if tasks.get(task_id, {}).get("status") != "cancelled":
                    tasks[task_id].update({"status": "error", "error": f"V2未找到输出视频，候选: {candidates[:3]}"})
            return

        video_b64 = base64.b64encode(Path(result_path).read_bytes()).decode()
        with _task_lock:
            if tasks.get(task_id, {}).get("status") != "cancelled":
                tasks[task_id].update({
                    "status": "done", "progress": 100, "msg": "V2高清完成",
                    "video_b64": video_b64,
                    "video_size": os.path.getsize(result_path),
                })
    except asyncio.TimeoutError:
        with _task_lock:
            if tasks.get(task_id, {}).get("status") != "cancelled":
                tasks[task_id].update({"status": "error", "error": "V2推理超时（超过10分钟）"})
    except Exception as e:
        import traceback
        traceback.print_exc()
        with _task_lock:
            if tasks.get(task_id, {}).get("status") != "cancelled":
                tasks[task_id].update({"status": "error", "error": _friendly_error(e)})
    finally:
        for p in [audio_path, video_path]:
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == '__main__':
    os.chdir(str(HEYGEM_DIR))
    sys.path.insert(0, str(HEYGEM_DIR))
    os.environ["RESULT_DIR"] = str(OUTPUT_DIR)
    os.environ["TEMP_DIR"]   = str(TEMP_DIR)

    print("[HeyGemV2] 正在初始化高清模型V2，请稍候（约30~90秒）...")
    import main as _hd_module_raw
    _hd_module = _hd_module_raw
    print("[HeyGemV2] 高清模型V2初始化完成，服务就绪")
    print(f"   模型目录: {HEYGEM_DIR}")
    print(f"   输出目录: {OUTPUT_DIR}")

    uvicorn.run(app, host="0.0.0.0", port=7861)
