#!/usr/bin/env node
'use strict';

/**
 * 把 HTML 及其依赖打包成可独立分享的单文件：
 * - 本地 CSS/JS/图片（必须位于 HTML 所在目录内）直接读取内联
 * - 远程图片/脚本/样式默认通过 HTTP(S) 下载后内联（--no-fetch 可关闭）
 * - 远程样式内部会递归处理 @import 与 url()（相对其 URL 解析）
 * - @font-face 统一剥离：沙箱禁止加载字体，服务端也会拒绝该语法
 * - <link> 一律消除：stylesheet 转为 <style>，其余（icon/preconnect 等）删除
 * 仅使用 Node 内置模块，无第三方依赖。
 */

const fs = require('fs');
const path = require('path');

const MAX_DEPTH = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;      // 本地单文件上限
const MAX_REMOTE_BYTES = 20 * 1024 * 1024;    // 远程单资源上限
const MAX_REMOTE_ASSETS = 100;                 // 远程资源数量上限
const REMOTE_TIMEOUT_MS = 20 * 1000;           // 单个远程资源下载超时
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;       // 服务端单图 data URI 解码后上限

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// 引号安全的标签正则：属性值内的 ">" 不会截断标签
function tagOpenRe(name) {
  return new RegExp(`<${name}\\b(?:"[^"]*"|'[^']*'|[^>])*>`, 'gi');
}
const SCRIPT_BLOCK_RE = /(<script\b(?:"[^"]*"|'[^']*'|[^>])*>)([\s\S]*?)(<\/script\s*>)/gi;
const STYLE_BLOCK_RE = /(<style\b(?:"[^"]*"|'[^']*'|[^>])*>)([\s\S]*?)(<\/style\s*>)/gi;

// 支持 async 回调的整体替换（String.replace 的回调不能 await）
async function replaceAsync(str, regex, asyncFn) {
  const parts = [];
  let last = 0;
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(str)) !== null) {
    parts.push(str.slice(last, m.index));
    parts.push(String(await asyncFn(...m, m.index)));
    last = m.index + m[0].length;
    if (m[0].length === 0) regex.lastIndex += 1;
  }
  parts.push(str.slice(last));
  return parts.join('');
}

// HTML 注释保护：注释里的标签/远程地址不参与处理，最后原样还原
function protectComments(html) {
  const comments = [];
  const marked = html.replace(/<!--[\s\S]*?-->/g, (text) => {
    comments.push(text);
    return `\u0000QSC${comments.length - 1}\u0000`;
  });
  return { html: marked, comments };
}

function restoreComments(html, comments) {
  return html.replace(/\u0000QSC(\d+)\u0000/g, (_, i) => comments[Number(i)] || '');
}


function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = String(attrs || '').match(re);
  return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : '';
}

function removeAttr(attrs, name) {
  const re = new RegExp(`\\s+${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  return String(attrs || '').replace(re, '');
}

function setAttr(attrs, name, value) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const pair = `${name}="${String(value).replace(/"/g, '&quot;')}"`;
  return re.test(attrs) ? attrs.replace(re, pair) : `${attrs} ${pair}`;
}

function decodeRef(ref) {
  try {
    return decodeURIComponent(String(ref).trim());
  } catch (e) {
    throw new Error(`无法解析资源路径: ${ref}`);
  }
}

function isRemote(ref) {
  return /^(?:https?:)?\/\//i.test(ref) || (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^data:/i.test(ref));
}

function safeResolve(rootDir, baseDir, ref) {
  const clean = decodeRef(ref).split('#')[0].split('?')[0];
  if (!clean) throw new Error('资源路径为空');
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) {
    throw new Error(`不支持远程/特殊资源: ${ref}`);
  }
  if (clean.startsWith('/')) {
    throw new Error(`不支持绝对路径资源: ${ref}`);
  }
  const candidate = path.resolve(baseDir, clean);
  const relative = path.relative(rootDir, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`资源超出 HTML 所在目录: ${ref}`);
  }
  return candidate;
}

function readLocal(rootDir, baseDir, ref) {
  const file = safeResolve(rootDir, baseDir, ref);
  // 符号链接可能指向目录之外，用真实路径复核包含关系
  let realFile = file;
  try { realFile = fs.realpathSync(file); } catch (e) { /* 不存在时由 statSync 报错 */ }
  const realRoot = fs.realpathSync(rootDir);
  const rel = path.relative(realRoot, realFile);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`资源（符号链接）超出 HTML 所在目录: ${ref}`);
  }
  const stat = fs.statSync(realFile);
  if (!stat.isFile()) throw new Error(`资源不是文件: ${ref}`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`资源过大: ${ref}`);
  return { file: realFile, data: fs.readFileSync(realFile) };
}

