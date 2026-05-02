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
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
try:
    import oss2
    _OSS2_AVAILABLE = True
except ImportError:
    _OSS2_AVAILABLE = False

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
_hd_module = None     # hdModule main，主进程初始化后赋值
_hd_processor = None  # 单例 HDDigitalHumanProcessor，模型只加载一次


class OssConfig(BaseModel):
    endpoint:   str
    bucket:     str
    access_key: str
    secret_key: str
    prefix:     str = "videos"
    cdn_domain: Optional[str] = None  # 有则用 CDN URL，无则用 OSS 原始域名

AVATARS_DIR = Path(__file__).parent.parent / "local_asr_server" / "avatars"

class GenerateReq(BaseModel):
    audio_b64:  str
    video_b64:  Optional[str] = None         # video_b64 与 avatar_key 二选一
    avatar_key: Optional[str] = None         # 数字人库 key，本地磁盘路径，优先于 video_b64
    audio_fmt:  str = "wav"
    video_fmt:  str = "mp4"
    enhancer:   bool = False
    oss_config: Optional[OssConfig] = None   # 提供时本地直传 OSS，跳过 Zeabur 中转
    user_id:    Optional[str] = None         # 用于 OSS 路径和 avatar_key 目录
    save_as_avatar: bool = False             # 同时把源视频存为形象库
    avatar_name: str = ''                    # 形象名称（供上层写 DB 用）


@app.get("/health")
def health():
    return {"status": "ok", "model": "heygem-v2", "processor_ready": _hd_processor is not None}


@app.post("/video/generate")
async def generate(req: GenerateReq):
    print(f"[generate] audio_b64 len={len(req.audio_b64) if req.audio_b64 else 0} video_b64 len={len(req.video_b64) if req.video_b64 else 0} avatar_key={req.avatar_key}")
    if _hd_processor is None:
        raise HTTPException(503, "V2模型尚未初始化")

    # 解析视频来源：avatar_key 时直接记录文件路径，不在请求线程里读文件（避免阻塞事件循环）
    video_b64   = req.video_b64
    video_fmt   = req.video_fmt
    avatar_path = None
    if req.avatar_key and not video_b64:
        uid = req.user_id or "unknown"
        candidates = [
            AVATARS_DIR / f"u{uid}" / req.avatar_key,
            AVATARS_DIR / req.avatar_key,
        ]
        avatar_path = next((p for p in candidates if p.exists()), None)
        if not avatar_path:
            raise HTTPException(404, f"数字人文件不存在: {req.avatar_key}（已找路径: {[str(p) for p in candidates]}）")
        video_fmt = avatar_path.suffix.lstrip(".") or "mp4"

    if not video_b64 and not avatar_path:
        raise HTTPException(400, "请提供 video_b64 或 avatar_key")

    task_id = uuid.uuid4().hex
    with _task_lock:
        tasks[task_id] = {"status": "pending", "progress": 0, "msg": "等待中", "video_b64": None, "error": None}

    audio_path = TEMP_DIR / f"{task_id}.{req.audio_fmt}"
    video_path = TEMP_DIR / f"{task_id}_src.{video_fmt}"

    # 如果需要保存为形象，提前确定目标路径（此时还未解码）
    saved_avatar_key = None
    if req.save_as_avatar and video_b64 and req.user_id:
        uid = req.user_id
        _aid = uuid.uuid4().hex[:12]
        _ext = video_fmt or "mp4"
        _avatar_dir = AVATARS_DIR / f"u{uid}"
        _avatar_dir.mkdir(exist_ok=True)
        _avatar_save_path = _avatar_dir / f"{_aid}.{_ext}"
        saved_avatar_key = f"u{uid}/{_aid}.{_ext}"
    else:
        _avatar_save_path = None

    # 用线程执行所有磁盘 I/O，避免阻塞 uvicorn 事件循环
    def _write_files():
        audio_path.write_bytes(base64.b64decode(req.audio_b64))
        if avatar_path:
            import shutil
            shutil.copy2(str(avatar_path), str(video_path))
        else:
            video_data = base64.b64decode(video_b64)
            video_path.write_bytes(video_data)
            # 顺手存一份到形象库（本地 IO，和推理无关）
            if _avatar_save_path:
                _avatar_save_path.write_bytes(video_data)
                print(f"[HeyGem] 形象已保存: {_avatar_save_path}")

    try:
        await asyncio.to_thread(_write_files)
    except Exception as e:
        raise HTTPException(400, f"文件写入失败: {e}")

    asyncio.create_task(_run_heygem_v2(
        task_id, str(audio_path), str(video_path),
        oss_config=req.oss_config, user_id=req.user_id or "unknown",
    ))
    return {"task_id": task_id, "avatar_key": saved_avatar_key}


