/**
 * 阿里云 OSS 工具模块
 * 配置项从 system_config 表读取：
 *   oss_region          例：oss-cn-hangzhou
 *   oss_access_key_id
 *   oss_access_key_secret
 *   oss_bucket
 *   oss_cdn_domain      例：https://cdn.example.com（可选，填了用CDN，否则用OSS原始域名）
 *   oss_video_limit     每用户最多保留视频数，默认 10
 */

const OSS = require('ali-oss');
const db = require('./db');

// 每次读配置时缓存 60s，避免频繁查库
let _ossClient = null;
let _ossConfig = null;
let _ossExpires = 0;

async function getOssConfig() {
  const now = Date.now();
  if (_ossConfig && now < _ossExpires) return _ossConfig;

  const res = await db.query(
    `SELECT config_key, value FROM system_config WHERE config_key IN ('oss_region','oss_access_key_id','oss_access_key_secret','oss_bucket','oss_cdn_domain','oss_video_limit')`
  );
  const map = {};
  for (const r of (res.rows || [])) map[r.config_key] = r.value;

  _ossConfig = map;
  _ossClient = null; // 配置变了，清掉旧 client
  _ossExpires = now + 60 * 1000;
  return map;
}

async function getClient() {
  const cfg = await getOssConfig();
  if (!cfg.oss_region || !cfg.oss_access_key_id || !cfg.oss_access_key_secret || !cfg.oss_bucket) {
    return null; // OSS 未配置
  }
  if (!_ossClient) {
    _ossClient = new OSS({
      region: cfg.oss_region,
      accessKeyId: cfg.oss_access_key_id,
      accessKeySecret: cfg.oss_access_key_secret,
      bucket: cfg.oss_bucket,
      timeout: 120000,
    });
  }
  return _ossClient;
}

/**
 * 把 Buffer 上传到 OSS
 * @param {string} ossKey  例：videos/42/abc123.mp4
 * @param {Buffer} buf
 * @returns {string} 可访问的公网 URL
 */
async function uploadBuffer(ossKey, buf) {
  const client = await getClient();
  if (!client) throw new Error('OSS 未配置');
  const cfg = await getOssConfig();

  await client.put(ossKey, buf, {
    headers: {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=2592000', // 30天浏览器缓存
    },
  });

  // 优先用 CDN 域名
  if (cfg.oss_cdn_domain) {
    const domain = cfg.oss_cdn_domain.replace(/\/$/, '');
    return `${domain}/${ossKey}`;
  }
  // 否则用 OSS 原始 URL
  return `https://${cfg.oss_bucket}.${cfg.oss_region}.aliyuncs.com/${ossKey}`;
}

/**
 * 删除 OSS 上的文件（静默失败，不影响主流程）
 */
async function deleteKey(ossKey) {
  try {
    const client = await getClient();
    if (!client) return;
    await client.delete(ossKey);
  } catch (e) {
    console.warn('[OSS] delete failed:', ossKey, e.message);
  }
}

/**
 * 检查 OSS 是否已配置
 */
async function isConfigured() {
  const cfg = await getOssConfig();
  return !!(cfg.oss_region && cfg.oss_access_key_id && cfg.oss_access_key_secret && cfg.oss_bucket);
}

/**
 * 每用户最多保留 N 条视频
 * 上传新视频前调用此函数：超出限额时删除最旧的
 * @param {number} userId
 * @param {number} limit  默认 10
 */
async function enforceUserLimit(userId, limit = 10) {
  const cfg = await getOssConfig();
  const maxVideos = parseInt(cfg.oss_video_limit) || limit;

  // 查出该用户所有视频，按创建时间升序（最旧在前）
  const { rows } = await db.query(
    `SELECT id, oss_key FROM user_videos WHERE user_id = ? ORDER BY created_at ASC`,
    [userId]
  );

  if (rows.length < maxVideos) return; // 未超限，不处理

  // 需要删掉 rows.length - maxVideos + 1 条（+1 留给即将插入的新视频）
  const toDelete = rows.slice(0, rows.length - maxVideos + 1);
  for (const row of toDelete) {
    await deleteKey(row.oss_key);
    await db.query(`DELETE FROM user_videos WHERE id = ?`, [row.id]);
    console.log(`[OSS] 清理旧视频 user=${userId} key=${row.oss_key}`);
  }
}

module.exports = { uploadBuffer, deleteKey, isConfigured, enforceUserLimit, getOssConfig };