function toDataURI(mime, data) {
  if (!IMAGE_MIMES.has(mime)) {
    throw new Error(`不支持的图片类型（仅 PNG/JPEG/GIF/WebP）: ${mime || '未知'}`);
  }
  return `data:${mime};base64,${data.toString('base64')}`;
}

// ---------- 远程资源下载（带超时、大小上限与去重缓存） ----------

const remoteCache = new Map();

function _resetRemoteCache() {
  remoteCache.clear();
}

async function downloadRemote(rawUrl) {
  let url;
  try {
    url = new URL(/^\/\//i.test(rawUrl) ? `https:${rawUrl}` : rawUrl);
  } catch (e) {
    throw new Error(`无效的远程地址: ${rawUrl}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`不支持的远程协议 ${url.protocol}: ${rawUrl}`);
  }
  const cached = remoteCache.get(url.href);
  if (cached) return cached;
  if (remoteCache.size >= MAX_REMOTE_ASSETS) {
    throw new Error(`远程资源数量超过上限 ${MAX_REMOTE_ASSETS}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url.href, { signal: controller.signal, redirect: 'follow' });
  } catch (e) {
    const reason = e && e.name === 'AbortError'
      ? `下载超时（>${REMOTE_TIMEOUT_MS / 1000}s）`
      : (e && e.message) || String(e);
    throw new Error(`远程资源下载失败: ${url.href}（${reason}）`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`远程资源下载失败: ${url.href}（HTTP ${res.status}）`);
  if (Number(res.headers.get('content-length') || 0) > MAX_REMOTE_BYTES) {
    throw new Error(`远程资源过大（>${MAX_REMOTE_BYTES / 1024 / 1024}MB）: ${url.href}`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_REMOTE_BYTES) {
    throw new Error(`远程资源过大（>${MAX_REMOTE_BYTES / 1024 / 1024}MB）: ${url.href}`);
  }
  let mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime) mime = MIME[path.extname(url.pathname).toLowerCase()] || '';
  const entry = { data, mime, url: url.href };
  remoteCache.set(url.href, entry);
  return entry;
}

// ---------- 统一资源加载（本地 / 远程），并按用途校验类型 ----------

function validateAsset(entry, ref, kind) {
  const mime = entry.mime || '';
  if (kind === 'image') {
    if (!IMAGE_MIMES.has(mime)) {
      throw new Error(`图片仅支持 PNG/JPEG/GIF/WebP（实际 ${mime || '未知类型'}）: ${ref}`);
    }
    if (entry.data.length > MAX_IMAGE_BYTES) {
      throw new Error(`图片超过服务端单图上限 5MB: ${ref}`);
    }
  } else if (kind === 'css') {
    if (mime !== 'text/css') {
      throw new Error(`样式返回的不是 CSS（${mime || '未知类型'}）: ${ref}`);
    }
  } else if (kind === 'script') {
    if (mime === 'text/html') {
      throw new Error(`脚本地址返回的是 HTML（可能是错误页）: ${ref}`);
    }
  }
}

// ctx: { type: 'local', rootDir, baseDir, fetchRemote } 或 { type: 'remote', baseUrl }
async function loadAsset(ctx, ref, kind) {
  let entry;
  if (ctx.type === 'remote') {
    entry = await downloadRemote(new URL(ref, ctx.baseUrl).href);
  } else if (isRemote(ref)) {
    if (ctx.fetchRemote === false) {
      throw new Error(`远程资源未允许下载（--no-fetch）: ${ref}`);
    }
    entry = await downloadRemote(ref);
  } else {
    const { data, file } = readLocal(ctx.rootDir, ctx.baseDir, ref);
    entry = { data, mime: MIME[path.extname(file).toLowerCase()] || '', url: file };
  }
  validateAsset(entry, ref, kind);
  return entry;
}

async function inlineCSS(cssText, ctx, depth, seen) {
  if (depth > MAX_DEPTH) throw new Error(`CSS @import 嵌套超过 ${MAX_DEPTH} 层`);

  let css = String(cssText || '');

  // 服务端会整体拒绝 @font-face，且沙箱本就禁止加载字体 → 剥离整块
  // （替换文本不能包含 "@font-face" 字样，服务端对该子串做全文匹配）
  css = css.replace(/@font-face\s*\{[^{}]*\}/gi, '');

  // @import：本地文件或远程样式（远程上下文中的相对地址相对 CSS URL 解析）
  css = await replaceAsync(css, /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?\s*([^;]*);/gi, async (m, q, ref, media) => {
    let entry;
    let nextCtx;
    if (ctx.type === 'remote') {
      entry = await downloadRemote(new URL(ref, ctx.baseUrl).href);
      nextCtx = { type: 'remote', baseUrl: entry.url };
    } else if (isRemote(ref)) {
      if (ctx.fetchRemote === false) throw new Error(`CSS @import 不允许远程地址（--no-fetch）: ${ref}`);
      entry = await downloadRemote(/^\/\//i.test(ref) ? `https:${ref}` : ref);
      nextCtx = { type: 'remote', baseUrl: entry.url };
    } else {
      const { data, file } = readLocal(ctx.rootDir, ctx.baseDir, ref);
      entry = { data, mime: MIME['.css'], url: file };
      nextCtx = { type: 'local', rootDir: ctx.rootDir, baseDir: path.dirname(file), fetchRemote: ctx.fetchRemote };
    }
    validateAsset(entry, ref, 'css');
    if (seen.has(entry.url)) throw new Error(`CSS @import 出现循环: ${ref}`);
    const nextSeen = new Set(seen);
    nextSeen.add(entry.url);
    const imported = await inlineCSS(entry.data.toString('utf8'), nextCtx, depth + 1, nextSeen);
    const cleanMedia = String(media || '').trim();
    return cleanMedia ? `@media ${cleanMedia}{${imported}}` : imported;
  });

  // url()：图片（含远程下载），data:/#fragment 原样保留
  css = await replaceAsync(css, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, async (m, q, ref) => {
    if (/^data:/i.test(ref) || ref.startsWith('#')) return m;
    const entry = await loadAsset(ctx, ref, 'image');
    // base64 内容不含空格/引号/括号；无引号形式在 <style> 与 style 属性内都安全
    return `url(${toDataURI(entry.mime, entry.data)})`;
  });
  if (/<\/style/i.test(css)) {
    throw new Error('CSS 含 </style>，无法安全内联到 HTML');
  }
  return css;
}

async function inlineStyleBlocks(html, ctx) {
  return replaceAsync(html, STYLE_BLOCK_RE, async (m, open, css, close) => {
    return open + (await inlineCSS(css, ctx, 0, new Set())) + close;
  });
}

// style 属性中的 url() 也要内联，否则服务端清洗 style 属性时会拒绝
async function inlineStyleAttrs(html, ctx) {
  html = await replaceAsync(html, /\sstyle\s*=\s*"([^"]*)"/gi, async (m, v) => {
    return ` style="${await inlineCSS(v, ctx, 0, new Set())}"`;
  });
  html = await replaceAsync(html, /\sstyle\s*=\s*'([^']*)'/gi, async (m, v) => {
    return ` style='${await inlineCSS(v, ctx, 0, new Set())}'`;
  });
  return html;
}

