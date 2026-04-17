"""
HeyGem 数字人视频生成服务
端口: 7861
启动: start_heygem.bat
替代 SadTalker，效果更好：全身保留 + 口型驱动
"""
import os
import sys
import uuid
import base64
import asyncio
import tempfile
import threading
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ===== 路径配置（不修改原始目录）=====
HEYGEM_DIR = Path(r"C:\ChaojiIP\aigc-human\python-modules\humanModule")
HEYGEM_VENV_PYTHON = Path(r"C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe")

# 输出目录放在本项目下，不污染原始目录
OUTPUT_DIR = Path(__file__).parent / "heygem_outputs"
TEMP_DIR   = Path(__file__).parent / "heygem_temp"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# ===== 加载 HeyGem 模块 =====
# 把 humanModule 加入 Python 路径，但不修改原始代码
sys.path.insert(0, str(HEYGEM_DIR))
os.chdir(str(HEYGEM_DIR))  # HeyGem 用相对路径加载配置和模型，必须切换工作目录

# 覆盖 GlobalConfig 的输出路径，指向本项目目录
os.environ["RESULT_DIR"] = str(OUTPUT_DIR)
os.environ["TEMP_DIR"]   = str(TEMP_DIR)

# ===== FastAPI 服务 =====
app = FastAPI(title="HeyGem Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

tasks: dict[str, dict] = {}
_task_lock = threading.Lock()
_dh_task = None   # TransDhTask 单例，懒加载

def _get_dh_task():
    global _dh_task
    if _dh_task is None:
        print("[HeyGem] 正在初始化数字人模型（首次约需 30~60 秒）...")
        from service.trans_dh_service import TransDhTask
        _dh_task = TransDhTask.instance()
        print("[HeyGem] 模型初始化完成")
    return _dh_task


class GenerateReq(BaseModel):
    audio_b64: str          # base64 WAV/MP3
    video_b64: str          # base64 MP4/MOV 静默人脸视频
    audio_fmt: str = "wav"
    video_fmt: str = "mp4"
    enhancer:  bool = False  # 保留字段，HeyGem 内置超分无需单独控制


@app.get("/health")
def health():
    return {"status": "ok", "model": "heygem"}


@app.post("/video/generate")
async def generate(req: GenerateReq):
    task_id = uuid.uuid4().hex
    with _task_lock:
        tasks[task_id] = {"status": "pending", "progress": 0, "msg": "等待中", "video_b64": None, "error": None}

    # 写临时音视频文件
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


async def _run_heygem(task_id: str, audio_path: str, video_path: str):
    with _task_lock:
        tasks[task_id].update({"status": "running", "progress": 5, "msg": "启动推理..."})

    try:
        dh = await asyncio.to_thread(_get_dh_task)
        with _task_lock:
            tasks[task_id].update({"progress": 10, "msg": "模型已就绪，处理中..."})

        # work(audio_url, video_url, code, watermark_switch, digital_auth, chaofen, pn)
        # watermark_switch=0 不加水印, digital_auth=0, chaofen=0 普通模式, pn=0
        await asyncio.wait_for(
            asyncio.to_thread(dh.work, audio_path, video_path, task_id, 0, 0, 0, 0),
            timeout=600
        )

        # 从 task_dic 拿结果路径
        task_info = dh.task_dic.get(task_id, {})
        result_path = task_info.get("result_path") or str(OUTPUT_DIR / f"{task_id}.mp4")

        if not os.path.exists(result_path):
            # 尝试直接路径
            result_path = str(OUTPUT_DIR / f"{task_id}.mp4")

        if not os.path.exists(result_path):
            with _task_lock:
                tasks[task_id].update({"status": "error", "error": "未找到输出视频"})
            return

        video_b64 = base64.b64encode(Path(result_path).read_bytes()).decode()
        with _task_lock:
            tasks[task_id].update({
                "status": "done", "progress": 100, "msg": "完成",
                "video_b64": video_b64,
                "video_size": os.path.getsize(result_path),
            })

    except asyncio.TimeoutError:
        with _task_lock:
            tasks[task_id].update({"status": "error", "error": "推理超时（超过10分钟）"})
    except Exception as e:
        import traceback
        with _task_lock:
            tasks[task_id].update({"status": "error", "error": str(e)[:300]})
        traceback.print_exc()
    finally:
        for p in [audio_path, video_path]:
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == "__main__":
    print("🎬 HeyGem 数字人服务启动")
    print(f"   模型目录: {HEYGEM_DIR}")
    print(f"   输出目录: {OUTPUT_DIR}")
    uvicorn.run(app, host="0.0.0.0", port=7861)
