---
name: qingshui
description: 青水AI营销创作平台 - 提供图片生成和视频生成的AI能力。支持通过API Key调用，支持多种模型。
---

# SKILL: 青水 (QINGSHUI)

青水 ([https://qingshui.hqqt.com](https://qingshui.hqqt.com)) 是一个AI营销创作平台，提供图片生成和视频生成的AI能力。

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
/qingshui video "海浪轻轻拍打沙滩,夕阳缓缓落下" --model kling-video-o1 --duration 5

# 查询任务状态
/qingshui status <task_id>
```

## Actions

| Action | 用法 | 说明 |
|--------|------|------|
| `image` | `/qingshui image "提示词" [选项]` | 提交图片生成任务，异步等待返回结果 |
| `video` | `/qingshui video "提示词" [选项]` | 提交视频生成任务，异步等待返回结果 |
| `status` | `/qingshui status <task_id>` | 查询异步任务状态和结果 |

### `image` — 生成图片

**参数：**
- `prompt` (必需)：图片描述文本
- `--model`：模型名称，默认 `gemini-3.1-flash-image-preview`
  - 可选：`gemini-3.1-flash-image-preview`, `gpt-image-2`, `Doubao-Seedream-4.5`, `kling-image-o1`
- `--count`：生成数量(1-4)，默认 1
- `--aspect-ratio`：宽高比，默认 `16:9`
  - 可选：`1:1`, `16:9`, `9:16`, `4:3`, `3:4`
- `--negative-prompt`：负向提示词（不想要的内容）
- `--reference`：参考图片URL（图生图）

**示例：**
```
# 基础生图
/qingshui image "一只可爱的短毛猫"

# 指定比例和数量
/qingshui image "赛博朋克风格的都市夜景" --aspect-ratio 9:16 --count 2

# 指定模型
/qingshui image "油画风格的乡村风景" --model gpt-image-2
```

**算力消耗：** 每张图片消耗 1 算力。

### `video` — 生成视频

**参数：**
- `prompt` (必需)：视频描述文本
- `--model`：模型名称，默认 `kling-video-o1`
  - 可选：`kling-video-o1`, `Doubao-Seedance-2.0`, `jimeng-video-30-720p`
- `--duration`：视频时长(秒，1-10)，默认 5
- `--aspect-ratio`：宽高比，默认 `16:9`
  - 可选：`1:1`, `16:9`, `9:16`
- `--resolution`：分辨率，默认 `720p`
  - 可选：`720p`, `1080p`
- `--reference`：参考图片URL（图生视频）

**示例：**
```
# 基础生视频
/qingshui video "一只猫在草地上奔跑"

# 指定时长和比例
/qingshui video "海浪拍打岩石的慢动作" --duration 8 --aspect-ratio 9:16

# 图生视频
/qingshui video "让这张图片动起来" --reference https://example.com/cat.jpg --model Doubao-Seedance-2.0
```

**算力消耗：** 每秒约 1-2 算力（因模型而异）。

### `status` — 查询任务状态

**参数：**
- `task_id`：任务ID（由 image/video 命令返回）

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
5. **返回结果**：一旦完成，返回生成的图片/视频URL

## 错误处理

- `401` — API Key无效或已过期，提示用户在个人中心重新生成
- `402` — 算力不足，提示用户充值或等待下月重置
- `500` — 服务器错误，建议稍后重试

## 获取API Key

1. 登录 [青水平台](https://qingshui.hqqt.com)
2. 进入 **个人中心** → **API 密钥**
3. 点击「创建新密钥」，输入名称后保存
4. **立即复制**密钥（仅显示一次！）
5. 设置环境变量：`export QINGSHUI_API_KEY=qs-xxxx`
