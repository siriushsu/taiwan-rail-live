import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const appGroupRoot = process.env.RAIL_BOARD_ROOT;
if (!appGroupRoot) {
  throw new Error('必須以 RAIL_BOARD_ROOT 指定 Simulator App Group');
}

const sources = {
  writer: join(
    repoRoot,
    'app/ios/App/App/RailBoardScheduleWriter.swift'
  ),
  data: join(
    repoRoot,
    'app/ios/App/RailBoardWidget/RailBoardData.swift'
  ),
  widget: join(
    repoRoot,
    'app/ios/App/RailBoardWidget/RailBoardWidget.swift'
  ),
  harness: join(here, 'place_board_fallback_harness.swift'),
};
const md5 = async path => createHash('md5')
  .update(await readFile(path))
  .digest('hex');

console.log(`[G0] directory=${repoRoot}`);
for (const [name, path] of Object.entries(sources)) {
  console.log(`[G0] ${name}.md5=${await md5(path)}`);
}
console.log('[G0] byteSource=current-worktree compiledSource=current-worktree');

const binary = '/private/tmp/place-board-fallback-harness';
const report = '/private/tmp/placeboard-g7-report.json';
await execFileAsync('xcrun', [
  'swiftc',
  sources.writer,
  sources.data,
  sources.harness,
  '-o',
  binary,
], {
  cwd: repoRoot,
  maxBuffer: 32 * 1024 * 1024,
});
const result = await execFileAsync(binary, [
  appGroupRoot,
  join(repoRoot, 'data/place_index.json'),
  join(repoRoot, 'data/tra.json'),
  join(repoRoot, 'data/thsr_track.json'),
  report,
], {
  cwd: repoRoot,
  maxBuffer: 32 * 1024 * 1024,
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
console.log(`[G7] report=${report}`);
