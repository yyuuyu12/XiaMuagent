FROM node:20-alpine

WORKDIR /app

# 先只拷依赖清单，能命中 Docker 层缓存，改代码不改依赖时不用重装
# 用 npm install 而非 npm ci —— package-lock.json 目前跟 package.json 有漂移
# （缺 ali-oss 等依赖，见仓库根目录 LOCKFILE-DRIFT.md），ci 的严格校验会直接失败。
# 找时间重新生成锁文件提交后可以换回 npm ci（更快更可复现）。
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# 再拷全部源码
COPY . .

# 前端是纯拼接（frontend/src/*.html 片段 -> public/index.html），
# public/ 里已有构建产物但重新跑一遍确保跟 src 同步，零逻辑改动
RUN npm run build:fe

ENV NODE_ENV=production
# 不写死 EXPOSE 端口——server.js 读 process.env.PORT，由 Zeabur 平台注入

CMD ["node", "server.js"]
