#!/usr/bin/env node
// 以 iPad Pro 13 吋 Simulator 的真實 App 截圖製作 App Store 橫向送審素材。
// App 畫面只做等比例縮放與圓角遮罩；標題、說明與品牌底色是 metadata overlay。
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = HERE;
const SOURCE_INPUT = process.env.RAIL_IPAD_SHOT_SOURCE || '/private/tmp/railisland-ipad-shots/raw';
const SOURCE = path.join(PACK, 'source');
const OUT = path.join(PACK, '2752x2064');
const CONTACT = path.join(PACK, 'contact-sheet.png');
for (const dir of [SOURCE, OUT]) await mkdir(dir, { recursive: true });

const W = 2752;
const H = 2064;
const SCREEN_W = 2184;
const SCREEN_H = 1638;
const SCREEN_X = Math.round((W - SCREEN_W) / 2);
const SCREEN_Y = 350;
const COLORS = {
  navy: '#102546',
  navy2: '#183963',
  cream: '#f3eedf',
  cream2: '#fffaf0',
  gold: '#e6b94e',
  ink: '#102546',
  blue: '#9fc3ef',
};
const font = 'PingFang TC, Noto Sans CJK TC, sans-serif';
const xml = value => String(value).replace(/[<>&"']/g, char => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[char]);

const items = [
  {
    source: '04_landscape_overview.png', sourceName: '01_全台同框_原始.png',
    filename: '01_全台列車_此刻一起前進.png',
    title: ['全台列車，', '此刻一起前進'],
    note: '台鐵・高鐵・捷運・輕軌，一張 iPad 看完整', dark: true,
  },
  {
    source: '07_landscape_search_taipei.png', sourceName: '02_台北站看板_原始.png',
    filename: '02_點一座站_接下來的車都在這裡.png',
    title: ['點一座站，', '接下來的車都在這裡'],
    note: '班次、方向、到站倒數一次看', dark: false,
  },
  {
    source: '09_landscape_train149.png', sourceName: '03_149次跟車_原始.png',
    filename: '03_跟一班車_看它現在走到哪.png',
    title: ['跟一班車，', '看它現在走到哪'],
    note: '下一站、速度、誤點與停靠狀態', dark: true,
  },
  {
    source: '10_landscape_explore.png', sourceName: '04_今日亮點_原始.png',
    filename: '04_今天看什麼_軌島幫你挑.png',
    title: ['今天看什麼，', '軌島幫你挑'],
    note: '特別列車、今日之最與近期活動', dark: false,
  },
  {
    source: '11_landscape_passport.png', sourceName: '05_旅程護照_原始.png',
    filename: '05_把每一趟旅程_收進護照.png',
    title: ['把每一趟旅程，', '收進自己的護照'],
    note: '車種圖鑑、支線行腳與旅程成就', dark: true,
  },
  {
    source: '12_landscape_more.png', sourceName: '06_更多與平板工具_原始.png',
    filename: '06_iPad橫著放_資訊就在手邊.png',
    title: ['iPad 橫著放，', '資訊就在手邊'],
    note: '完整工具與設定，保留地圖主要空間', dark: false,
  },
];

function roundedMask(width, height, radius) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${radius}" fill="white"/></svg>`);
}

function headerSvg(item) {
  const fg = item.dark ? COLORS.cream2 : COLORS.ink;
  const sub = item.dark ? '#b7cae1' : '#53677f';
  const pill = item.dark ? '#335785' : '#dce8f6';
  return Buffer.from(`<svg width="${W}" height="330" xmlns="http://www.w3.org/2000/svg">
    <rect x="90" y="34" width="372" height="62" rx="31" fill="${pill}"/>
    <text x="276" y="66" text-anchor="middle" dominant-baseline="middle"
      font-family="${font}" font-size="29" font-weight="700" letter-spacing="2" fill="${fg}">軌島 RAIL ISLAND・iPad</text>
    <text x="90" y="172" font-family="${font}" font-size="70" font-weight="800" fill="${fg}">${xml(item.title[0])}</text>
    <text x="90" y="252" font-family="${font}" font-size="70" font-weight="800" fill="${fg}">${xml(item.title[1])}</text>
    <text x="1550" y="226" font-family="${font}" font-size="31" font-weight="500" fill="${sub}">${xml(item.note)}</text>
  </svg>`);
}

function shadowSvg() {
  return Buffer.from(`<svg width="${SCREEN_W + 48}" height="${SCREEN_H + 48}" xmlns="http://www.w3.org/2000/svg">
    <rect x="24" y="28" width="${SCREEN_W}" height="${SCREEN_H}" rx="50" fill="#000" opacity="0.30"/>
  </svg>`);
}

async function makePanel(input) {
  const screenshot = await sharp(input)
    .resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  return sharp({ create: { width: SCREEN_W, height: SCREEN_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: screenshot },
      { input: roundedMask(SCREEN_W, SCREEN_H, 42), blend: 'dest-in' },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

for (const item of items) {
  const input = path.join(SOURCE_INPUT, item.source);
  const copiedSource = path.join(SOURCE, item.sourceName);
  await sharp(input)
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(copiedSource);
  const panel = await makePanel(copiedSource);
  const bg = item.dark ? COLORS.navy : COLORS.cream;
  await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([
      { input: headerSvg(item), left: 0, top: 0 },
      { input: shadowSvg(), left: SCREEN_X - 24, top: SCREEN_Y - 24 },
      { input: panel, left: SCREEN_X, top: SCREEN_Y },
    ])
    .flatten({ background: bg })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, item.filename));
  console.log(`DONE ${item.filename}`);
}

const thumbs = [];
for (const item of items) {
  thumbs.push(await sharp(path.join(OUT, item.filename)).resize(640, 480).png().toBuffer());
}
await sharp({ create: { width: 1920, height: 960, channels: 3, background: '#ffffff' } })
  .composite(thumbs.map((input, i) => ({ input, left: (i % 3) * 640, top: Math.floor(i / 3) * 480 })))
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(CONTACT);

const manifest = {
  generatedAt: new Date().toISOString(),
  app: { version: '1.5.4', build: 92, webBuild: 'v0903k' },
  device: { name: 'iPad Pro 13-inch (M5)', runtime: 'iOS 26.5', orientation: 'landscape' },
  dimensions: [W, H],
  files: items.map(item => item.filename),
  sourceFiles: items.map(item => item.sourceName),
  sourcePolicy: '全部 App UI 像素由 iPad Pro 13-inch Simulator 安裝並操作實際 Universal App 後，以 simctl framebuffer 擷取；沒有重建、生成或改寫介面。只加品牌標題、說明、背景、等比例縮放與圓角遮罩。',
  privacy: '畫面不含姓名、email、精確位置、帳號或其他個人資料。定位權限於擷取前拒絕。',
  attribution: '所有地圖 attribution 均保留在原始 App 畫面內。',
};
await writeFile(path.join(PACK, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`完成 ${items.length} 張 iPad 13 吋橫向送審圖與 contact sheet`);
