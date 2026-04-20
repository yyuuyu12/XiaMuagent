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


def _do_work_v2(task_id, audio_path, video_path):
    """在线程中调用 hdModule.generateDigitalHuman"""
    with _task_lock:
        tasks[task_id].update({"status": "running", "progress": 10, "msg": "V2 GPU高清推理中..."})

    # hdModule 的 generateDigitalHuman 直接接受文件路径，output_dir 指定输出目录
    result = _hd_module.generateDigitalHuman(
        audio_file=audio_path,
        video_file=video_path,
        watermark=False,
        digital_auth=False,
        output_dir=str(OUTPUT_DIR),
    )
    print(f"[HeyGemV2] generateDigitalHuman 返回: {result}")
    return result


async def _run_heygem_v2(task_id: str, audio_path: str, video_path: str):
    result = None
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_do_work_v2, task_id, audio_path, video_path),
            timeout=600
        )

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

        if not result_path:
            with _task_lock:
                tasks[task_id].update({"status": "error", "error": f"V2未找到输出视频，候选: {candidates[:3]}"})
            return

        video_b64 = base64.b64encode(Path(result_path).read_bytes()).decode()
        with _task_lock:
            tasks[task_id].update({
                "status": "done", "progress": 100, "msg": "V2高清完成",
                "video_b64": video_b64,
                "video_size": os.path.getsize(result_path),
            })
    except asyncio.TimeoutError:
        with _task_lock:
            tasks[task_id].update({"status": "error", "error": "V2推理超时（超过10分钟）"})
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
