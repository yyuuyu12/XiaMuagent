"""
VideoReTalking 口型驱动服务
端口: 7861
启动: start_videoretalking.bat
"""
import os, sys, uuid, base64, asyncio
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

VRT_DIR    = Path(__file__).parent / "VideoReTalking"
PYTHON_EXE = VRT_DIR / "venv" / "Scripts" / "python.exe"
INFER_PY   = VRT_DIR / "inference.py"
TMP_DIR    = Path(__file__).parent / "vrt_tmp"
OUT_DIR    = Path(__file__).parent / "vrt_outputs"
TMP_DIR.mkdir(exist_ok=True)
OUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="VideoReTalking Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

tasks: dict[str, dict] = {}


class GenerateReq(BaseModel):
    audio_b64: str
    video_b64: str
    audio_fmt: str = "wav"
    video_fmt: str = "mp4"
    enhancer:  bool = False


@app.get("/health")
def health():
    return {"status": "ok", "model": "videoretalking"}


@app.post("/video/generate")
async def generate(req: GenerateReq):
    task_id = uuid.uuid4().hex
    tasks[task_id] = {"status": "pending", "progress": 0, "msg": "等待中", "video_b64": None, "error": None}

    audio_path = TMP_DIR / f"{task_id}.{req.audio_fmt}"
    video_path = TMP_DIR / f"{task_id}_src.{req.video_fmt}"
    out_path   = OUT_DIR / f"{task_id}.mp4"

    try:
        audio_path.write_bytes(base64.b64decode(req.audio_b64))
        video_path.write_bytes(base64.b64decode(req.video_b64))
    except Exception as e:
        raise HTTPException(400, f"base64解码失败: {e}")

    asyncio.create_task(_run_vrt(task_id, str(audio_path), str(video_path), str(out_path)))
    return {"task_id": task_id}


@app.get("/video/task/{task_id}")
def get_task(task_id: str):
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    return t


async def _run_vrt(task_id: str, audio_path: str, video_path: str, out_path: str):
    tasks[task_id].update({"status": "running", "progress": 10, "msg": "推理中..."})
    cmd = [
        str(PYTHON_EXE), str(INFER_PY),
        "--face",    video_path,
        "--audio",   audio_path,
        "--outfile", out_path,
        "--exp_img", "neutral",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(VRT_DIR),
        )
        tasks[task_id].update({"progress": 30, "msg": "GPU推理中..."})
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)

        if proc.returncode != 0:
            err = stderr.decode("utf-8", errors="replace")[-600:]
            tasks[task_id].update({"status": "error", "error": f"推理失败:\n{err}"})
            return

        if not os.path.exists(out_path):
            tasks[task_id].update({"status": "error", "error": "未找到输出视频"})
            return

        video_b64 = base64.b64encode(Path(out_path).read_bytes()).decode()
        tasks[task_id].update({
            "status": "done", "progress": 100, "msg": "完成",
            "video_b64": video_b64,
            "video_size": os.path.getsize(out_path),
        })
    except asyncio.TimeoutError:
        tasks[task_id].update({"status": "error", "error": "推理超时（超过10分钟）"})
    except Exception as e:
        tasks[task_id].update({"status": "error", "error": str(e)[:300]})
    finally:
        for p in [audio_path, video_path]:
            try: Path(p).unlink(missing_ok=True)
            except: pass


if __name__ == "__main__":
    print("VideoReTalking 服务启动中...")
    print(f"  模型目录: {VRT_DIR}")
    print(f"  Python:  {PYTHON_EXE}")
    uvicorn.run(app, host="0.0.0.0", port=7862)
