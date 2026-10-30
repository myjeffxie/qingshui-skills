'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bundleHTML, _resetRemoteCache } = require('../scripts/bundle-html');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII=',
  'base64'
);

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-test-'));
  fs.mkdirSync(path.join(dir, 'css'));
  fs.writeFileSync(path.join(dir, 'css', 'main.css'), '@import "./part.css";\nbody{background:url(../dot.png)}');
  fs.writeFileSync(path.join(dir, 'css', 'part.css'), '.x{color:red}');
  fs.writeFileSync(path.join(dir, 'dot.png'), PNG_1X1);
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("</script>")');
  fs.writeFileSync(path.join(dir, 'index.html'), [
    '<!doctype html><html><head>',
    '<link rel="stylesheet" href="css/main.css">',
    '</head><body>',
    '<img src="dot.png" alt="dot">',
    '<script src="app.js"></script>',
    '<button onclick="alert(1)">x</button>',
    '</body></html>',
  ].join(''));
  return dir;
}

// 本地 HTTP 服务：模拟远程资源（Node 18 内置 fetch 可直接访问）
function startServer(handlers) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const h = handlers[req.url];
      if (!h) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      h(req, res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverURL(server, p) {
  return `http://127.0.0.1:${server.address().port}${p}`;
}

function writeTemp(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-test-'));
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('bundleHTML inlines CSS, images, scripts and escapes script end tags', async () => {
  const dir = makeFixture();
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.match(output, /data:image\/png;base64,/);
    assert.match(output, /\.x\{color:red\}/);
    assert.match(output, /<style>/);
    assert.doesNotMatch(output, /<link\b/);
    assert.doesNotMatch(output, /<script[^>]+src=/);
    assert.match(output, /<\\\/script>/);
    assert.doesNotMatch(output, /url\(\.\.\/dot\.png\)/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML removes scripts and event handlers when allowScripts=false', async () => {
  const dir = makeFixture();
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'), { allowScripts: false });
    assert.doesNotMatch(output, /<script\b/);
    assert.doesNotMatch(output, /onclick=/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML downloads and inlines remote images and scripts', async () => {
  const server = await startServer({
    '/pic.png': (req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG_1X1); },
    '/app.js': (req, res) => { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end('document.title="remote";'); },
  });
  const dir = writeTemp(`<img src="${serverURL(server, '/pic.png')}" alt="r"><script src="${serverURL(server, '/app.js')}"></script>`);
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.match(output, /src="data:image\/png;base64,/);
    assert.match(output, /document\.title="remote";/);
    assert.doesNotMatch(output, /<script[^>]+src=/);
  } finally {
    server.close(); _resetRemoteCache(); cleanup(dir);
  }
});

test('bundleHTML downloads remote stylesheets and resolves nested @import and url()', async () => {
  const server = await startServer({
    '/style.css': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end('@import "nested.css";\n@font-face{font-family:X;src:url(font.woff2) format("woff2")}\nbody{background:url(bg.png)}');
    },
    '/nested.css': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('.a{color:red}'); },
    '/bg.png': (req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG_1X1); },
  });
  const dir = writeTemp(`<link rel="stylesheet" href="${serverURL(server, '/style.css')}">`);
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.match(output, /\.a\{color:red\}/);
    assert.match(output, /url\(data:image\/png;base64,/);
    assert.doesNotMatch(output, /@import/i);
    assert.doesNotMatch(output, /@font-face/i);
    assert.doesNotMatch(output, /<link\b/);
  } finally {
    server.close(); _resetRemoteCache(); cleanup(dir);
  }
});

test('bundleHTML rejects remote assets when fetchRemote=false', async () => {
  const dir = writeTemp('<link rel="stylesheet" href="https://evil.example/a.css">');
  try {
    await assert.rejects(
      () => bundleHTML(path.join(dir, 'index.html'), { fetchRemote: false }),
      /远程|外部/
    );
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML rejects scripts served as HTML and non-CSS stylesheets', async () => {
  const server = await startServer({
    '/evil.js': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>error</html>'); },
    '/fake.css': (req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG_1X1); },
  });
  const dirA = writeTemp(`<script src="${serverURL(server, '/evil.js')}"></script>`);
  const dirB = writeTemp(`<link rel="stylesheet" href="${serverURL(server, '/fake.css')}">`);
  try {
    await assert.rejects(() => bundleHTML(path.join(dirA, 'index.html')), /HTML/);
    await assert.rejects(() => bundleHTML(path.join(dirB, 'index.html')), /CSS/);
  } finally {
    server.close(); _resetRemoteCache(); cleanup(dirA); cleanup(dirB);
  }
});