async function inlineStylesheetLinks(html, ctx) {
  return replaceAsync(html, tagOpenRe('link'), async (tag) => {
    const rel = getAttr(tag, 'rel');
    if (!/\bstylesheet\b/i.test(rel)) {
      // favicon/preconnect 等在沙箱中无用，而服务端拒绝一切 <link>，统一删除
      return '';
    }
    const href = getAttr(tag, 'href');
    if (!href) throw new Error('<link rel="stylesheet"> 缺少 href');
    let entry;
    let nextCtx;
    if (ctx.type === 'remote') {
      entry = await downloadRemote(new URL(href, ctx.baseUrl).href);
      nextCtx = { type: 'remote', baseUrl: entry.url };
    } else if (isRemote(href)) {
      if (ctx.fetchRemote === false) throw new Error(`外部样式表不允许（--no-fetch）: ${href}`);
      entry = await downloadRemote(/^\/\//i.test(href) ? `https:${href}` : href);
      nextCtx = { type: 'remote', baseUrl: entry.url };
    } else {
      const { data, file } = readLocal(ctx.rootDir, ctx.baseDir, href);
      entry = { data, mime: MIME['.css'], url: file };
      nextCtx = { type: 'local', rootDir: ctx.rootDir, baseDir: path.dirname(file), fetchRemote: ctx.fetchRemote };
    }
    validateAsset(entry, href, 'css');
    const css = await inlineCSS(entry.data.toString('utf8'), nextCtx, 0, new Set([entry.url]));
    const media = getAttr(tag, 'media');
    return `<style${media ? ` media="${media.replace(/"/g, '&quot;')}"` : ''}>${css}</style>`;
  });
}


