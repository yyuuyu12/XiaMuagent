require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const initDb = require('./initDb');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS 白名单：正式域名 + 本地调试，经环境变量 CORS_ORIGINS 配置（逗号分隔）
// 未配置时默认放行，避免误伤现有部署；配置后仅白名单内来源可跨域
const _corsWhitelist = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const _corsDefaultAllow = [
  'http://localhost:3001', 'http://127.0.0.1:3001',
  'http://localhost:5173', 'http://127.0.0.1:5173',
];
app.use(cors({
  origin(origin, cb) {
    // 同源请求 / 服务器到服务器（无 origin 头）一律放行
    if (!origin) return cb(null, true);
    // 未配置白名单 → 兼容旧行为，全部放行
    if (_corsWhitelist.length === 0) return cb(null, true);
    if (_corsWhitelist.includes(origin) || _corsDefaultAllow.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','PUT','DELETE','PATCH'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit: '80mb' })); // 视频生成需要传 base64 视频+音频（视频可达50MB+）

const { router: authRouter } = require('./routes/auth');
const configRouter  = require('./routes/config');
const aiRouter      = require('./routes/ai');
const extractRouter = require('./routes/extract');
const historyRouter = require('./routes/history');
const codesRouter   = require('./routes/codes');
const douyinRouter  = require('./routes/douyinToText');
const inspireRouter  = require('./routes/inspire');
const tasksRouter    = require('./routes/tasks');
const { router: industryVideosRouter } = require('./routes/industryVideos');
const { router: creditsRouter }        = require('./routes/credits');
const agentsRouter                     = require('./routes/agents');
const originalRouter                   = require('./routes/original');
const { router: novelRouter }          = require('./routes/novel');
const videomixRouter                   = require('./routes/videomix');
const relayHeygemRouter                = require('./routes/relayHeygem');

app.use('/api/auth',             authRouter);
app.use('/api/config',           configRouter);
app.use('/api/ai',               aiRouter);
app.use('/api/extract',          extractRouter);
app.use('/api/history',          historyRouter);
app.use('/api/codes',            codesRouter);
app.use('/api/video',            douyinRouter);
app.use('/api/inspire',          inspireRouter);
app.use('/api/tasks',            tasksRouter);
app.use('/api/industry-videos',  industryVideosRouter);
app.use('/api/credits',          creditsRouter);
app.use('/api/agents',           agentsRouter);
app.use('/api/original',         originalRouter);
app.use('/api/novel',            novelRouter);
app.use('/api/videomix',         videomixRouter);
app.use('/api/relay/heygem',     relayHeygemRouter);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => res.json({ code: 200, msg: 'ok', time: new Date().toISOString() }));
app.get('/desktop', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'desktop.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.status(404).json({ code: 404, msg: '接口不存在' });
  });
});
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

initDb()
  .then(() => {
    // 启动任务处理器
    try {
      require('./worker');
    } catch (e) {
      console.warn('⚠️  Worker 启动失败:', e.message);
    }

    app.listen(PORT, () => {
      console.log(`\n🚀 爆款文案工坊后端启动成功`);
      console.log(`   监听端口: ${PORT}`);
      console.log(`   健康检查: http://localhost:${PORT}/api/health\n`);
    });
  })
  .catch(err => {
    console.error('❌ 数据库初始化失败:', err?.message || err?.code || String(err));
    console.error('MYSQL_HOST:', process.env.MYSQL_HOST || '【未设置】');
    console.error('MYSQL_DATABASE:', process.env.MYSQL_DATABASE || process.env.MYSQL_DB || '【未设置】');
    process.exit(1);
  });
