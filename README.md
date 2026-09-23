# 青水 Skill (QINGSHUI)

青水AI营销创作平台 - 图片生成和视频生成 Skill

## 安装

### 方式一：npx 一键安装（推荐）

```bash
npx @qingshuiai/skill
```

安装向导会引导你配置 API Key。

### 方式二：环境变量配置

```bash
export QINGSHUI_API_KEY=qs-your-api-key-here
export QINGSHUI_BASE_URL=https://qingshui.hqqt.com
```

## 使用

### 在 Claude Code / Codex 中使用

安装后，直接在对话中使用：

```
/qingshui image "一只可爱的猫咪坐在窗台上" --aspect-ratio 1:1
/qingshui video "海浪拍打岩石" --duration 5
/qingshui video "从首帧自然过渡到尾帧" --model grok-imagine-video-1.5 --grok-mode first-last-frame --image https://example.com/first.jpg --last-frame https://example.com/last.jpg
/qingshui status <task_id>
```

## 获取 API Key

1. 访问 [青水平台](https://qingshui.hqqt.com)
2. 登录后进入 **个人中心** → **API 密钥**
3. 点击「创建新密钥」
4. 复制密钥并设置环境变量

## 支持的模型

### 图片生成
- `gemini-3.1-flash-image-preview` (默认)
- `gpt-image-2`
- `Doubao-Seedream-4.5`
- `Doubao-Seedream-5.0-lite`

### 视频生成
- `Doubao-Seedance-2.0` (默认)
- `Doubao-Seedance-2.0-mini`
- `Doubao-Seedance-1.5-pro`
- `grok-imagine-video-1.5` — 支持文生视频、参考图生成视频、首尾帧生成视频

### Grok Video 1.5 用法

```bash
# 文生视频
/qingshui video "电影感城市夜景航拍" --model grok-imagine-video-1.5 --grok-mode text-to-video

# 参考图生成视频；多张图片用逗号分隔，也可重复传 --reference-images
/qingshui video "保持人物一致，缓慢走向镜头" --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images https://example.com/person.jpg,https://example.com/outfit.jpg

# 首尾帧生成视频；参考图与首尾帧互斥
/qingshui video "从首帧自然过渡到尾帧" --model grok-imagine-video-1.5 --grok-mode first-last-frame --image https://example.com/first.jpg --last-frame https://example.com/last.jpg
```

可选参数：`--voice-id` 或 `--reference-audio-voice-ids id1,id2` 可为 Grok 提供参考音频 voice_id。

## License

MIT