@app.get("/video/task/{task_id}")
def get_task(task_id: str):
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    # 不返回 video_b64（可能 50MB+），前端通过 /video/file/{task_id} 直接下载
    return {k: v for k, v in t.items() if k != "video_b64"}


@app.get("/video/file/{task_id}")
def get_video_file(task_id: str):
    from fastapi.responses import FileResponse
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    if t.get("status") != "done":
        raise HTTPException(425, "视频尚未生成完成")
    result_path = t.get("result_path")
    if not result_path or not Path(result_path).exists():
        raise HTTPException(404, "视频文件不存在")
    return FileResponse(result_path, media_type="video/mp4", filename=f"{task_id}.mp4")


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


def _try_ffmpeg_video(cmd: list, out_path, timeout=180) -> bool:
    """运行 ffmpeg 命令，返回是否成功输出有效视频文件。"""
    proc = _run_cmd(cmd, timeout=timeout)
    ok = proc.returncode == 0 and out_path.exists() and out_path.stat().st_size >= 1000
    if not ok:
        print(f"[ffmpeg FAIL] rc={proc.returncode} size={out_path.stat().st_size if out_path.exists() else 'N/A'}")
        print(f"[ffmpeg STDERR] {proc.stderr[-600:]}")
    return ok


def _normalize_video(task_id: str, video_path: str) -> str:
    """
    将任意上传视频转为 HeyGem 可用的 H.264 yuv420p 25fps MP4。
    四级降级策略（从原有可靠路径开始，逐步放宽）：
      1. 软件解码 + fps=25 filter（原始可靠路径，去掉 -map 0:v:0）
      2. CUDA 硬解 + fps=25 filter（兼容 HEVC/H.265/10bit）
      3. 软件解码 + -r 25（不用 fps filter，兼容变帧率）
      4. 流复制兜底（仅修容器格式）
    """
    def _out(suffix): return TEMP_DIR / f"{task_id}_video_norm{suffix}.mp4"

    # ── 级别1：软件解码 + fps=25 filter（原始方式，对 H.264 最稳定）────────
    p1 = _out("1")
    if _try_ffmpeg_video([
        "ffmpeg", "-y",
        "-i", video_path,
        "-an",
        "-vf", "fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-movflags", "+faststart",
        str(p1),
    ], p1):
        _validate_video(str(p1)); return str(p1)

    # ── 级别2：CUDA 硬解 + fps=25 filter（HEVC/H.265/10bit 等软解失败时）──
    p2 = _out("2")
    if _try_ffmpeg_video([
        "ffmpeg", "-y",
        "-hwaccel", "cuda",
        "-i", video_path,
        "-an",
        "-vf", "fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-movflags", "+faststart",
        str(p2),
    ], p2):
        _validate_video(str(p2)); return str(p2)

    # ── 级别3：软件解码 + -r 25（变帧率视频 fps filter 报 -22 时的备选）───
    p3 = _out("3")
    if _try_ffmpeg_video([
        "ffmpeg", "-y",
        "-i", video_path,
        "-an",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-r", "25",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-movflags", "+faststart",
        str(p3),
    ], p3):
        _validate_video(str(p3)); return str(p3)

    # ── 级别4：流复制（只修容器，不重编码）最后兜底 ──────────────────────
    p4 = _out("4")
    if _try_ffmpeg_video([
        "ffmpeg", "-y",
        "-i", video_path,
        "-an", "-c:v", "copy",
        "-movflags", "+faststart",
        str(p4),
    ], p4):
        _validate_video(str(p4)); return str(p4)

    raise ValueError(
        "头像视频格式转换失败，请重新上传清晰正脸 MP4（推荐手机直拍或微信录制，3-15 秒，H.264 编码）"
    )


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

        # 直接调用单例 processor 的实例方法，避免每次重新加载 256.onnx + HuBERT（省 10~30 秒）
        result = _hd_processor.generate_digital_human(
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


async def _run_heygem_v2(task_id: str, audio_path: str, video_path: str,
                         oss_config=None, user_id: str = "unknown"):
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

        # 压缩 + faststart：限制最大 1080p，压缩到 4-6Mbps，同时把 moov 搬到文件头。
        # 优先用 GPU 编码（h264_nvenc，秒级完成），失败自动降级 CPU libx264（约30-60s）。
        try:
            faststart_path = OUTPUT_DIR / f"{task_id}_faststart.mp4"
            _compress_ok = False
            _vf = "scale=-2:'min(ih,1080)',format=yuv420p"

            # 尝试 GPU 编码（RTX，速度是 CPU 的 10-20x）
            _gpu_proc = _run_cmd([
                "ffmpeg", "-y",
                "-i", result_path,
                "-vf", _vf,
                "-c:v", "h264_nvenc", "-preset", "fast", "-cq", "22",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                str(faststart_path),
            ], timeout=120)
            if _gpu_proc.returncode == 0 and faststart_path.exists() and faststart_path.stat().st_size > 1000:
                _compress_ok = True
                print(f"[HeyGemV2] GPU 压缩完成: {faststart_path}")
            else:
                print(f"[HeyGemV2] GPU 编码失败(rc={_gpu_proc.returncode})，降级 CPU libx264")
                try: faststart_path.unlink(missing_ok=True)
                except Exception: pass
                # 降级 CPU 编码
                _cpu_proc = _run_cmd([
                    "ffmpeg", "-y",
                    "-i", result_path,
                    "-vf", _vf,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                    "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart",
                    str(faststart_path),
                ], timeout=600)
                if _cpu_proc.returncode == 0 and faststart_path.exists() and faststart_path.stat().st_size > 1000:
                    _compress_ok = True
                    print(f"[HeyGemV2] CPU 压缩完成: {faststart_path}")
                else:
                    print(f"[HeyGemV2] CPU 编码也失败(rc={_cpu_proc.returncode})，兜底 copy+faststart")

            if not _compress_ok:
                # 最终兜底：仅搬 moov，不压缩
                _copy_proc = _run_cmd([
                    "ffmpeg", "-y", "-i", result_path,
                    "-c", "copy", "-movflags", "+faststart", str(faststart_path),
                ], timeout=120)
                if _copy_proc.returncode == 0 and faststart_path.exists() and faststart_path.stat().st_size > 1000:
                    _compress_ok = True

            if _compress_ok:
                old_path = result_path
                result_path = str(faststart_path)
                try: Path(old_path).unlink(missing_ok=True)
                except Exception: pass
                print(f"[HeyGemV2] 输出文件: {result_path}")
            else:
                print(f"[HeyGemV2] 所有压缩方案均失败，使用原始输出")
        except Exception as ff_err:
            print(f"[HeyGemV2] 压缩异常，使用原始输出: {ff_err}")

        # 直传 OSS（如果 Zeabur 提供了 oss_config）
        oss_url = None
        if oss_config and _OSS2_AVAILABLE:
            try:
                with _task_lock:
                    if tasks.get(task_id, {}).get("status") != "cancelled":
                        tasks[task_id].update({"msg": "上传至 OSS..."})
                auth   = oss2.Auth(oss_config.access_key, oss_config.secret_key)
                bucket = oss2.Bucket(auth, oss_config.endpoint, oss_config.bucket)
                oss_key = f"{oss_config.prefix.strip('/')}/{user_id}/{task_id}.mp4"
                with open(result_path, "rb") as fp:
                    bucket.put_object(oss_key, fp, headers={"Content-Type": "video/mp4"})
                if oss_config.cdn_domain:
                    cdn = oss_config.cdn_domain.rstrip('/')
                    oss_url = f"{cdn}/{oss_key}"
                else:
                    ep = oss_config.endpoint.replace('https://','').replace('http://','')
                    oss_url = f"https://{oss_config.bucket}.{ep}/{oss_key}"
                print(f"[HeyGemV2] OSS 直传完成: {oss_url}")
            except Exception as oss_err:
                print(f"[HeyGemV2] OSS 直传失败（将由 Zeabur 补传）: {oss_err}")
                oss_url = None

        with _task_lock:
            if tasks.get(task_id, {}).get("status") != "cancelled":
                update = {
                    "status": "done", "progress": 100, "msg": "V2高清完成",
                    "result_path": result_path,
                    "video_size": os.path.getsize(result_path),
                }
                if oss_url:
                    update["oss_url"] = oss_url  # 有则直接给前端 video_url，Zeabur 跳过中转
                tasks[task_id].update(update)
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

    # 创建单例 processor，模型（256.onnx + chinese-hubert-large）只加载一次
    # 后续每次生成直接调用 _hd_processor.generate_digital_human()，省去重复加载开销
    print("[HeyGemV2] 正在创建 HDDigitalHumanProcessor 单例（256.onnx + HuBERT 加载中）...")
    _hd_processor = _hd_module_raw.HDDigitalHumanProcessor()
    print("[HeyGemV2] 高清模型V2初始化完成，服务就绪（模型已常驻内存）")
    print(f"   模型目录: {HEYGEM_DIR}")
    print(f"   输出目录: {OUTPUT_DIR}")

    uvicorn.run(app, host="0.0.0.0", port=7861)
