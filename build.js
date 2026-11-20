// 출품 파일 만들기: node build.js  →  dist/ghost-relay.html (외부 의존성 없음)
'use strict';
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
let html = src('template.html');
const put = (mark, text) => { if (!html.includes(mark)) throw new Error('missing ' + mark); html = html.split(mark).join(text); };
put('/*__CSS__*/', src('style.css'));
put('/*__CORE__*/', src('core.js').replace(/<\/script/gi, '<\\/script'));
put('/*__APP__*/', src('app.js').replace(/<\/script/gi, '<\\/script'));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', 'ghost-relay.html');
fs.writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`dist/ghost-relay.html  ${kb} KB` + (Buffer.byteLength(html) > 4 * 1024 * 1024 ? '  ⚠ 4MB 초과!' : ''));

// 공유용 페이지(claude.ai Artifact): 문서 뼈대 없이 본문만
const body = html
  .replace(/^[\s\S]*?<title>/, '<title>')
  .replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<\/head>\s*<body>/, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '')
  .replace('<style>', '<style>\n:root { color-scheme: dark; }\nhtml, body { background: #0B0D0A; }');
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), '<meta name="theme-color" content="#0B0D0A">\n' + body);
console.log('dist/artifact.html (공유 링크용)');
// GitHub Pages가 레포 루트의 index.html을 보여 준다
fs.copyFileSync(out, path.join(__dirname, 'index.html'));
console.log('index.html (GitHub Pages)');