async function inlineScripts(html, ctx) {
  return replaceAsync(html, SCRIPT_BLOCK_RE, async (m, open, body, close) => {
    const attrs = open.replace(/^<script\b/i, '').replace(/>$/, '');
    const src = getAttr(attrs, 'src');
    if (!src) return m;
    if (/^data:/i.test(src)) throw new Error(`data: 脚本不允许: ${src.slice(0, 80)}`);
    const entry = await loadAsset(ctx, src, 'script');
    const code = entry.data.toString('utf8').replace(/<\/script/gi, '<\\/script');
    return `<script${removeAttr(attrs, 'src')}>${code}</script>`;
  });
}

async function inlineSrcset(value, ctx) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (/\bdata:/i.test(raw)) return raw;
  const out = [];
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(\S+)([\s\S]*)$/);
    if (!m) { out.push(part.trim()); continue; }
    const ref = m[1];
    if (ref.startsWith('#')) { out.push(part.trim()); continue; }
    const entry = await loadAsset(ctx, ref, 'image');
    out.push(`${toDataURI(entry.mime, entry.data)}${m[2]}`);
  }
  return out.join(', ');
}

async function inlineImages(html, ctx) {
  html = await replaceAsync(html, tagOpenRe('img'), async (tag) => {
    let out = tag;
    const src = getAttr(tag, 'src');
    if (src && !/^data:/i.test(src)) {
      const entry = await loadAsset(ctx, src, 'image');
      out = setAttr(out, 'src', toDataURI(entry.mime, entry.data));
    }
    const srcset = getAttr(out, 'srcset');
    if (srcset) out = setAttr(out, 'srcset', await inlineSrcset(srcset, ctx));
    return out;
  });
  html = await replaceAsync(html, tagOpenRe('source'), async (tag) => {
    const srcset = getAttr(tag, 'srcset');
    return srcset ? setAttr(tag, 'srcset', await inlineSrcset(srcset, ctx)) : tag;
  });
  return html;
}

// ---------- 内联 SVG → data URI 图片（方案 B） ----------
//
// 自包含的 SVG（无 <use>/<symbol>/<foreignObject>、根节点无 id）转换为
// <img src="data:image/svg+xml;base64,...">：浏览器规范保证 img 中的 SVG
// 处于安全静态模式（不执行脚本、不加载外部资源），并绕开服务端 SVG 清洗
// 的 mXSS 面。依赖页面 DOM 的 SVG（sprite 引用、可被引用的定义）保留原样，
// 由服务端的 SVG 白名单清洗接管。--keep-svg 可整体关闭该转换。

function parseAttrs(tag) {
  const attrs = {};
  const re = /([^\s=/"'>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}

// HTML 命名实体在独立 SVG(XML) 中不合法，转为 UTF-8 字符；数字实体与 XML 内建实体保留
const SVG_ENTITY_MAP = {
  nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  laquo: '\u00ab', raquo: '\u00bb', times: '\u00d7', divide: '\u00f7',
  deg: '\u00b0', plusmn: '\u00b1', middot: '\u00b7', bull: '\u2022',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', harr: '\u2194',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
  sect: '\u00a7', para: '\u00b6',
};

function svgToImg(block) {
  const openEnd = block.indexOf('>');
  if (openEnd < 0) return null;
  const openTag = block.slice(0, openEnd + 1);
  const body = block.slice(openEnd + 1);
  if (/<use\b/i.test(body) || /<symbol\b/i.test(body) ||
      /<foreignObject\b/i.test(body) || /\bid\s*=/i.test(openTag)) {
    return null;
  }
  let source = block;
  if (!/\bxmlns=/i.test(openTag)) {
    // HTML 中 xmlns 可省略，独立 SVG(XML) 必须有
    source = openTag.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"') + body;
  }
  source = source.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
    const lower = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(SVG_ENTITY_MAP, lower) ? SVG_ENTITY_MAP[lower] : m;
  });
  const uri = `data:image/svg+xml;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const attrs = parseAttrs(openTag);
  const keepNames = ['class', 'style', 'width', 'height', 'role', 'aria-hidden', 'aria-label', 'aria-labelledby', 'focusable'];
  let out = `<img src="${uri}"`;
  for (const name of keepNames) {
    if (attrs[name]) out += ` ${name}="${attrs[name].replace(/"/g, '&quot;')}"`;
  }
  return `${out} alt="">`;
}

