---
name: qingshui
description: 青水AI营销创作平台 - 提供图片生成、视频生成和语音合成（TTS / 声音克隆）的AI能力。支持通过API Key调用，支持多种模型。
---

# SKILL: 青水 (QINGSHUI)

青水 ([https://qingshui.hqqt.com](https://qingshui.hqqt.com)) 是一个AI营销创作平台，提供图片生成、视频生成和语音合成（TTS / 声音克隆）的AI能力。

## 安全指南

1. **绝不暴露 API Key**：不要在聊天、代码、日志或命令参数中直接展示完整的API Key（格式为 `qs-xxx...`）。
2. API Key应在环境变量 `QINGSHUI_API_KEY` 中配置，或通过脚本自动注入。
3. 所有API调用应通过提供的 `api.js` 脚本进行，而不是直接使用 `curl` 或其他HTTP客户端。

## 配置

首先读取 `${CLAUDE_SKILL_DIR}/docs/setup.md` 了解如何配置API Key和Base URL。

### 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `QINGSHUI_API_KEY` | ✅ 是 | - | 从青水平台个人中心获取的API Key |
| `QINGSHUI_BASE_URL` | ❌ 否 | `https://qingshui.hqqt.com` | API服务地址 |

## 快速开始

```
# 生成图片
/qingshui image "一只可爱的布偶猫坐在窗台上，阳光洒落" --model gemini-3.1-flash-image-preview

# 生成视频
/qingshui video "海浪轻轻拍打沙滩,夕阳缓缓落下" --model Doubao-Seedance-2.0 --duration 5

# 生成语音（TTS）
/qingshui audio --text "大家好，欢迎来到今天的课程" --model speech-2.8-turbo --emotion happy

# 查看音色列表 / 克隆音色
/qingshui voices --gender female
/qingshui clone-voice --audio ./my_voice.mp3 --name 我的音色 --gender female

# Grok Video 1.5：参考图生成视频（在提示词中用 <IMAGE_0> 指定参考图人物）
/qingshui video "保持人物形象<IMAGE_0>一致，她面向镜头，用自然的口型说：大家好，欢迎来到今天的课程。表情亲切，微微点头，镜头固定，半身构图" --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images https://example.com/person.jpg

# 查询任务状态
/qingshui status <task_id>
```

## Actions

| Action | 用法 | 说明 |
|--------|------|------|
| `image` | `/qingshui image "提示词" [选项]` | 提交图片生成任务，异步等待返回结果 |
| `video` | `/qingshui video "提示词" [选项]` | 提交视频生成任务，异步等待返回结果 |
| `audio` | `/qingshui audio --text "文本" [选项]` | 提交语音合成（TTS）任务，异步等待返回结果 |
| `voices` | `/qingshui voices [选项]` | 查看可用音色列表（内置 + 本人克隆音色） |
| `clone-voice` | `/qingshui clone-voice --audio <文件> [选项]` | 上传音频样本克隆音色 |
| `delete-voice` | `/qingshui delete-voice <voice_id>` | 删除本人克隆的音色 |
| `status` | `/qingshui status <task_id>` | 查询异步任务状态和结果（`--type image\|video\|audio`） |

### `image` — 生成图片

**参数：**
- `prompt` (必需)：图片描述文本
- `--model`：模型名称，默认 `gemini-3.1-flash-image-preview`
  - 可选：`gemini-3.1-flash-image-preview`, `gpt-image-2.5-flare` (GG 2.5), `Doubao-Seedream-4.5`, `Doubao-Seedream-5.0-lite`
- `--count`：生成数量(1-4)，默认 1
- `--aspect-ratio`：宽高比，默认 `16:9`
  - 可选：`1:1`, `16:9`, `9:16`, `4:3`, `3:4`
- `--negative-prompt`：负向提示词（不想要的内容）
- `--reference`：参考图片URL（图生图，单张；会提交为 `reference_images`）
- `--reference-images`：多参考图URL，逗号分隔；也可重复传该参数

**示例：**
```
# 基础生图
/qingshui image "一只可爱的短毛猫"

# 指定比例和数量
/qingshui image "赛博朋克风格的都市夜景" --aspect-ratio 9:16 --count 2

# 指定模型
/qingshui image "油画风格的乡村风景" --model gpt-image-2.5-flare

# 使用参考图（GG 2.5 会由后端转为 multipart /v1/images/edits）
/qingshui image "给图中的肥猫戴上眼镜" --model gpt-image-2.5-flare --reference https://example.com/cat.png

# 多参考图（逗号分隔或重复传 --reference-images）
/qingshui image "融合两张参考图的风格" --model gpt-image-2.5-flare --reference-images https://example.com/a.png,https://example.com/b.png
```

**算力消耗：** 每张图片消耗 1 算力。

### `video` — 生成视频

**参数：**
- `prompt` (必需)：视频描述文本
- `--model`：模型名称，默认 `Doubao-Seedance-2.0`
  - 可选：`Doubao-Seedance-2.0`, `Doubao-Seedance-2.0-mini`, `Doubao-Seedance-1.5-pro`, `grok-imagine-video-1.5`
- `--duration`：视频时长(秒，1-10)，默认 5
- `--aspect-ratio`：宽高比，默认 `16:9`
  - 可选：`1:1`, `16:9`, `9:16`
- `--resolution`：分辨率，默认 `720p`
  - 可选：`720p`, `1080p`
- `--reference`：参考图片URL（图生视频）
- `--reference-images`：多参考图URL，逗号分隔；Grok `reference-to-video` 模式使用，需在提示词中用 `<IMAGE_0>`/`<IMAGE_1>`… 指代
- `--grok-mode`：Grok Video 1.5 生成模式
  - `text-to-video`：文生视频，不提交图片素材
  - `reference-to-video`：参考图生成视频，提交 `reference_images`
  - `first-last-frame`：首尾帧生成视频，提交 `image` / `last_frame`
- `--image`：Grok 首尾帧模式的首帧图片URL
- `--last-frame`：Grok 首尾帧模式的尾帧图片URL
- `--voice-id`：Grok 参考音频 voice_id（可选）
- `--reference-audio-voice-ids`：Grok 多个参考音频 voice_id，逗号分隔（可选）

**Grok Video 1.5 说明：**
- `reference-to-video` 与 `first-last-frame` 互斥，脚本会在本地校验，避免同时提交参考图和首尾帧。
- 如果未显式传 `--grok-mode`，脚本会根据参数自动推断：有 `--image`/`--last-frame` 为首尾帧，有 `--reference`/`--reference-images` 为参考图，否则为文生视频。
- **`reference-to-video` 必须在提示词中用 `<IMAGE_0>` / `<IMAGE_1>` … 显式指定参考图**：按 `--reference-images` 的顺序，第 1 张对应 `<IMAGE_0>`，第 2 张对应 `<IMAGE_1>`，以此类推。若提示词中不用 `<IMAGE_n>` 指代，模型可能忽略参考图、按文字自由生成人物。

**示例：**
```
# 基础生视频
/qingshui video "一只猫在草地上奔跑"

# 指定时长和比例
/qingshui video "海浪拍打岩石的慢动作" --duration 8 --aspect-ratio 9:16

# 图生视频
/qingshui video "让这张图片动起来" --reference https://example.com/cat.jpg --model Doubao-Seedance-2.0

# Grok 文生视频
/qingshui video "电影感航拍未来城市夜景，霓虹灯闪烁" --model grok-imagine-video-1.5 --grok-mode text-to-video

# Grok 参考图生成视频（单张参考图：<IMAGE_0> 指定人物）
/qingshui video "保持人物形象<IMAGE_0>一致，她面向镜头，用自然的口型说：大家好，欢迎来到今天的课程。表情亲切，微微点头，镜头固定，半身构图" --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images https://example.com/person.jpg

# Grok 参考图生成视频（多张参考图：<IMAGE_0> 指人物、<IMAGE_1> 指服装）
/qingshui video "画面人物来自<IMAGE_0>，身穿<IMAGE_1>中的服装，向镜头微笑走来" --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images https://example.com/person.jpg,https://example.com/outfit.jpg

# Grok 首尾帧生成视频（复用现有首尾帧能力）
/qingshui video "从首帧自然转场到尾帧，动作流畅" --model grok-imagine-video-1.5 --grok-mode first-last-frame --image https://example.com/first.jpg --last-frame https://example.com/last.jpg
```

**算力消耗：** 每秒约 1-2 算力（因模型而异）。

### `audio` — 生成语音（TTS）

**参数：**
- `text` (必需)：待合成文本（最多 50000 字符），用 `--text` 指定，也可直接作为位置参数传入
- `--model`：TTS 模型，默认 `speech-2.8-turbo`
  - 可选：`speech-2.8-turbo`, `speech-2.8-hd`, `speech-2.6-turbo`, `speech-2.6-hd`
- `--voice-id`：音色 ID，默认 `zh_male_M392_conversation_wvae_bigtts`（可用 `voices` 命令查看全部音色）
- `--format`：输出格式，默认 `mp3`；可选 `mp3`, `wav`, `flac`, `pcm`
- `--speed`：语速，0.5 ~ 2.0
- `--vol`：音量，0.1 ~ 10
- `--pitch`：语调，-12 ~ 12
- `--emotion`：情绪，可选 `fluent`, `calm`, `happy`, `sad`, `angry`, `fearful`, `disgusted`, `surprised`
- `--text-normalization`：开启文本规范化（数字、符号读音更自然）
- `--sample-rate`：采样率，可选 8000 / 16000 / 22050 / 24000 / 32000 / 44100（默认 32000）
- `--bitrate`：码率，32000 ~ 320000（默认 128000）
- `--channel`：声道数，1（单声道，默认）或 2（双声道）
- `--vm-pitch` / `--vm-intensity` / `--vm-timbre`：音色调整，取值 -100 ~ 100
- `--vm-sound-effects`：音效，可选 `spacious_echo`, `auditorium_echo`, `lofi_telephone`, `robotic`

**示例：**
```
# 基础语音合成
/qingshui audio --text "大家好，欢迎来到今天的课程"

# 指定音色、情绪与语速
/qingshui audio --text "今天心情特别好" --voice-id zh_female_xxx --emotion happy --speed 1.2

# 高清模型 + 双声道 wav 输出
/qingshui audio --text "欢迎收听本节目" --model speech-2.8-hd --format wav --channel 2
```

**算力消耗：** 按文本字符数计费（Turbo 30 算力/百万字符，HD 52.5 算力/百万字符），单次最低 1 算力。

### `voices` — 音色列表

**参数：**
- `--gender`：按性别筛选，可选 `male` / `female` / `unknown`
- `--custom-only`：仅显示本人克隆音色
- `--q`：按名称/描述关键字搜索

**示例：**
```
/qingshui voices
/qingshui voices --gender female --q 客服
/qingshui voices --custom-only
```

### `clone-voice` — 克隆音色

**参数：**
- `--audio` (必需)：音频样本文件路径（本地文件），支持 `mp3` / `m4a` / `wav`，时长 10 秒 ~ 5 分钟，大小 ≤ 20MB
- `--name`：音色名称（默认取文件名）
- `--gender`：音色性别，可选 `male` / `female`
- `--icon`：音色图标文件路径（`png` / `jpg` / `webp` / `gif`，≤ 2MB）
- `--preview-text`：自定义试听文本

**示例：**
```
/qingshui clone-voice --audio ./my_voice.mp3 --name 我的音色 --gender female
/qingshui clone-voice --audio ./sample.wav --name 客服音色 --icon ./avatar.png --preview-text "您好，很高兴为您服务"
```

**返回：** `voice_id`，可直接用于 `audio` 命令的 `--voice-id`。

### `delete-voice` — 删除克隆音色

**参数：**
- `voice_id` (必需)：要删除的音色 ID（仅能删除本人克隆的音色）

**示例：**
```
/qingshui delete-voice clone_wodeyinse_1_1730000000000000000
```

### `status` — 查询任务状态

**参数：**
- `task_id`：任务ID（由 image/video/audio 命令返回）
- `--type`：任务类型，可选 `image`(默认) / `video` / `audio`

**返回状态：**
- `pending`：等待处理
- `processing`：正在生成（含进度百分比）
- `completed`：已完成（包含结果URL）
- `failed`：生成失败（包含错误信息）

## 执行流程

1. **检查配置**：如果首次使用，引导用户设置 `QINGSHUI_API_KEY`
2. **解析参数**：根据action类型验证必需参数和可选参数
3. **提交任务**：调用 `scripts/api.js` 提交生成任务，获取 `task_id`
4. **轮询等待**：每3秒轮询一次任务状态，直到完成或超时（最长10分钟）
5. **返回结果**：一旦完成，返回生成的图片 / 视频 / 音频URL

## 错误处理

- `401` — API Key无效或已过期，提示用户在个人中心重新生成
- `402` — 算力不足，提示用户充值或等待下月重置
- `403` — 无权使用该音色（该 voice_id 属于其他用户的克隆音色）
- `500` — 服务器错误，建议稍后重试

## 获取API Key

1. 登录 [青水平台](https://qingshui.hqqt.com)
2. 进入 **个人中心** → **API 密钥**
3. 点击「创建新密钥」，输入名称后保存
4. **立即复制**密钥（仅显示一次！）
5. 设置环境变量：`export QINGSHUI_API_KEY=qs-xxxx`
