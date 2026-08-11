#!/usr/bin/env node
/**
 * 青水 Skill 安装脚本
 * 用法：npx @qingshui/skill
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('\n🔧 青水 Skill 安装向导\n');
  console.log('这个脚本将帮助你配置青水 Skill 的环境变量。');

  // 检查是否已有配置
  const currentKey = process.env.QINGSHUI_API_KEY || '';
  if (currentKey) {
    console.log(`✅ 检测到已有 QINGSHUI_API_KEY 配置: ${currentKey.substring(0, 10)}...`);
    const update = await ask('是否要更新配置？(y/N): ');
    if (update.toLowerCase() !== 'y') {
      console.log('✅ 安装完成，配置未更改。');
      rl.close();
      return;
    }
  }

  console.log('\n📋 请按以下步骤获取你的API Key:');
  console.log('  1. 访问 https://qingshui.hqqt.com 并登录');
  console.log('  2. 进入 个人中心 → API 密钥');
  console.log('  3. 点击「创建新密钥」');
  console.log('  4. 复制生成的密钥 (格式: qs-xxxx...)\n');

  const apiKey = await ask('请输入你的 API Key: ');

  if (!apiKey.startsWith('qs-')) {
    console.log('⚠️ 警告: API Key 通常以 "qs-" 开头，请确认是否正确');
  }

  const shell = process.env.SHELL || '/bin/bash';
  const rcFile = shell.includes('zsh') ? '.zshrc' : '.bashrc';
  const rcPath = path.join(process.env.HOME || '~', rcFile);

  console.log(`\n📝 将配置写入 ${rcPath}...`);

  try {
    let content = fs.readFileSync(rcPath, 'utf-8');
    const marker = '# 青水 Skill 配置';
    const newLines = [
      '',
      marker,
      `export QINGSHUI_API_KEY=${apiKey}`,
      '# export QINGSHUI_BASE_URL=https://qingshui.hqqt.com  # 可选',
      '',
    ].join('\n');

    if (content.includes(marker)) {
      content = content.replace(
        new RegExp(`${marker}[\\s\\S]*?(?=\\n# (?!青水)|$)`, 'm'),
        newLines.trim()
      );
    } else {
      content += newLines;
    }

    fs.writeFileSync(rcPath, content);
    console.log(`✅ 配置已写入 ${rcPath}`);
    console.log(`\n请执行以下命令使配置生效:`);
    console.log(`  source ${rcPath}`);
    console.log(`\n或重新打开终端窗口。`);
  } catch (err) {
    console.error(`\n❌ 写入配置文件失败: ${err.message}`);
    console.log('\n请手动添加以下内容到你的shell配置文件:');
    console.log(`\nexport QINGSHUI_API_KEY=${apiKey}`);
    console.log('# export QINGSHUI_BASE_URL=https://qingshui.hqqt.com\n');
  }

  console.log('\n🎉 安装完成！现在你可以在 Claude Code / Codex 中使用 /qingshui 命令了。');
  rl.close();
}

main();
