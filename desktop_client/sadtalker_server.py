"""
SadTalker 本地视频生成服务
端口: 7861
启动: venv\Scripts\python.exe sadtalker_server.py
"""
import os, sys, uuid, base64, asyncio, subprocess, json, time
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# SadTalker 目录（本文件放在 desktop_client/，SadTalker 在同级子目录）
SADTALKER_DIR = Path(__file__).parent / "SadTalker"
PYTHON_EXE   = SADTALKER_DIR / "venv" / "Scripts" / "python.exe"
INFERENCE_PY  = SADTALKER_DIR / "inference.py"
RESULT_DIR    = SADTALKER_DIR / "results"
TMP_DIR       = Path(__file__).parent / "tmp_video"
TMP_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="SadTalker Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# 任务存储（内存，重启丢失）
tasks: dict[str, dict] = {}

class GenerateReq(BaseModel):
    audio_b64: str          # base64 WAV/MP3
    video_b64: str          # base64 MP4/MOV 静默人脸视频
    audio_fmt: str = "wav"  # wav | mp3
    video_fmt: str = "mp4"  # mp4 | mov
    enhancer: bool = False  # 是否启用 GFPGAN 增强（慢但清晰）

@app.get("/health")
def health():
    return {"status": "ok", "sadtalker_dir": str(SADTALKER_DIR), "python": str(PYTHON_EXE)}

@app.post("/video/generate")
async def generate(req: GenerateReq):
    task_id = uuid.uuid4().hex
    tasks[task_id] = {"status": "pending", "progress": 0, "msg": "等待中", "video_b64": None, "error": None}

    # 写临时文件
    audio_path = TMP_DIR / f"{task_id}.{req.audio_fmt}"
    video_path = TMP_DIR / f"{task_id}_src.{req.video_fmt}"
    try:
        audio_path.write_bytes(base64.b64decode(req.audio_b64))
        video_path.write_bytes(base64.b64decode(req.video_b64))
    except Exception as e:
        raise HTTPException(400, f"base64解码失败: {e}")

    # 后台跑推理
    asyncio.create_task(_run_sadtalker(task_id, str(audio_path), str(video_path), req.enhancer))
    return {"task_id": task_id}

@app.get("/video/task/{task_id}")
def get_task(task_id: str):
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    return t

async def _run_sadtalker(task_id: str, audio_path: str, source_video_path: str, enhancer: bool):
    tasks[task_id].update({"status": "running", "progress": 5, "msg": "启动推理..."})
    cmd = [
        str(PYTHON_EXE), str(INFERENCE_PY),
        "--driven_audio", audio_path,
        "--source_image", source_video_path,   # SadTalker 支持视频作为 source_image
        "--result_dir", str(RESULT_DIR),
        "--preprocess", "crop",  # crop比full快3~5倍，正脸视频效果足够
        "--still",
    ]
    if enhancer:
        cmd += ["--enhancer", "gfpgan"]

    output_video_path = None
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(SADTALKER_DIR),
        )
        tasks[task_id].update({"progress": 20, "msg": "GPU推理中..."})

        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)

        if proc.returncode != 0:
            err = stderr.decode("utf-8", errors="replace")[-500:]
            tasks[task_id].update({"status": "error", "error": f"推理失败: {err}"})
            return

        # 找输出视频（最新的 mp4）
        mp4s = sorted(RESULT_DIR.rglob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not mp4s:
            tasks[task_id].update({"status": "error", "error": "未找到输出视频"})
            return

        output_video_path = mp4s[0]
        video_b64 = base64.b64encode(output_video_path.read_bytes()).decode()
        tasks[task_id].update({
            "status": "done",
            "progress": 100,
            "msg": "完成",
            "video_b64": video_b64,
            "video_size": output_video_path.stat().st_size,
        })

    except asyncio.TimeoutError:
        tasks[task_id].update({"status": "error", "error": "推理超时（超过5分钟）"})
    except Exception as e:
        tasks[task_id].update({"status": "error", "error": str(e)})
    finally:
        # 清理临时文件
        for p in [audio_path, source_video_path]:
            try: Path(p).unlink()
            except: pass

if __name__ == "__main__":
    print("🎬 SadTalker 服务启动")
    print(f"   Python:  {PYTHON_EXE}")
    print(f"   模型目录: {SADTALKER_DIR}/checkpoints")
    print(f"   输出目录: {RESULT_DIR}")
    uvicorn.run(app, host="0.0.0.0", port=7861)
