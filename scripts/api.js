#!/usr/bin/env node
/**
 * 青水 API 调用脚本
 * 用于生成图片和视频，异步轮询获取结果
 */

const https = require('https');

function getConfig() {
  const apiKey = process.env.QINGSHUI_API_KEY || '';
  const rawBaseUrl = (process.env.QINGSHUI_BASE_URL || 'https://qingshui.hqqt.com').replace(/\/+$/, '');

  if (!apiKey) {
    console.error('❌ 错误：未设置 QINGSHUI_API_KEY 环境变量');
    console.error('请执行: export QINGSHUI_API_KEY=qs-your-key');
    process.exit(1);
  }

  // 强制 HTTPS
  const url = new URL(rawBaseUrl);
  if (url.protocol !== 'https:') {
    console.error('❌ 安全错误：QINGSHUI_BASE_URL 必须使用 HTTPS 协议');
    console.error('当前: ' + rawBaseUrl);
    process.exit(1);
  }

  // 域名白名单：仅允许 qingshui.hqqt.com 及其子域名
  const allowedHosts = ['qingshui.hqqt.com'];
  if (!allowedHosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    console.error('❌ 安全错误：QINGSHUI_BASE_URL 域名不在白名单中');
    console.error('域名: ' + url.hostname);
    console.error('允许: ' + allowedHosts.join(', '));
    process.exit(1);
  }

  return { apiKey, baseUrl: rawBaseUrl };
}

function apiRequest(method, path, data = null) {
  const { apiKey, baseUrl } = getConfig();
  const url = new URL(path, baseUrl);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
    },
  };
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (chunk) => (chunks += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(chunks) }); }
        catch (e) { resolve({ status: res.statusCode, data: { error: chunks } }); }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

async function generateImage(prompt, options = {}) {
  const { model = 'gemini-3.1-flash-image-preview', count = 1, aspectRatio = '16:9', negativePrompt = '', referenceImages = [] } = options;
  console.log(`🎨 提交图片生成: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);
  const result = await apiRequest('POST', '/api/v1/images/generate', {
    prompt, model, image_count: count, aspect_ratio: aspectRatio,
    negative_prompt: negativePrompt, reference_images: referenceImages,
  });
  if (result.status === 200 && result.data.success) {
    console.log(`✅ 任务已提交: ${result.data.task_id} (消耗 ${result.data.quota_cost} 算力)`);
    return result.data;
  }
  throw new Error(`提交失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function generateVideo(prompt, options = {}) {
  const { model = 'Doubao-Seedance-2.0', duration = 5, aspectRatio = '16:9', resolution = '720p', referenceImage = '' } = options;
  console.log(`🎬 提交视频生成: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);
  const result = await apiRequest('POST', '/api/v1/videos/generate', {
    prompt, model, duration, aspect_ratio: aspectRatio, resolution, reference_image: referenceImage,
  });
  if (result.status === 200 && result.data.success) {
    console.log(`✅ 任务已提交: ${result.data.task_id} (消耗 ${result.data.quota_cost} 算力)`);
    return result.data;
  }
  throw new Error(`提交失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function queryTask(taskId, taskType = 'image') {
  const endpoint = taskType === 'video' ? `/api/v1/videos/${taskId}` : `/api/v1/images/${taskId}`;
  const result = await apiRequest('GET', endpoint);
  if (result.status === 200 && result.data.success) return result.data.task;
  throw new Error(`查询失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function waitForTask(taskId, taskType = 'image', maxWaitMs = 600000) {
  const startTime = Date.now();
  const pollInterval = 3000;
  let dots = 0;
  process.stdout.write(`⏳ 等待任务完成 ${taskId} `);
  while (Date.now() - startTime < maxWaitMs) {
    const task = await queryTask(taskId, taskType);
    if (task.status === 'completed') {
      process.stdout.write('\n✅ 任务完成!\n');
      return task;
    }
    if (task.status === 'failed') {
      process.stdout.write('\n❌ 任务失败!\n');
      throw new Error(`任务失败: ${task.error_msg || '未知错误'}`);
    }
    dots = (dots + 1) % 4;
    process.stdout.write(`\r⏳ 等待中 ${taskId} [${task.status}, ${task.progress}%]${'.'.repeat(dots)}  `);
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  process.stdout.write('\n⏱️ 等待超时\n');
  throw new Error(`任务等待超时 (${maxWaitMs / 1000}秒)`);
}

function extractPrompt(args) {
  // 检查是否通过 --prompt 显式指定
  const promptIdx = args.indexOf('--prompt');
  if (promptIdx >= 0 && promptIdx + 1 < args.length) {
    return args[promptIdx + 1];
  }
  // 没有 --prompt 时：收集非选项的非参数值部分作为 prompt
  // 正确跳过每个 --key 及其对应的 value
  const result = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      // 跳过参数名
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        i++; // 也跳过参数值
      }
    } else {
      result.push(args[i]);
    }
  }
  return result.join(' ');
}

function parseOptions(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      result[key] = isNaN(val) ? val : Number(val);
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'image': {
      const prompt = extractPrompt(args.slice(1));
      if (!prompt) { console.error('用法: node api.js image --prompt "描述" [选项]'); process.exit(1); }
      const options = parseOptions(args.slice(1));
      try {
        const r = await generateImage(prompt, options);
        const t = await waitForTask(r.task_id, 'image', 600000);
        if (t.result && t.result.images) {
          console.log('\n📷 生成的图片:');
          t.result.images.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
        }
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'video': {
      const prompt = extractPrompt(args.slice(1));
      if (!prompt) { console.error('用法: node api.js video --prompt "描述" [选项]'); process.exit(1); }
      const options = parseOptions(args.slice(1));
      try {
        const r = await generateVideo(prompt, options);
        const t = await waitForTask(r.task_id, 'video', 600000);
        if (t.result && t.result.video_url) console.log(`\n🎬 视频: ${t.result.video_url}`);
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'status': {
      const taskId = args[1];
      if (!taskId) { console.error('用法: node api.js status <task_id> [--type image]'); process.exit(1); }
      const options = parseOptions(args.slice(2));
      try {
        const t = await queryTask(taskId, options.type || 'image');
        console.log(JSON.stringify(t, null, 2));
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    default:
      console.log(`青水 API 调用脚本

用法:
  node api.js image --prompt "提示词" [选项]    生成图片
  node api.js video --prompt "提示词" [选项]    生成视频
  node api.js status <task_id> [--type image]   查询任务

环境变量: QINGSHUI_API_KEY (必需), QINGSHUI_BASE_URL (可选)`);
  }
}

main();