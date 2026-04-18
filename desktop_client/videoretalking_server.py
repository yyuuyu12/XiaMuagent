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

    # ★ 文件放在 VRT 目录的 temp/ 下，使用简短文件名（避免绝对路径含冒号导致Windows报错）
    vrt_temp = VRT_DIR / "temp"
    vrt_temp.mkdir(exist_ok=True)
    audio_path = vrt_temp / f"{task_id}.{req.audio_fmt}"
    video_path = vrt_temp / f"{task_id}.{req.video_fmt}"
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
    tasks[task_id].update({"status": "running", "progress": 10, "msg": "模型加载中..."})
    cmd = [
        str(PYTHON_EXE), str(INFER_PY),
        "--face",    video_path,
        "--audio",   audio_path,
        "--outfile", out_path,
        "--exp_img", "neutral",
        "--LNet_batch_size", "32",
    ]
    proc = None
    try:
        # 禁用 torch.compile / dynamo（避免triton缺失导致回退CPU，速度极慢）
        env = os.environ.copy()
        env["TORCHDYNAMO_DISABLE"] = "1"
        env["TORCH_COMPILE_DISABLE"] = "1"

        # 输出直接打到VRT窗口，不用PIPE（避免tqdm \r导致readline阻塞）
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=None,   # 继承父进程stdout，直接显示在VRT窗口
            stderr=None,   # 继承父进程stderr
            cwd=str(VRT_DIR),
            env=env,
        )
        print(f"[VRT {task_id[:8]}] 推理开始 PID={proc.pid}", flush=True)

        # 每5秒更新一次进度（基于时间估算），同时等待进程完成
        TIMEOUT = 1800  # 30分钟
        steps = [
            (60,  20, "模型加载中..."),
            (120, 40, "Step1: 帧对齐..."),
            (240, 60, "Step2: 口型合成..."),
            (360, 80, "Step3: 画质增强..."),
            (600, 90, "收尾处理..."),
        ]
        elapsed = 0
        while True:
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
                break  # 进程结束
            except asyncio.TimeoutError:
                elapsed += 5
                if elapsed >= TIMEOUT:
                    proc.kill()
                    tasks[task_id].update({"status": "error", "error": "推理超时（超过30分钟）"})
                    return
                # 按时间估算进度
                for sec, pct, msg in reversed(steps):
                    if elapsed >= sec:
                        tasks[task_id].update({"progress": pct, "msg": msg})
                        break

        print(f"[VRT {task_id[:8]}] 结束 returncode={proc.returncode}", flush=True)

        if proc.returncode != 0:
            tasks[task_id].update({"status": "error", "error": f"推理失败（退出码 {proc.returncode}），请查看VRT窗口日志"})
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
