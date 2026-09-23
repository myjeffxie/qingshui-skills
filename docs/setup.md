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

### 方式二：Skill目录下的 .env 文件

在skill目录下创建 `.env` 文件：

```
QINGSHUI_API_KEY=qs-your-api-key-here
QINGSHUI_BASE_URL=https://qingshui.hqqt.com
```

### 方式三：项目根目录的 .env 文件

在项目根目录创建 `.env` 文件（与上面的格式相同）。

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
- 图片：gemini-3.1-flash-image-preview, gpt-image-2, Doubao-Seedream-4.5, kling-image-o1
- 视频：kling-video-o1, Doubao-Seedance-2.0, jimeng-video-30-720p, jimeng-video-30-1080p, grok-imagine-video-1.5
