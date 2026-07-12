# package-lock.json 与 package.json 漂移（待修，不阻塞当前部署）

2026-07-12 发现：`npm ci --omit=dev` 在干净环境下失败，报 `ali-oss` 及其依赖树（address/agentkeepalive/urllib/xml2js 等 20+ 个包）"Missing ... from lock file"。说明 `ali-oss` 被加进 `package.json` 后，没有重新跑 `npm install` 更新 `package-lock.json` 就提交了。

**现状影响**：任何要求锁文件严格一致的安装方式（`npm ci`）在全新环境（CI、Docker、新同事拉代码）都会失败。当前 Dockerfile 临时用 `npm install --omit=dev` 绕过（宽松模式，会自动更新内存中的解析结果，不校验锁文件一致性）。

**正确修复**（找时间做，需要验证不引入意外的依赖版本跳变）：
```bash
cd backend
npm install          # 重新生成 package-lock.json，让它跟 package.json 对齐
git diff package-lock.json | head -50   # 过一眼，确认只是补齐 ali-oss 那棵树，没有意外升级别的包
git add package-lock.json
git commit -m "fix: sync package-lock.json (ali-oss deps were missing)"
```
修完后可以把 Dockerfile 的 `npm install --omit=dev` 换回 `npm ci --omit=dev`（更快、构建可复现）。
