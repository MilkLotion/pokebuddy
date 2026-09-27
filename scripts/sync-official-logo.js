// 공식 SVG 로고에서 앱 아이콘 산출물을 만든다.
// macOS의 sips, iconutil을 사용한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const source = path.join(root, 'assets', 'logo', 'src', 'logo.svg');
const out = path.join(root, 'assets', 'logo', 'out');
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = [];
  const payloads = [];
  let offset = 6 + entries.length * 16;
  for (const entry of entries) {
    const item = Buffer.alloc(16);
    item[0] = entry.size >= 256 ? 0 : entry.size;
    item[1] = item[0];
    item.writeUInt16LE(1, 4);
    item.writeUInt16LE(32, 6);
    item.writeUInt32LE(entry.data.length, 8);
    item.writeUInt32LE(offset, 12);
    directory.push(item);
    payloads.push(entry.data);
    offset += entry.data.length;
  }
  return Buffer.concat([header, ...directory, ...payloads]);
}

if (process.platform !== 'darwin') {
  throw new Error('공식 로고 산출물 생성은 macOS의 sips·qlmanage·iconutil이 필요하다');
}
if (!fs.existsSync(source)) throw new Error(`공식 로고 원본이 없다: ${source}`);

fs.mkdirSync(out, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pokebuddy-logo-'));
try {
  const master = path.join(temp, 'logo-1024.png');
  run('sips', ['-s', 'format', 'png', '-z', '1024', '1024', source, '--out', master]);
  const png = new Map();
  for (const size of sizes) {
    const file = path.join(out, `logo-${size}.png`);
    run('sips', ['-z', String(size), String(size), master, '--out', file]);
    png.set(size, file);
  }

  fs.copyFileSync(source, path.join(out, 'logo.svg'));

  const icoEntries = [16, 32, 48, 256].map((size) => ({ size, data: fs.readFileSync(png.get(size)) }));
  fs.writeFileSync(path.join(out, 'logo.ico'), ico(icoEntries));

  const iconset = path.join(temp, 'logo.iconset');
  fs.mkdirSync(iconset);
  const iconNames = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of iconNames) fs.copyFileSync(png.get(size), path.join(iconset, name));
  run('iconutil', ['-c', 'icns', iconset, '-o', path.join(out, 'logo.icns')]);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

process.stdout.write(`official logo: ${out}\n`);
