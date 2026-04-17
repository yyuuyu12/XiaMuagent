require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const initDb = require('./initDb');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '20mb' })); // 克隆音色需要传 base64 音频（~1-3MB）

const { router: authRouter } = require('./routes/auth');
const configRouter  = require('./routes/config');
const aiRouter      = require('./routes/ai');
const extractRouter = require('./routes/extract');
const historyRouter = require('./routes/history');
const codesRouter   = require('./routes/codes');
const douyinRouter  = require('./routes/douyinToText');
const inspireRouter = require('./routes/inspire');
const tasksRouter   = require('./routes/tasks');

app.use('/api/auth',    authRouter);
app.use('/api/config',  configRouter);
app.use('/api/ai',      aiRouter);
app.use('/api/extract', extractRouter);
app.use('/api/history', historyRouter);
app.use('/api/codes',   codesRouter);
app.use('/api/video',   douyinRouter);
app.use('/api/inspire', inspireRouter);
app.use('/api/tasks',   tasksRouter);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => res.json({ code: 200, msg: 'ok', time: new Date().toISOString() }));
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