// 引号感知的平衡扫描，找到与 start 处 <svg> 配对的 </svg> 之后的下标
function findSVGEnd(html, start) {
  let depth = 0;
  let i = start;
  while (i < html.length) {
    if (html.startsWith('<svg', i) && /^[\s>]/.test(html[i + 4] || '')) {
      depth += 1;
      i += 4;
      continue;
    }
    if (html.startsWith('</svg', i) && /^[\s>]/.test(html[i + 5] || '')) {
      depth -= 1;
      i += 5;
      if (depth === 0) {
        const gt = html.indexOf('>', i);
        return gt < 0 ? -1 : gt + 1;
      }
      continue;
    }
    const ch = html[i];
    if (ch === '"' || ch === '\'') {
      const close = html.indexOf(ch, i + 1);
      if (close < 0) return -1;
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

function convertInlineSVG(html) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf('<svg', i);
    if (start < 0) {
      out += html.slice(i);
      break;
    }
    if (!/^[\s>]/.test(html[start + 4] || '')) {
      // 不是 <svg 标签（如 <svga>），跳过这 4 个字符
      out += html.slice(i, start + 4);
      i = start + 4;
      continue;
    }
    const end = findSVGEnd(html, start);
    if (end < 0) {
      // 未闭合，原样保留（服务端清洗兜底）
      out += html.slice(i);
      break;
    }
    const block = html.slice(start, end);
    const converted = svgToImg(block);
    out += html.slice(i, start) + (converted === null ? block : converted);
    i = end;
  }
  return out;
}

// ---------- 沙箱存储垫片 ----------
//
// 分享页运行在 opaque origin 的沙箱 iframe 中，脚本访问 localStorage/
// sessionStorage 会直接抛 SecurityError，很多页面因此整段脚本崩溃。
// 在所有脚本之前注入内存垫片（仅当原生存储不可用时才生效）。

const STORAGE_SHIM = '<script>!function(){function s(){var o={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(o,k)?o[k]:null},setItem:function(k,v){o[k]=String(v)},removeItem:function(k){delete o[k]},clear:function(){o={}},key:function(i){var a=Object.keys(o);return i<a.length?a[i]:null},get length(){return Object.keys(o).length}}}var probe=false;try{window.localStorage.getItem("_qingshui_probe");probe=true}catch(e){}if(!probe){try{Object.defineProperty(window,"localStorage",{value:s(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:s(),configurable:true})}catch(e){}}}();</script>';

function injectStorageShim(html) {
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + STORAGE_SHIM + html.slice(at);
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${STORAGE_SHIM}</head>${html.slice(at)}`;
  }
  return STORAGE_SHIM + html;
}

async function bundleHTML(inputPath, options = {}) {
  const abs = path.resolve(inputPath);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`不是文件: ${inputPath}`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`HTML 文件过大: ${inputPath}`);

  const rootDir = path.dirname(abs);
  // macOS 的 tmpdir 本身就是符号链接；统一用真实路径，保证与 readLocal 返回的
  // realpath 同一命名空间，relative() 包含关系检查才不会误判
  const realRootDir = fs.realpathSync(rootDir);
  const ctx = { type: 'local', rootDir: realRootDir, baseDir: realRootDir, fetchRemote: options.fetchRemote !== false };
  let html = fs.readFileSync(abs, 'utf8');
  if (!/<meta\b[^>]*charset/i.test(html)) {
    html = `<!doctype html>\n<meta charset="utf-8">\n${html}`;
  }

  // 先保护 HTML 注释：注释里的引用不处理（避免误下载、误报错），最后原样还原
  const { html: marked, comments } = protectComments(html);
  html = marked;

  html = await inlineStylesheetLinks(html, ctx);
  html = await inlineStyleBlocks(html, ctx);
  html = await inlineStyleAttrs(html, ctx);
  if (options.allowScripts === false) {
    // 先剥离脚本与事件属性，避免为将被打包掉的脚本下载远程依赖
    html = html.replace(SCRIPT_BLOCK_RE, '');
    html = html.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  } else {
    html = await inlineScripts(html, ctx);
  }
  html = await inlineImages(html, ctx);
  if (options.keepSvg !== true && options.keepSvg !== 'true') {
    html = convertInlineSVG(html);
  }
  if (options.allowScripts !== false) {
    html = injectStorageShim(html);
  }

  html = restoreComments(html, comments);
  return html;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.log('用法: node bundle-html.js <input.html> [--out output.html] [--no-fetch]');
    process.exit(1);
  }
  try {
    const html = await bundleHTML(args[0], { fetchRemote: !args.includes('--no-fetch') });
    const outIndex = args.indexOf('--out');
    if (outIndex >= 0 && args[outIndex + 1]) {
      fs.writeFileSync(args[outIndex + 1], html, 'utf8');
      console.log(`✅ 已生成: ${args[outIndex + 1]}`);
    } else {
      process.stdout.write(html);
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

module.exports = { bundleHTML, inlineCSS, toDataURI, _resetRemoteCache };

if (require.main === module) main();

