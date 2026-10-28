# 青水 Skill 安装配置指南

## 前置条件

在使用青水Skill之前，你需要一个有效的API Key。如果你还没有，请按照以下步骤获取：

1. 访问 [青水平台](https://qingshui.hqqt.com) 并登录
2. 进入 **个人中心** → **API 密钥**
3. 点击「创建新密钥」，输入密钥名称（如"Claude Code"）
4. **立即复制密钥** — 它只会显示这一次！
5. 将密钥添加到你的环境变量中

## 配置方式

### 方式一：环境变量（推荐）

```bash
export QINGSHUI_API_KEY=qs-your-api-key-here
export QINGSHUI_BASE_URL=https://qingshui.hqqt.com  # 可选，使用默认值可省略
```

### 方式二：Skill 目录下的 .env 文件

在 skill 目录下创建 `.env` 文件（运行 `qingshui` 命令时自动加载）：

```
QINGSHUI_API_KEY=qs-your-api-key-here
QINGSHUI_BASE_URL=https://qingshui.hqqt.com
```

### 方式三：运行目录下的 .env 文件

在运行命令时所在目录创建 `.env` 文件（格式同上）。两个位置的 `.env` 都会被自动读取（skill 目录优先）；若同名变量已在 shell 中 `export`，环境变量优先。

## 验证配置

配置完成后，可以通过以下命令验证：

```bash
# 检查环境变量
echo $QINGSHUI_API_KEY
```

如果配置正确，你应该能看到以 `qs-` 开头的API Key。

## 常见问题

**Q: 我的API Key不小心泄露了怎么办？**
A: 立即登录青水平台，在个人中心的API密钥管理中找到该密钥并点击"撤销"，然后创建一个新的。

**Q: 显示"算力不足"怎么办？**
A: 算力是按月分配的。算力会在每月会员日自动重置，也可以联系管理员申请增加。

**Q: 支持哪些模型？**
A: 
- 图片：gemini-3.1-flash-image-preview, gpt-image-2.5-flare (GG 2.5), Doubao-Seedream-4.5, Doubao-Seedream-5.0-lite
- 视频：Doubao-Seedance-2.0 (默认), Doubao-Seedance-2.0-mini, Doubao-Seedance-1.5-pro, grok-imagine-video-1.5
- 语音：speech-2.8-turbo (默认), speech-2.8-hd, speech-2.6-turbo, speech-2.6-hd；并可上传音频样本克隆自定义音色

**Q: 声音克隆有什么要求？**
A: 音频样本支持 mp3 / m4a / wav 格式，时长 10 秒 ~ 5 分钟，大小不超过 20MB；克隆得到的 `voice_id` 可直接用于语音合成（`audio` 命令的 `--voice-id`），且仅本人可用。

**Q: 静态资源分享支持哪些文件？**
A: HTML、PNG/JPEG/GIF/WebP，以及服务端开启 `share.allow_documents` 后的 PDF/DOCX/XLSX/PPTX/TXT/MD/CSV。HTML 默认自动内联本地 CSS/JS/图片，远程图片/脚本/样式会自动下载后内联（`--no-fetch` 关闭）；SVG、iframe 等危险标签仍会被拒绝。文档默认关闭且只作为附件下载。
