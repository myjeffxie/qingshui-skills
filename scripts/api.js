#!/usr/bin/env node
/**
 * 青水 API 调用脚本
 * 用于生成图片、视频和语音（TTS / 声音克隆），异步轮询获取结果
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

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
  };
  return mimeMap[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// 构造 multipart/form-data 请求体（Node 原生实现，无第三方依赖）
function buildMultipartBody(fields, files) {
  const boundary = `----qingshui${Date.now().toString(16)}`;
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
    port: 443,
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
    case 'audio': {
      const options = parseOptions(args.slice(1));
      const text = options.text ? String(options.text) : extractPrompt(args.slice(1));
      if (!text) { console.error('用法: node api.js audio --text "要合成的文本" [选项]'); process.exit(1); }
      try {
        const r = await generateAudio(text, options);
        const t = await waitForTask(r.task_id, 'audio', 600000);
        if (t.result) {
          if (t.result.audio_url) console.log(`\n🔊 语音文件: ${t.result.audio_url}`);
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
  node api.js status <task_id> [--type image|video|audio]  查询任务

语音合成示例:
  node api.js audio --text "欢迎来到今天的课程" --model speech-2.8-turbo
  node api.js audio --text "今天心情特别好" --voice-id zh_female_xxx --emotion happy --speed 1.2
  node api.js clone-voice --audio ./my_voice.mp3 --name 我的音色 --gender female

Grok Video 1.5 示例:
  node api.js video --model grok-imagine-video-1.5 --grok-mode text-to-video --prompt "电影感航拍城市夜景"
  node api.js video --model grok-imagine-video-1.5 --grok-mode reference-to-video --reference-images "https://example.com/a.jpg,https://example.com/b.jpg" --prompt "保持人物一致，走向镜头"
  node api.js video --model grok-imagine-video-1.5 --grok-mode first-last-frame --image https://example.com/first.jpg --last-frame https://example.com/last.jpg --prompt "从首帧自然过渡到尾帧"

环境变量: QINGSHUI_API_KEY (必需), QINGSHUI_BASE_URL (可选)`);
  }
}

main();