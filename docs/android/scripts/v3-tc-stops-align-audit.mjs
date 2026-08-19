#!/usr/bin/env node

import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const endpoint = process.env.RAIL_TC_STOPS_URL || 'http://localhost:5399/index.html';
const output = process.env.RAIL_TC_STOPS_AUDIT_OUT
  || new URL('../shots/v3-tc-stops-align-audit.json', import.meta.url);
const source = await readFile(path.join(ROOT, 'index.html'));
const sourceMd5 = createHash('md5').update(source).digest('hex');
const onlyEngine = process.env.RAIL_TC_STOPS_ENGINE || '';

const reports = [];
for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  if (onlyEngine && engine !== onlyEngine) continue;
  console.error(`[tc-stops] launch ${engine}`);
  const browser = await launcher.launch();
  for (const viewport of [{ width: 390, height: 844 }, { width: 863, height: 360 }]) {
    console.error(`[tc-stops] ${engine} ${viewport.width}x${viewport.height} start`);
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
    await page.goto(endpoint, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#trainCard #tcStops', { state: 'attached' });
    await page.evaluate(() => {
      const card = document.getElementById('trainCard');
      const stops = document.getElementById('tcStops');
      card.hidden = false;
      document.body.appendChild(card); // 脫離手機殼內會隱藏桌面卡的祖先；卡與列本身仍用產品原 CSS
      card.style.setProperty('display', 'block', 'important');
      card.style.setProperty('position', 'fixed', 'important');
      card.style.setProperty('left', '8px', 'important');
      card.style.setProperty('top', '52px', 'important');
      card.style.setProperty('width', '340px', 'important');
      card.style.setProperty('z-index', '99999', 'important');
      stops.hidden = false;
      stops.style.display = 'block';
      stops.innerHTML = '<div class="tc-st hd"><span class="n">停靠站</span><span>到</span><span>開</span></div>'
        + [
          ['南港', '11:02', '11:04'], ['臺北', '11:12', '11:15'], ['板橋', '11:23', '11:25'],
          ['桃園', '11:42', '11:44'], ['新竹', '12:18', '12:20'], ['臺中', '13:21', '13:24'],
        ].map((row, index) => `<div class="tc-st" data-i="${index}"><span class="n">${row[0]}</span><span>${row[1]}</span><span>${row[2]}</span></div>`).join('');
    });
    await page.waitForTimeout(500);
    const measurement = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll('#tcStops .tc-st')];
      const rightEdges = row => [...row.querySelectorAll(':scope > span:not(.n)')]
        .map(element => +element.getBoundingClientRect().right.toFixed(3));
      const widths = row => [...row.querySelectorAll(':scope > span:not(.n)')]
        .map(element => +element.getBoundingClientRect().width.toFixed(3));
      const head = rightEdges(rows[0]);
      const sampleRows = () => rows.slice(1, 7).map((row, index) => ({
          index,
          rightEdges: rightEdges(row),
          widths: widths(row),
          deltaFromHeader: rightEdges(row).map((edge, column) => +(edge - rightEdges(rows[0])[column]).toFixed(3)),
        }));
      const samples = sampleRows();
      const mutation = document.createElement('style');
      mutation.textContent = '.traincard .tc-st > span:not(.n){width:auto;text-align:initial}.traincard .tc-st.hd > span:not(.n){letter-spacing:1px}';
      document.head.appendChild(mutation);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const mutationSamples = sampleRows();
      mutation.remove();
      return {
        cardVisible: getComputedStyle(document.getElementById('trainCard')).display !== 'none',
        stopsVisible: !document.getElementById('tcStops').hidden,
        rowCount: rows.length,
        headerRightEdges: head,
        headerWidths: widths(rows[0]),
        samples,
        maxAbsDelta: Math.max(...samples.flatMap(sample => sample.deltaFromHeader.map(Math.abs))),
        mutationMaxAbsDelta: Math.max(...mutationSamples.flatMap(sample => sample.deltaFromHeader.map(Math.abs))),
      };
    });
    reports.push({ engine, viewport, ...measurement });
    console.error(`[tc-stops] ${engine} ${viewport.width}x${viewport.height} delta=${measurement.maxAbsDelta} mutation=${measurement.mutationMaxAbsDelta}`);
    await context.close();
  }
  await browser.close();
  console.error(`[tc-stops] close ${engine}`);
}

const failures = reports.flatMap(report => {
  const prefix = `${report.engine}/${report.viewport.width}x${report.viewport.height}`;
  const items = [];
  if (!report.cardVisible || !report.stopsVisible) items.push(`${prefix}: card or stops hidden`);
  if (report.rowCount < 7) items.push(`${prefix}: fewer than six data rows`);
  if (report.headerWidths.some(width => width !== 36)) items.push(`${prefix}: header widths not 36px`);
  if (report.samples.some(sample => sample.widths.some(width => width !== 36))) items.push(`${prefix}: data widths not 36px`);
  if (report.maxAbsDelta > 0.5) items.push(`${prefix}: max right-edge delta ${report.maxAbsDelta}px`);
  if (report.mutationMaxAbsDelta < 10) items.push(`${prefix}: negative mutation did not misalign columns`);
  return items;
});
const report = { generatedAt: new Date().toISOString(), endpoint, sourceMd5, reports, failures };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
