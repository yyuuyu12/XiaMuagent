# 项目配置信息

## 代码仓库
- GitHub: yyuuyu12/XiaMuagent
- 部署平台: Zeabur（自动从 GitHub 部署）

## 项目结构
```
XiaMuagent/
├── backend/                ← Zeabur 部署的全部内容
│   ├── server.js           ← 入口，启动 Express
│   ├── db.js               ← MySQL 连接池
│   ├── initDb.js           ← 建表+初始数据
│   ├── package.json
│   ├── public/
│   │   └── index.html      ← H5 前端页面（唯一编辑点）
│   └── routes/             ← API 路由
├── miniprogram/            ← 微信小程序代码
└── docs/                   ← 需求/设计文档
```

## ⚠️ 重要规则
- H5 前端唯一编辑文件：`backend/public/index.html`
- 根目录已不再有 content-creator-app.html，不要重建它
- 改完直接 git add + git push，Zeabur 自动部署

## 服务器信息（阿里云，已弃用）
- 服务器IP：106.14.151.37
- Web服务器：Nginx 1.20.1
