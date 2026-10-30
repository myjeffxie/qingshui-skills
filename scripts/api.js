#!/usr/bin/env node
/**
 * 青水 API 调用脚本
 * 用于生成图片、视频和语音（TTS / 声音克隆），异步轮询获取结果
 */

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bundleHTML } = require('./bundle-html');

function loadDotEnv() {
  // 自动读取 .env：skill 目录优先，其次当前工作目录；真实环境变量优先于 .env
  const candidates = [path.join(__dirname, '..', '.env'), path.join(process.cwd(), '.env')];
  const seen = new Set();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
          (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  }
}

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

const API_TIMEOUT_MS = 30 * 1000;       // JSON API 请求空闲超时
const UPLOAD_TIMEOUT_MS = 120 * 1000;   // 文件上传空闲超时

function apiRequest(method, path, data = null) {
  const { apiKey, baseUrl } = getConfig();
  const url = new URL(path, baseUrl);
  const options = {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : 443,
    path: url.pathname + url.search,
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
    // 空闲超时：长时间无响应时主动中断，而不是永远挂起
    req.setTimeout(API_TIMEOUT_MS, () => req.destroy(new Error(`请求超时（${API_TIMEOUT_MS / 1000}s 无响应）`)));
    if (body) req.write(body);
    req.end();
  });
}

