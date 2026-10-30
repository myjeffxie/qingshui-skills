# 青水 Skill (QINGSHUI)

青水AI营销创作平台 - 图片生成、视频生成、语音合成（TTS / 声音克隆）和静态资源分享（HTML/图片/文档）Skill

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
/qingshui audio --text "大家好，欢迎来到今天的课程" --model speech-2.8-turbo --emotion happy
/qingshui voices --gender female
/qingshui clone-voice --audio ./my_voice.mp3 --name 我的音色 --gender female
/qingshui share ./report.html --name 月度报告
/qingshui assets
/qingshui unshare <hash>
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
- `gpt-image-2.5-flare` (GG 2.5)
- `Doubao-Seedream-4.5`
- `Doubao-Seedream-5.0-lite`

### 视频生成
- `Doubao-Seedance-2.0` (默认)
- `Doubao-Seedance-2.0-mini`
- `Doubao-Seedance-1.5-pro`
- `grok-imagine-video-1.5` — 支持文生视频、参考图生成视频、首尾帧生成视频

### 语音生成（TTS）
- `speech-2.8-turbo` (默认) — 30 算力/百万字符
- `speech-2.8-hd` — 52.5 算力/百万字符
- `speech-2.6-turbo` / `speech-2.6-hd`

支持语速、音量、语调、情绪、样本率、码率、声道、音色调整与音效等参数；支持生成同步字幕文件（`--subtitle`，句级/词级时间戳）；支持上传音频样本克隆自定义音色（`clone-voice`），克隆后的 `voice_id` 可直接用于 `audio` 命令。

### 图片参考图用法

```bash
# 单张参考图；脚本会提交 reference_images，后端会按模型协议处理
/qingshui image "给图中的肥猫戴上眼镜" --model gpt-image-2.5-flare --reference https://example.com/cat.png

# 多参考图；支持逗号分隔，也可重复传 --reference-images
/qingshui image "融合两张参考图的风格" --model gpt-image-2.5-flare --reference-images https://example.com/a.png,https://example.com/b.png
```

### Grok Video 1.5 用法

`reference-to-video` 必须在提示词中用 `<IMAGE_0>` / `<IMAGE_1>` … 显式指定参考图：按 `--reference-images` 的顺序，第 1 张对应 `<IMAGE_0>`，第 2 张对应 `<IMAGE_1>`，以此类推。若不用 `<IMAGE_n>` 指代，模型可能忽略参考图、按文字自由生成人物。

```bash
# 文生视频
/qingshui video "电影感城市夜景航拍" --model grok-imagine-video-1.5 --grok-mode text-to-video

# 参考图生成视频（单张参考图：<IMAGE_0> 指定人物）
/qingshui video "保持人物形象<IMAGE_0>一致，她面向镜头，用自然的口型说：大家好，欢迎来到今天的课程。表情亲切，微微点头，镜头固定，半身构图" --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images https://example.com/person.jpg

# 参考图生成视频（多张参考图：<IMAGE_0> 指人物、<IMAGE_1> 指服装；逗号分隔，也可重复传 --reference-images）
/qingshui video "画面人物来自<IMAGE_0>，身穿<IMAGE_1>中的服装" --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images https://example.com/person.jpg,https://example.com/outfit.jpg

# 首尾帧生成视频；参考图与首尾帧互斥
/qingshui video "从首帧自然过渡到尾帧" --model grok-imagine-video-1.5 --grok-mode first-last-frame --image https://example.com/first.jpg --last-frame https://example.com/last.jpg
```

可选参数：`--voice-id` 或 `--reference-audio-voice-ids id1,id2` 可为 Grok 提供参考音频 voice_id。

## 静态资源分享

```bash
# HTML 默认自动内联本地 CSS/JS/图片；远程图片/脚本/样式会自动下载后内联
/qingshui share ./report.html --name 月度报告

# 图片（服务端会重新编码）
/qingshui share ./poster.png --name 活动海报

# 文档需服务端开启 share.allow_documents，默认关闭；仅作为附件下载
/qingshui share ./manual.pdf --name 产品手册

# 关闭自动内联 / 禁止脚本 / 不下载远程资源 / 保留内联 SVG 原样
/qingshui share ./page.html --no-bundle --no-scripts
/qingshui share ./page.html --no-fetch
/qingshui share ./page.html --keep-svg

/qingshui assets
/qingshui unshare <hash>
```

分享成功后返回 `https://qingshui.hqqt.com/{project_id}/{user_id}/{hash}.{ext}`。HTML 在 CSP sandbox iframe 中运行，脚本无法读取本站 Cookie/存储、跳转顶层或发起网络请求；取消分享后 URL 立即 404。

## License

MIT
