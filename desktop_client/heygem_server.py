"""
HeyGem 数字人视频生成服务
端口: 7861
启动: start_heygem.bat
"""
import multiprocessing
multiprocessing.freeze_support()   # Windows spawn 必须最先调用

import os
import sys

# HeyGem 依赖 Waves Audio DLL，确保 PATH 包含该目录（无论从哪个脚本启动）
_WAVES_PATH = r"C:\ProgramData\Waves Audio\Modules\AdditionalDLLs_x64"
if _WAVES_PATH not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _WAVES_PATH + os.pathsep + os.environ.get("PATH", "")
import uuid
import base64
import asyncio
import threading
import subprocess
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ===== 路径配置 =====
HEYGEM_DIR = Path(r"C:\ChaojiIP\aigc-human\python-modules\humanModule")
OUTPUT_DIR = Path(__file__).parent / "heygem_outputs"
TEMP_DIR   = Path(__file__).parent / "heygem_temp"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# ===== FastAPI =====
app = FastAPI(title="HeyGem Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

tasks: dict[str, dict] = {}
_task_lock = threading.Lock()
_dh_task = None   # 仅主进程初始化，子进程（spawn）不会执行 __main__ 块


class GenerateReq(BaseModel):
    audio_b64: str
    video_b64: str
    audio_fmt: str = "wav"
    video_fmt: str = "mp4"
    enhancer:  bool = False


@app.get("/health")
def health():
    return {"status": "ok", "model": "heygem"}


@app.post("/video/generate")
async def generate(req: GenerateReq):
    if _dh_task is None:
        raise HTTPException(503, "模型尚未初始化")
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

    asyncio.create_task(_run_heygem(task_id, str(audio_path), str(video_path)))
    return {"task_id": task_id}


@app.get("/video/task/{task_id}")
def get_task(task_id: str):
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    return t


@app.get("/video/file/{task_id}")
def video_file(task_id: str):
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    if t.get("status") != "done":
        raise HTTPException(425, "视频尚未生成完成")
    path = t.get("result_file")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "视频文件不存在")
    return FileResponse(path, media_type="video/mp4", filename=f"{task_id}.mp4")


def _do_work(task_id, audio_path, video_path):
    with _task_lock:
        tasks[task_id].update({"status": "running", "progress": 10, "msg": "GPU推理中..."})
    _dh_task.work(audio_path, video_path, task_id, 0, 0, 0, 0)


async def _run_heygem(task_id: str, audio_path: str, video_path: str):
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_do_work, task_id, audio_path, video_path),
            timeout=600
        )

        task_info = _dh_task.task_dic.get(task_id, {})
        result_path = task_info.get("result_path")

        # HeyGem 默认输出在 HEYGEM_DIR/outputs/{task_id}-r.mp4
        candidates = []
        if result_path:
            candidates.append(result_path)
            # result_path 可能是相对路径，补全绝对路径
            candidates.append(str(HEYGEM_DIR / result_path.lstrip("./\\")))
        candidates.append(str(HEYGEM_DIR / "outputs" / f"{task_id}-r.mp4"))
        candidates.append(str(HEYGEM_DIR / "outputs" / f"{task_id}.mp4"))
        candidates.append(str(OUTPUT_DIR / f"{task_id}.mp4"))

        result_path = None
        for p in candidates:
            if os.path.exists(p):
                result_path = p
                break

        if not result_path:
            with _task_lock:
                tasks[task_id].update({"status": "error", "error": f"未找到输出视频，检查路径: {candidates[0] if candidates else '无'}"})
            return

        # faststart：把 moov atom 移到文件头，浏览器可立即获取时长
        faststart_path = str(OUTPUT_DIR / f"{task_id}_fs.mp4")
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", result_path,
                 "-c", "copy", "-movflags", "+faststart", faststart_path],
                capture_output=True, timeout=120
            )
            if os.path.exists(faststart_path) and os.path.getsize(faststart_path) > 0:
                result_path = faststart_path
        except Exception:
            pass  # faststart 失败时用原文件

        with _task_lock:
            tasks[task_id].update({
                "status": "done", "progress": 100, "msg": "完成",
                "result_file": result_path,
                "video_size": os.path.getsize(result_path),
            })
    except asyncio.TimeoutError:
        with _task_lock:
            tasks[task_id].update({"status": "error", "error": "推理超时（超过10分钟）"})
    except Exception as e:
        import traceback
        traceback.print_exc()
        with _task_lock:
            tasks[task_id].update({"status": "error", "error": str(e)[:300]})
    finally:
        for p in [audio_path, video_path]:
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == '__main__':
    # Windows spawn 保护：只有主进程才执行初始化
    os.chdir(str(HEYGEM_DIR))
    sys.path.insert(0, str(HEYGEM_DIR))
    os.environ["RESULT_DIR"] = str(OUTPUT_DIR)
    os.environ["TEMP_DIR"]   = str(TEMP_DIR)

    print("[HeyGem] 正在初始化数字人模型，请稍候（约30~60秒）...")
    from service.trans_dh_service import TransDhTask
    _dh_task = TransDhTask.instance()
    print("[HeyGem] 模型初始化完成，服务就绪")
    print(f"   模型目录: {HEYGEM_DIR}")
    print(f"   输出目录: {OUTPUT_DIR}")

    uvicorn.run(app, host="0.0.0.0", port=7861)
