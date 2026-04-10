require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== 中间件 ====================
app.use(cors({
  origin: '*', // 生产环境可改为你的域名
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '2mb' }));

// ==================== 路由 ====================
const { router: authRouter } = require('./routes/auth');
const configRouter = require('./routes/config');
const aiRouter = require('./routes/ai');
const extractRouter = require('./routes/extract');
const historyRouter = require('./routes/history');
const codesRouter = require('./routes/codes');
const douyinToTextRouter = require('./routes/douyinToText');

app.use('/api/auth', authRouter);
app.use('/api/config', configRouter);
app.use('/api/ai', aiRouter);
app.use('/api/extract', extractRouter);
app.use('/api/history', historyRouter);
app.use('/api/codes', codesRouter);
app.use('/api/video', douyinToTextRouter);

// 静态文件（H5前端）
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 200, msg: 'ok', time: new Date().toISOString() });
});

// 前端路由兜底（非API请求返回index.html）
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).json({ code: 404, msg: '接口不存在' });
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 爆款文案工坊后端启动成功`);
  console.log(`   监听端口: ${PORT}`);
  console.log(`   健康检查: http://localhost:${PORT}/api/health\n`);
});
