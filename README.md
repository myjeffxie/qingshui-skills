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

## License

MIT