test('bundleHTML rejects traversal outside HTML directory', async () => {
  const dir = writeTemp('<img src="../secret.png">');
  try {
    await assert.rejects(() => bundleHTML(path.join(dir, 'index.html')), /超出/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML rejects symlinked assets that resolve outside the HTML directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-out-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.png'), PNG_1X1);
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(dir, 'link.png'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<img src="link.png">');
    await assert.rejects(() => bundleHTML(path.join(dir, 'index.html')), /超出/);
  } finally {
    cleanup(dir); cleanup(outside);
  }
});

test('bundleHTML rejects CSS that can break out of style tags', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'main.css'), 'body{content:"</style><script>alert(1)</script>"}');
    fs.writeFileSync(path.join(dir, 'index.html'), '<link rel="stylesheet" href="main.css">');
    await assert.rejects(() => bundleHTML(path.join(dir, 'index.html')), /style/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML rejects SVG images because the server only accepts raster images', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    fs.writeFileSync(path.join(dir, 'index.html'), '<img src="icon.svg">');
    await assert.rejects(() => bundleHTML(path.join(dir, 'index.html')), /PNG|JPEG|GIF|WebP/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML removes non-stylesheet link tags (server rejects any <link>)', async () => {
  const dir = writeTemp('<link rel="icon" href="favicon.ico"><p>hi</p>');
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.doesNotMatch(output, /<link\b/);
    assert.match(output, /<p>hi<\/p>/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML keeps ">" inside quoted attribute values intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'dot.png'), PNG_1X1);
    fs.writeFileSync(path.join(dir, 'index.html'), '<img src="dot.png" alt="a > b" data-x="1>0">');
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.match(output, /alt="a > b"/);
    assert.match(output, /data-x="1>0"/);
    assert.match(output, /src="data:image\/png;base64,/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML ignores remote refs inside HTML comments', async () => {
  const dir = writeTemp('<!-- <script src="https://evil.example/x.js"></script><img src="https://evil.example/y.png"> --><p>ok</p>');
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    // 若尝试下载注释里的地址（evil.example 不会解析）会抛错；这里应正常完成并保留注释原文
    assert.match(output, /<script src="https:\/\/evil\.example\/x\.js"><\/script>/);
    assert.match(output, /<p>ok<\/p>/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML converts self-contained inline SVG to inert data-URI img', async () => {
  const dir = writeTemp('<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#f00"/>&nbsp;</svg>');
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.match(output, /<img src="data:image\/svg\+xml;base64,/);
    assert.match(output, /width="24" height="24"/);
    assert.match(output, /alt=""/);
    assert.doesNotMatch(output, /<svg\b/);
    // 解码验证：xmlns 已注入、&nbsp; 已转为 UTF-8 不间断空格
    const b64 = output.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)[1];
    const svg = Buffer.from(b64, 'base64').toString('utf8');
    assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.includes('\u00a0'), 'nbsp entity should be decoded');
    assert.doesNotMatch(svg, /&nbsp;/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML keeps sprite-dependent SVG inline for server-side cleaning', async () => {
  const dir = writeTemp(
    '<svg style="display:none"><symbol id="i-a"><path d="M0 0"/></symbol></svg>' +
    '<svg class="icon"><use href="#i-a"/></svg>' +
    '<svg id="logo"><circle r="2"/></svg>'
  );
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    // 三个 svg（定义/引用/根带 id）都保留原样，交给服务端白名单清洗
    assert.strictEqual((output.match(/<svg/g) || []).length, 3);
    assert.match(output, /<use href="#i-a"\/?>/);
    assert.doesNotMatch(output, /data:image\/svg\+xml/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML converts nested SVG as one block', async () => {
  const dir = writeTemp('<div><svg viewBox="0 0 2 2"><svg><rect width="1" height="1"/></svg><circle r="1"/></svg></div>');
  try {
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.strictEqual((output.match(/<svg/g) || []).length, 0);
    assert.strictEqual((output.match(/data:image\/svg\+xml;base64/g) || []).length, 1);
    assert.match(output, /<div><img/);
  } finally {
    cleanup(dir);
  }
});

test('bundleHTML injects storage shim only when scripts are allowed', async () => {
  const dirA = writeTemp('<html><head></head><body><script>1+1</script></body></html>');
  const dirB = writeTemp('<html><head></head><body><p>x</p></body></html>');
  try {
    const withScripts = await bundleHTML(path.join(dirA, 'index.html'));
    assert.match(withScripts, /_qingshui_probe/);
    assert.match(withScripts, /Object\.defineProperty\(window,"localStorage"/);
    // 垫片必须在其它脚本之前
    assert.ok(withScripts.indexOf('_qingshui_probe') < withScripts.indexOf('1+1'), 'shim must come before page scripts');

    const noScripts = await bundleHTML(path.join(dirB, 'index.html'), { allowScripts: false });
    assert.doesNotMatch(noScripts, /_qingshui_probe/);
  } finally {
    cleanup(dirA); cleanup(dirB);
  }
});

test('bundleHTML inlines local url() inside style attributes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bundle-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'dot.png'), PNG_1X1);
    fs.writeFileSync(path.join(dir, 'index.html'), '<div style="background:url(dot.png)">x</div>');
    const output = await bundleHTML(path.join(dir, 'index.html'));
    assert.match(output, /style="background:url\(data:image\/png;base64,/);
  } finally {
    cleanup(dir);
  }
});
