# Traductor

基于 DeepSeek ASR 和 `deepseek-flash` 的桌面实时双语字幕工具。它用于在豆包额度耗尽后继续完成麦克风或浏览器标签页音频的中、英、西文互译，不依赖 Google 翻译。

翻译内容自动保存在浏览器 IndexedDB，支持历史恢复，并可导出 Markdown、TXT、SRT 和 JSON。

## 功能

- 麦克风、浏览器标签页或系统音频输入
- 中、英、西文目标语言，源语言自动识别
- VAD 静音断句，音频统一为 16 kHz 单声道 WAV
- DeepSeek ASR 与流式文本翻译
- 双并发请求、顺序校正、上游故障自动重试
- IndexedDB 自动保存、刷新恢复、失败段重试
- Markdown、TXT、双语 SRT、JSON 导出
- Worker 侧全局/IP 每日额度与并发限制

## 前置条件

- Windows、macOS 或 Linux 桌面环境
- Chrome 或 Edge 最新稳定版
- Node.js 24 与 npm 11
- DeepSeek API 账户和 API Key
- Cloudflare 账户
- GitHub 账户

移动浏览器通常无法捕获其他应用的系统音频，第一版不支持移动端。

## 本地开发

```bash
npm install
copy .dev.vars.example .dev.vars
```

在 `.dev.vars` 中填写：

```dotenv
DEEPSEEK_API_KEY=<deepseek-key>
```

启动 Worker：

```bash
npm run worker:dev
```

另开终端启动前端：

```bash
npm run dev
```

打开 `http://localhost:5173/traductor/`。本地 Vite 会把 `/api` 转发到 `http://127.0.0.1:8787`。

共享标签页音频时，选择目标标签页，并在 Chrome/Edge 的共享对话框中勾选“分享音频”。共享整个屏幕时，也必须启用系统音频共享。

## 部署 Cloudflare Worker

1. 登录 Cloudflare Wrangler：

   ```bash
   npx wrangler login
   ```

2. 首次部署会自动创建 `QuotaStore` Durable Object：

   ```bash
   npm run worker:deploy
   ```

3. 保存 DeepSeek Key。不要把 Key 写入仓库或 `.env` 后提交：

   ```bash
   npx wrangler secret put DEEPSEEK_API_KEY
   ```

4. 部署 Wrangler 会输出 `https://traductor-api.<account>.workers.dev`。将该地址设置为 GitHub 仓库变量 `VITE_WORKER_URL`。

5. 如 GitHub 用户名与通配符配置不匹配，修改 `wrangler.toml` 中的 `ALLOWED_ORIGINS`，明确加入：

   ```text
   https://<github-user>.github.io
   ```

额度默认值位于 `wrangler.toml`：

```toml
DAILY_GLOBAL_LIMIT = "600"
DAILY_IP_LIMIT = "120"
MAX_CONCURRENT_PER_IP = "2"
```

这些值按 UTC 自然日重置。公开接口不适合作为不限额公共代理；调整额度前应评估 DeepSeek 账户余额。

## 部署 GitHub Pages

1. 创建公开仓库 `traductor` 并推送 `main` 分支。
2. 在仓库 `Settings > Pages` 中将 Source 设置为 `GitHub Actions`。
3. 在 `Settings > Secrets and variables > Actions > Variables` 添加 `VITE_WORKER_URL`。
4. 推送代码后，`.github/workflows/deploy-pages.yml` 会自动测试、构建并发布。
5. 访问 `https://<github-user>.github.io/traductor/`。

Worker 使用独立的 `npm run worker:deploy` 部署。GitHub Actions 不保存 DeepSeek Key。

## 验证

```bash
npm run typecheck
npm run test:run
npm run build
$env:XDG_CONFIG_HOME = (Join-Path $PWD '.wrangler-local'); npm run worker:dry-run
```

首次真实使用时建议先用 10～20 秒清晰中英文语音测试，再检查：

- 浏览器网络面板不包含 DeepSeek API Key
- 当前记录在刷新后仍存在
- 导出的 SRT 时间轴正常
- Worker 配额耗尽后返回 `429`，且不会继续调用 DeepSeek

## 架构

```text
麦克风 / 标签页音频
        │
        ▼
AudioWorklet → 16 kHz 单声道 WAV → 能量 VAD
        │
        ▼
Cloudflare Worker ── Durable Object 配额
        │
        ├── DeepSeek ASR
        └── deepseek-flash 流式翻译
        │
        ▼
SSE 增量字幕 → IndexedDB 自动保存 → 文件导出
```

DeepSeek ASR 当前是整段文件接口，不支持流式识别，因此本项目是准实时字幕工具，延迟通常高于采用端到端流式模型的豆包同传。详细取舍见 [架构说明](docs/architecture.md)。

## 隐私

- 音频只在内存中组成片段并发送给 DeepSeek，本地不持久化音频。
- Worker 不记录音频、原文或译文正文。
- 翻译正文只保存在当前浏览器 IndexedDB。
- 清除站点数据会删除本机记录，请及时导出备份。
- 公开接口仍会把音频发送给 DeepSeek，使用前应了解对应服务的数据处理政策。

## License

[MIT](LICENSE)
