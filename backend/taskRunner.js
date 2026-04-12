/**
 * 极简内存任务队列（替代 BullMQ + Redis）
 * 串行执行，服务器重启丢失队列中未开始的任务（DB 里会标 failed）
 */

const queue = [];
let running = false;

// 任务处理器（由 worker 注入）
let handler = null;

function setHandler(fn) {
  handler = fn;
}

function enqueue(payload) {
  queue.push(payload);
  if (!running) next();
}

async function next() {
  if (!handler || queue.length === 0) { running = false; return; }
  running = true;
  const job = queue.shift();
  try {
    await handler(job);
  } catch (e) {
    // handler 内部已处理错误并更新 DB，这里只记日志
    console.error('[TaskRunner] job failed:', e.message);
  }
  next();
}

module.exports = { setHandler, enqueue };
