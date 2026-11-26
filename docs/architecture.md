# 架构说明

## 数据流

1. 浏览器通过 `getUserMedia` 或 `getDisplayMedia` 获取音频。
2. AudioWorklet 把音频送入主线程，重采样为 16 kHz 单声道 PCM。
3. `VoiceSegmenter` 使用 20 ms 帧能量判断语音，500 ms 静音后结束当前片段；片段最长 10 秒。
4. 片段编码为 16-bit PCM WAV，由前端按顺序加入最多 2 个并发任务的队列。
5. Worker 校验 CORS、WAV 结构和时长，然后通过 Durable Object 申请一次全局与 IP 配额。
6. Worker 调用 DeepSeek ASR，先把原文作为 `source` SSE 事件发送给前端。
7. Worker 调用 `deepseek-flash` 流式翻译，把增量内容作为 `translation` 事件转发，结束时发送 `done`。
8. 前端立即把原文写入 IndexedDB，翻译完成后更新完整译文；UI 中间增量只保存在内存。

## API

### `POST /api/interpret`

`multipart/form-data`：

- `audio`：16-bit PCM WAV，最多 2 MiB、10 秒
- `targetLanguage`：`zh`、`en` 或 `es`
- `context`：最近两段 JSON 数组

成功响应为 `text/event-stream`：

```text
event: source
data: {"type":"source","text":"..."}

event: translation
data: {"type":"translation","text":"..."}

event: done
data: {"type":"done","latencyMs":1234}
```

错误可能以非 2xx JSON 返回，也可能在流建立后通过 `event: error` 返回。

### `POST /api/translate`

用于保存后的失败段重试，不需要重新上传音频：

```json
{
  "text": "source text",
  "targetLanguage": "zh",
  "context": []
}
```

响应同样使用 `translation`、`done` 和 `error` SSE 事件。

## 配额

全局配额在单个 `QuotaStore` Durable Object 中串行处理，避免 KV 并发写入导致明显超限。每次请求先占用一个日额度和一个 IP 活跃槽，请求结束或断开时释放活跃槽。

配额按 UTC 日期重置。上游失败仍消耗当日请求计数，以避免公开接口被重试攻击。

## 浏览器限制

- `getDisplayMedia` 必须由用户手势触发。
- Chrome/Edge 共享标签页时需要显式勾选“分享音频”。
- 浏览器无法在后台静默获取任意应用的全局音频。
- 浏览器不能静默写任意磁盘文件，因此自动保存使用 IndexedDB，文件导出需要用户点击。
