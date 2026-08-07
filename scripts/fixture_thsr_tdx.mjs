#!/usr/bin/env node
// 高鐵班表 cron 驗收(scripts/verify_thsr_schedule.mjs V4)用的本機 TDX 替身伺服器。
// 只服務 worker.js 的 authUrl(env) 與 thsrScheduleUrl(env,dateIso) 兩個覆寫點會打的兩支端點:
//   *  /auth/token                              → 假 OAuth token(不驗證送進來的 body)
//   *  /Rail/THSR/DailyTimetable/TrainDate/:date → 固定回同一份真實 fixture(08-07,188 班)
//     不理會 :date 是哪一天 ── thsrConvertDaily(daily, dateIso, stationMap) 的 doc.date 是
//     呼叫端傳入的 dateIso 參數,不是讀 daily[].TrainDate,見 worker.js;固定回同一份即可涵蓋
//     ingestThsrSchedule 對「今天」「明天」兩次呼叫,不需要為每個可能日期各準備一份 fixture。
// GET /__state → {calls:[{method,path,at}]},供「全程零真上游」佐證(host 恆為 127.0.0.1)。
// 用法: node scripts/fixture_thsr_tdx.mjs <port>
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.argv[2] || 43991);
const FIXTURE_PATH = '/private/tmp/claude-501/-Users-xuxiang-Code------/01f4b0da-08b2-49ab-96d5-c4141b6268f2/scratchpad/thsr_td_2026-08-07.json';
const FIXTURE_BODY = readFileSync(FIXTURE_PATH, 'utf8');

const calls = [];

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  calls.push({ method: req.method, path: url.pathname, at: Date.now() });
  if (url.pathname === '/__state') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ calls }));
  }
  if (url.pathname === '/auth/token') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ access_token: 'fixture-token', expires_in: 86400 }));
  }
  if (url.pathname.startsWith('/Rail/THSR/DailyTimetable/TrainDate/')) {
    res.setHeader('content-type', 'application/json');
    return res.end(FIXTURE_BODY);
  }
  res.statusCode = 404;
  res.end('{}');
});
server.listen(PORT, '127.0.0.1', () => console.log(`"ready":true fixture_thsr_tdx on ${PORT}`));