// 依据扩展名推断 Content-Type（声音克隆上传音频 / 图标时使用）
function inferMimeType(filePath) {
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
  };
  return mimeMap[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// 构造 multipart/form-data 请求体（Node 原生实现，无第三方依赖）
function buildMultipartBody(fields, files) {
  // 时间戳 + 随机数，避免同一毫秒内并发上传时 boundary 撞车
  const boundary = `----qingshui${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${path.basename(file.path)}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
    chunks.push(fs.readFileSync(file.path));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), boundary };
}

// 上传文件（multipart/form-data），用于声音克隆
function apiUpload(pathname, fields, files) {
  const { apiKey, baseUrl } = getConfig();
  const url = new URL(pathname, baseUrl);
  const { body, boundary } = buildMultipartBody(fields, files);
  const options = {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (chunk) => (chunks += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(chunks) }); }
        catch (e) { resolve({ status: res.statusCode, data: { error: chunks } }); }
      });
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(UPLOAD_TIMEOUT_MS, () => req.destroy(new Error(`上传超时（${UPLOAD_TIMEOUT_MS / 1000}s 无响应）`)));
    req.write(body);
    req.end();
  });
}

async function generateImage(prompt, options = {}) {
  const {
    model = 'gemini-3.1-flash-image-preview',
    count = 1,
    aspectRatio = '16:9',
    negativePrompt = '',
    referenceImage = '',
    referenceImages = [],
  } = options;
  const refs = normalizeList(referenceImages);
  const legacyRefs = normalizeList(referenceImage);
  const allRefs = uniqueList([...legacyRefs, ...refs]);
  console.log(`🎨 提交图片生成: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);
  const result = await apiRequest('POST', '/api/v1/images/generate', {
    prompt, model, image_count: count, aspect_ratio: aspectRatio,
    negative_prompt: negativePrompt, reference_images: allRefs,
  });
  if (result.status === 200 && result.data.success) {
    console.log(`✅ 任务已提交: ${result.data.task_id} (消耗 ${result.data.quota_cost} 算力)`);
    return result.data;
  }
  throw new Error(`提交失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function generateVideo(prompt, options = {}) {
  const {
    model = 'Doubao-Seedance-2.0',
    duration = 5,
    aspectRatio = '16:9',
    resolution = '720p',
    referenceImage = '',
    referenceImages = [],
    image = '',
    lastFrame = '',
    grokMode = '',
    voiceId = '',
    referenceAudioVoiceIds = [],
  } = options;
  console.log(`🎬 提交视频生成: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

  const payload = { prompt, model, duration, aspect_ratio: aspectRatio, resolution };
  const refs = normalizeList(referenceImages);
  const legacyRefs = normalizeList(referenceImage);
  const voiceIds = normalizeList(referenceAudioVoiceIds);
  if (voiceId) voiceIds.push(String(voiceId));

  if (model === 'grok-imagine-video-1.5') {
    const mode = grokMode || inferGrokMode({ referenceImages: [...legacyRefs, ...refs], image, lastFrame });
    payload.grok_mode = mode;
    if (mode === 'reference-to-video') {
      if (image || lastFrame) {
        throw new Error('Grok 参考图模式不能同时传 --image/--last-frame，请改用 --grok-mode first-last-frame');
      }
      const allRefs = [...legacyRefs, ...refs];
      if (allRefs.length > 0) payload.reference_images = uniqueList(allRefs);
    } else if (mode === 'first-last-frame') {
      if (refs.length > 0 || legacyRefs.length > 0) {
        throw new Error('Grok 首尾帧模式不能同时传 --reference/--reference-images，请改用 --grok-mode reference-to-video');
      }
      if (image) payload.image = image;
      if (lastFrame) payload.last_frame = lastFrame;
    } else if (mode !== 'text-to-video') {
      throw new Error('Grok --grok-mode 仅支持 text-to-video、reference-to-video、first-last-frame');
    }
    if (voiceIds.length > 0) payload.reference_audio_voice_ids = uniqueList(voiceIds);
  } else if (legacyRefs.length > 0) {
    payload.reference_image = legacyRefs[0];
  }

  const result = await apiRequest('POST', '/api/v1/videos/generate', payload);
  if (result.status === 200 && result.data.success) {
    console.log(`✅ 任务已提交: ${result.data.task_id} (消耗 ${result.data.quota_cost} 算力)`);
    return result.data;
  }
  throw new Error(`提交失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function generateAudio(text, options = {}) {
  const {
    model = 'speech-2.8-turbo',
    voiceId = '',
    speed = 0,
    vol = 0,
    pitch = 0,
    emotion = '',
    format = 'mp3',
    sampleRate = 0,
    bitrate = 0,
    channel = 0,
    textNormalization = false,
    vmPitch = 0,
    vmIntensity = 0,
    vmTimbre = 0,
    vmSoundEffects = '',
    subtitle = false,
    subtitleType = '',
  } = options;

  const payload = { text, model, format };
  if (voiceId) payload.voice_id = String(voiceId);
  if (speed) payload.speed = Number(speed);
  if (vol) payload.vol = Number(vol);
  if (pitch) payload.pitch = Number(pitch);
  if (emotion) payload.emotion = String(emotion);
  if (sampleRate) payload.sample_rate = Number(sampleRate);
  if (bitrate) payload.bitrate = Number(bitrate);
  if (channel) payload.channel = Number(channel);
  if (textNormalization === true || textNormalization === 'true') payload.text_normalization = true;
  if (vmPitch) payload.vm_pitch = Number(vmPitch);
  if (vmIntensity) payload.vm_intensity = Number(vmIntensity);
  if (vmTimbre) payload.vm_timbre = Number(vmTimbre);
  if (vmSoundEffects) payload.vm_sound_effects = String(vmSoundEffects);
  if (subtitle === true || subtitle === 'true') {
    payload.subtitle_enable = true;
    payload.subtitle_type = subtitleType ? String(subtitleType) : 'sentence';
  }

  console.log(`🎙️ 提交语音合成: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
  const result = await apiRequest('POST', '/api/v1/audio/speech', payload);
  if (result.status === 200 && result.data.success) {
    console.log(`✅ 任务已提交: ${result.data.task_id} (消耗 ${result.data.quota_cost} 算力)`);
    return result.data;
  }
  throw new Error(`提交失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function listVoices(options = {}) {
  const params = new URLSearchParams();
  if (options.gender) params.set('gender', String(options.gender));
  if (options.customOnly === true || options.customOnly === 'true') params.set('custom_only', 'true');
  if (options.q) params.set('q', String(options.q));
  const query = params.toString();
  const result = await apiRequest('GET', `/api/v1/audio/voices${query ? '?' + query : ''}`);
  if (result.status === 200 && result.data.success) return result.data.data;
  throw new Error(`查询失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function cloneVoice(options = {}) {
  const { audio = '', name = '', gender = '', icon = '', previewText = '' } = options;
  if (!audio) throw new Error('请通过 --audio 指定音频样本文件路径（mp3 / m4a / wav，10秒~5分钟，≤20MB）');
  if (!fs.existsSync(audio)) throw new Error(`音频样本文件不存在: ${audio}`);

  const files = [{ field: 'audio', path: audio, mime: inferMimeType(audio) }];
  if (icon) {
    if (!fs.existsSync(icon)) throw new Error(`图标文件不存在: ${icon}`);
    files.push({ field: 'icon', path: icon, mime: inferMimeType(icon) });
  }

  console.log(`🎤 提交声音克隆: ${path.basename(audio)}${name ? `（名称: ${name}）` : ''}`);
  const result = await apiUpload('/api/v1/audio/voices/clone', { name, gender, preview_text: previewText }, files);
  if (result.status === 200 && result.data.success) {
    console.log(`✅ 克隆成功: ${result.data.data.voice_id}`);
    return result.data.data;
  }
  throw new Error(`克隆失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function deleteVoice(voiceId) {
  if (!voiceId) throw new Error('请指定 voice_id');
  const result = await apiRequest('DELETE', `/api/v1/audio/voices/${encodeURIComponent(voiceId)}`);
  if (result.status === 200 && result.data.success) return result.data;
  throw new Error(`删除失败: ${result.data.error || 'HTTP ' + result.status}`);
}


async function shareAsset(filePath, options = {}) {
  if (!filePath) throw new Error('请指定要分享的文件路径');
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  const originalName = path.basename(abs);
  const ext = path.extname(originalName).toLowerCase().replace(/^\./, '');
  if (!ext) throw new Error('文件必须有扩展名');

  const isHTML = ext === 'html' || ext === 'htm';
  const noBundle = options.noBundle === true || options.noBundle === 'true' || options.bundle === false || options.bundle === 'false';
  let uploadPath = abs;
  let tempDir = '';

  try {
    if (isHTML && !noBundle) {
      const fetchRemote = !(options.noFetch === true || options.noFetch === 'true');
      console.log(`🧩 正在打包 CSS/JS/图片（本地内联${fetchRemote ? ' + 远程下载' : '，远程引用不下载'}）: ${originalName}`);
      const html = await bundleHTML(abs, {
        allowScripts: options.noScripts !== true && options.noScripts !== 'true',
        fetchRemote,
        keepSvg: options.keepSvg === true || options.keepSvg === 'true',
      });
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qingshui-share-'));
      uploadPath = path.join(tempDir, 'share.html');
      fs.writeFileSync(uploadPath, html, 'utf8');
      if (Buffer.byteLength(html, 'utf8') > 10 * 1024 * 1024) {
        console.log('⚠️  打包后的 HTML 超过 10MB，服务端可能拒绝上传（HTML 上限 10MB）');
      }
    }

    const fields = {
      name: options.name || originalName,
      extension: ext === 'htm' ? 'html' : ext,
      allow_scripts: (options.noScripts === true || options.noScripts === 'true') ? '0' : '1',
    };
    const files = [{ field: 'file', path: uploadPath, mime: inferMimeType(uploadPath) }];
    console.log(`📤 上传分享: ${originalName}`);
    const result = await apiUpload('/api/v1/assets', fields, files);
    if (result.status !== 201 || !result.data.success) {
      throw new Error(`分享失败: ${result.data.error || 'HTTP ' + result.status}`);
    }
    console.log(`✅ 分享成功: ${result.data.url}`);
    console.log(`   hash: ${result.data.asset.hash}`);
    console.log(`   类型: ${result.data.asset.kind} / ${result.data.asset.mime_type}`);
    if (result.data.asset.kind === 'html') {
      console.log('   提示：HTML 在沙箱 iframe 中打开；页面内脚本无法读取本站 Cookie/存储。');
    }
    (result.data.warnings || []).forEach((w) => console.log(`   ⚠️  ${w}`));
    return result.data;
  } finally {
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  }
}

async function listAssets(options = {}) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('page_size', String(options.pageSize));
  const query = params.toString();
  const result = await apiRequest('GET', `/api/v1/assets${query ? '?' + query : ''}`);
  if (result.status !== 200 || !result.data.success) {
    throw new Error(`查询失败: ${result.data.error || 'HTTP ' + result.status}`);
  }
  const { assets = [], usage, total, page, page_size: pageSize } = result.data;
  console.log(`\n📦 已分享资源（${total} 个，第 ${page} 页，每页 ${pageSize} 条）:`);
  if (assets.length === 0) {
    console.log('  （暂无）');
  }
  assets.forEach((a, i) => {
    console.log(`  ${i + 1}. [${a.kind}] ${a.file_name}  ${a.url}`);
    console.log(`     hash: ${a.hash}`);
  });
  if (usage) {
    console.log(`\n💾 配额: ${usage.used_bytes}/${usage.max_total_bytes} 字节；今日 ${usage.uploads_today}/${usage.max_uploads_per_day} 次；本小时 ${usage.uploads_this_hour}/${usage.max_uploads_per_hour} 次`);
  }
  return result.data;
}

async function deleteAsset(hash) {
  if (!hash) throw new Error('请指定要删除的 hash');
  if (!/^[a-f0-9]{32}$/.test(hash)) throw new Error('hash 必须是 32 位小写十六进制');
  const result = await apiRequest('DELETE', `/api/v1/assets/${encodeURIComponent(hash)}`);
  if (result.status !== 200 || !result.data.success) {
    throw new Error(`取消分享失败: ${result.data.error || 'HTTP ' + result.status}`);
  }
  console.log(`✅ 已取消分享: ${hash}`);
  return result.data;
}

function normalizeList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
}

function uniqueList(values) {
  return [...new Set(values.map(String).filter(Boolean))];
}

function inferGrokMode({ referenceImages, image, lastFrame }) {
  if (image || lastFrame) return 'first-last-frame';
  if (referenceImages && referenceImages.length > 0) return 'reference-to-video';
  return 'text-to-video';
}

async function queryTask(taskId, taskType = 'image') {
  const endpoint =
    taskType === 'video' ? `/api/v1/videos/${taskId}` :
    taskType === 'audio' ? `/api/v1/audio/tasks/${taskId}` :
    `/api/v1/images/${taskId}`;
  const result = await apiRequest('GET', endpoint);
  if (result.status === 200 && result.data.success) return result.data.task;
  throw new Error(`查询失败: ${result.data.error || 'HTTP ' + result.status}`);
}

async function waitForTask(taskId, taskType = 'image', maxWaitMs = 600000) {
  const startTime = Date.now();
  const pollInterval = 3000;
  let dots = 0;
  let consecutiveErrors = 0;
  process.stdout.write(`⏳ 等待任务完成 ${taskId} `);
  while (Date.now() - startTime < maxWaitMs) {
    let task;
    try {
      task = await queryTask(taskId, taskType);
      consecutiveErrors = 0;
    } catch (e) {
      // 网络抖动容错：连续 10 次查询失败才终止，避免一次请求失败丢掉整个任务
      consecutiveErrors += 1;
      if (consecutiveErrors >= 10) throw e;
      process.stdout.write('!');
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }
    if (task.status === 'completed') {
      process.stdout.write('\n✅ 任务完成!\n');
      return task;
    }
    if (task.status === 'failed') {
      process.stdout.write('\n❌ 任务失败!\n');
      throw new Error(`任务失败: ${task.error_msg || '未知错误'}`);
    }
    dots = (dots + 1) % 4;
    // progress 缺失时不再打印 undefined%
    const n = task.progress == null ? NaN : Number(task.progress);
    const pctText = Number.isFinite(n) ? `, ${n}%` : '';
    process.stdout.write(`\r⏳ 等待中 ${taskId} [${task.status}${pctText}]${'.'.repeat(dots)}  `);
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
      const parsed = isNaN(val) ? val : Number(val);
      if (result[key] === undefined) {
        result[key] = parsed;
      } else if (Array.isArray(result[key])) {
        result[key].push(parsed);
      } else {
        result[key] = [result[key], parsed];
      }
    }
  }
  if (result.reference && result.referenceImage === undefined) result.referenceImage = result.reference;
  if (result.references && result.referenceImages === undefined) result.referenceImages = result.references;
  // 重复的非列表参数取最后一个值（如 --count 2 --count 3 → 3），
  // 列表类参数保留数组（可重复传，也可逗号分隔）
  const listKeys = new Set([
    'reference', 'references', 'referenceImage', 'referenceImages', 'referenceAudioVoiceIds',
  ]);
  for (const key of Object.keys(result)) {
    if (!listKeys.has(key) && Array.isArray(result[key])) {
      result[key] = result[key][result[key].length - 1];
    }
  }
  return result;
}

async function main() {
  loadDotEnv();
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
    case 'audio': {
      const options = parseOptions(args.slice(1));
      const text = options.text ? String(options.text) : extractPrompt(args.slice(1));
      if (!text) { console.error('用法: node api.js audio --text "要合成的文本" [选项]'); process.exit(1); }
      try {
        const r = await generateAudio(text, options);
        const t = await waitForTask(r.task_id, 'audio', 600000);
        if (t.result) {
          if (t.result.audio_url) console.log(`\n🔊 语音文件: ${t.result.audio_url}`);
          if (t.result.subtitle_url) console.log(`💬 字幕文件: ${t.result.subtitle_url}`);
          if (t.result.duration) console.log(`   时长: ${Number(t.result.duration).toFixed(1)} 秒`);
          if (t.result.char_count) console.log(`   字符数: ${t.result.char_count}`);
        }
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'voices': {
      const options = parseOptions(args.slice(1));
      try {
        const data = await listVoices(options);
        console.log(`\n🎧 音色列表（共 ${data.total} 个）:`);
        (data.voices || []).forEach((v, i) => {
          console.log(`  ${i + 1}. ${v.id}  ${v.name} (${v.gender})${v.is_custom ? ' [克隆]' : ''}`);
        });
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'clone-voice': {
      const options = parseOptions(args.slice(1));
      try {
        const data = await cloneVoice(options);
        console.log(`   名称: ${data.name}  性别: ${data.gender}`);
        if (data.preview_url) console.log(`   试听: ${data.preview_url}`);
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'delete-voice': {
      const voiceId = args[1];
      if (!voiceId) { console.error('用法: node api.js delete-voice <voice_id>'); process.exit(1); }
      try {
        await deleteVoice(voiceId);
        console.log(`✅ 已删除音色: ${voiceId}`);
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'share': {
      const file = args[1];
      if (!file) { console.error('用法: node api.js share <文件> [--name 名称] [--no-bundle] [--no-scripts] [--no-fetch] [--keep-svg]'); process.exit(1); }
      const options = parseOptions(args.slice(2));
      try {
        await shareAsset(file, options);
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'assets': {
      const options = parseOptions(args.slice(1));
      try {
        await listAssets(options);
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'unshare': {
      const hash = args[1];
      if (!hash) { console.error('用法: node api.js unshare <hash>'); process.exit(1); }
      try {
        await deleteAsset(hash);
      } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
      break;
    }
    case 'status': {
      const taskId = args[1];
      if (!taskId) { console.error('用法: node api.js status <task_id> [--type image|video|audio]'); process.exit(1); }
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
  node api.js image --prompt "提示词" [选项]            生成图片
  node api.js video --prompt "提示词" [选项]            生成视频
  node api.js audio --text "要合成的文本" [选项]          生成语音
  node api.js voices [--gender female] [--custom-only]  音色列表
  node api.js clone-voice --audio ./sample.mp3 [选项]  克隆音色
  node api.js delete-voice <voice_id>                  删除克隆音色
  node api.js share <文件> [--name 名称]               上传分享 HTML/图片/文档
  node api.js assets [--page 1] [--page-size 20]       查看已分享资源
  node api.js unshare <hash>                           取消分享
  node api.js status <task_id> [--type image|video|audio]  查询任务

分享示例:
  node api.js share ./report.html                       自动内联本地 CSS/JS/图片，远程图片/脚本/样式自动下载后内联
  node api.js share ./poster.png --name 活动海报
  node api.js share ./manual.pdf --name 产品手册
  node api.js share ./page.html --no-bundle --no-scripts
  node api.js share ./page.html --no-fetch              不下载远程资源（遇到远程引用时报错）
  node api.js assets
  node api.js unshare 0123456789abcdef0123456789abcdef

语音合成示例:
  node api.js audio --text "欢迎来到今天的课程" --model speech-2.8-turbo
  node api.js audio --text "今天心情特别好" --voice-id zh_female_xxx --emotion happy --speed 1.2
  node api.js audio --text "字幕同步演示" --subtitle --subtitle-type sentence
  node api.js clone-voice --audio ./my_voice.mp3 --name 我的音色 --gender female

Grok Video 1.5 示例:
  node api.js video --model grok-imagine-video-1.5 --grok-mode text-to-video --prompt "电影感航拍城市夜景"
  node api.js video --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images "https://example.com/a.jpg,https://example.com/b.jpg" --prompt "保持人物一致，走向镜头"
  node api.js video --model grok-imagine-video-1.5 --grok-mode first-last-frame --image https://example.com/first.jpg --last-frame https://example.com/last.jpg --prompt "从首帧自然过渡到尾帧"

环境变量: QINGSHUI_API_KEY (必需), QINGSHUI_BASE_URL (可选)`);
  }
}

main();