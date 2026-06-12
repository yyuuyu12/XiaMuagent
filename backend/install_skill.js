// 一次性 Skill 安装脚本：用登录 token 调线上接口，写入主 Skill / 题材包 / 禁区词。
// 用法：
//   1. 浏览器登录 https://www.yyagent.top，F12 → Application → Local Storage → 复制 wf_token 的值
//   2. PowerShell 执行：
//        $env:WF_TOKEN="粘贴token"; node install_skill.js
//   （可选 $env:WF_BASE="https://www.yyagent.top" 覆盖默认域名）
//
// 安全：token 是短期凭据、仅作用于你自己的账号；脚本不落盘、不上传任何东西。
const fs = require('fs');
const path = require('path');

const BASE = (process.env.WF_BASE || 'https://www.yyagent.top').replace(/\/+$/, '');
const TOKEN = (process.env.WF_TOKEN || '').trim();
const DOCS = path.join(__dirname, '..', 'docs', 'Skill初始化');

const FORBIDDEN = [
  '家人们','宝子','姐妹们','绝绝子','yyds','今天来分享','大家好我是',
  '首先','其次','综上所述','总而言之','赋能','抓手','闭环','颗粒度',
  '不容错过','干货满满','记得点赞关注','我们下期再见',
];

function readDoc(name) {
  const raw = fs.readFileSync(path.join(DOCS, name), 'utf8');
  // 去掉文档顶部的引导注释（> 开头的说明行）与首个一级标题，保留正文规则
  return raw.replace(/^# .*$/m, '').split('\n').filter(l => !l.trim().startsWith('> 适用') && !l.trim().startsWith('> 挂载')).join('\n').trim();
}

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

(async () => {
  if (!TOKEN) { console.error('✗ 缺少 WF_TOKEN，请先设置环境变量'); process.exit(1); }

  // 0) 验证 token
  const me = await api('GET', '/api/auth/me');
  if (me.status !== 200) { console.error('✗ token 无效或已过期：', me.data.msg || me.status); process.exit(1); }
  console.log('✓ 已登录：', (me.data.data && (me.data.data.nickname || me.data.data.phone)) || '当前账号');

  // 1) 主 Skill（freeText 模式，不动已有 rules）
  const mainText = readDoc('主Skill-口播创作总纲.md');
  const r1 = await api('PUT', '/api/original/skill', { freeText: mainText });
  console.log(r1.status === 200 ? `✓ 主 Skill 已写入（${mainText.length} 字，版本 ${r1.data.data && r1.data.data.version}）` : `✗ 主 Skill 失败：${r1.data.msg}`);

  // 2) 禁区词（GET 现有 → 合并 → 全量 PUT，保留 rules/keywords）
  const cur = await api('GET', '/api/original/skill');
  const curSkill = cur.data.data || {};
  const curForbidden = Array.isArray(curSkill.forbidden) ? curSkill.forbidden : [];
  const mergedForbidden = [...new Set([...curForbidden, ...FORBIDDEN])];
  const r2 = await api('PUT', '/api/original/skill', {
    rules: curSkill.rules || {},
    keywords: curSkill.keywords || [],
    forbidden: mergedForbidden,
    checkPrompt: curSkill.checkPrompt || curSkill.check_prompt || null,
  });
  console.log(r2.status === 200 ? `✓ 禁区词已写入（共 ${mergedForbidden.length} 个）` : `✗ 禁区词失败：${r2.data.msg}`);

  // 3) 题材包：AI工具与超级个体（已存在同名则跳过，避免重复）
  const packs = await api('GET', '/api/original/packs');
  const existing = (packs.data.data || []).find(p => p.name === 'AI工具与超级个体');
  const packContent = readDoc('题材包-AI工具与超级个体.md');
  if (existing) {
    const r3 = await api('PUT', '/api/original/packs/' + existing.id, { name: 'AI工具与超级个体', content: packContent });
    console.log(r3.status === 200 ? '✓ 题材包「AI工具与超级个体」已更新（同名已存在）' : `✗ 题材包失败：${r3.data.msg}`);
  } else {
    const r3 = await api('POST', '/api/original/packs', { name: 'AI工具与超级个体', content: packContent });
    console.log(r3.status === 200 ? `✓ 题材包「AI工具与超级个体」已创建（${packContent.length} 字）` : `✗ 题材包失败：${r3.data.msg}`);
  }

  console.log('\n完成。刷新桌面版「我的 Skill」即可看到；题材包记得在项目简介里挂载到具体项目。');
  process.exit(0);
})().catch(e => { console.error('✗ 异常：', e.message); process.exit(1); });
