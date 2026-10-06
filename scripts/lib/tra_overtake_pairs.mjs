// 台鐵待避股道的共用判準（修復器 repair_tra_overtake_tracks.mjs 與閘門 verify_tra_overtake_tracks.mjs 同一份）。
// 規格：docs/specs/2026-10-06-tra-overtake-main-siding.md。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeProfiles } from '../build_run_profiles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 基準：站間長度上限、方向股道、候選節點、非電化允許清單、單雙線表都從這顆的出貨檔算，重跑自己的輸出時判準不漂移。
export const BASE_REF = '0a435fcf';
// 硬閘門釘的班表快照（14 天窗 2026-10-02～10-15）；通過時刻 tra_pass_obs.json 取同一顆。換窗不會讓閘門變紅，滾動窗另出報告。
export const SCHEDULE_REF = '882523ceb43991d0acf7749de81b427e0ccf0db5';
// 9/13 考卷：與 verify_physical_no_overlap.mjs 的 FIXTURE_REF／FIXTURE_DERIVED_REF 同一組，避免修了今天、退了考卷。
export const EXAM_REF = '132e1ebb', EXAM_DATE = '2026-09-13', EXAM_DERIVED_REF = '0ef6fa24';

const gitJSON = (ref, p) => JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${ref}:${p}`], { maxBuffer: 1 << 30, encoding: 'utf8' }));
const readJSON = p => JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8'));

// scheduleRef 為 null 時讀磁碟上的班表與通過時刻（逐週報告用）。時刻一律跑 computeProfiles（與畫面同一段推論）。
// network／dispatch 是相對樹根的路徑或絕對路徑。
export function loadOvertakeInputs({ scheduleRef = null, withExam = true, network = 'rail-3d/physical/network.json', dispatch = 'rail-3d/physical/dispatch.json' } = {}) {
  const indexPath = path.join(ROOT, 'index.html'), track = readJSON('data/tra.json');
  const sched = scheduleRef ? gitJSON(scheduleRef, 'data/tra_schedule_dense.json') : readJSON('data/tra_schedule_dense.json');
  const passObs = (scheduleRef ? gitJSON(scheduleRef, 'data/tra_pass_obs.json') : readJSON('data/tra_pass_obs.json')).trains;
  const timed = structuredClone(sched);
  computeProfiles({ indexPath, schedule: timed, track, passObs });
  const extraDays = [];
  if (withExam) {
    const examSched = gitJSON(EXAM_REF, 'data/tra_schedule_dense.json');
    assert.ok(examSched.dates[EXAM_DATE]?.length, '考卷班表沒有 ' + EXAM_DATE);
    const examTimed = structuredClone(examSched);
    computeProfiles({ indexPath, schedule: examTimed, track, passObs: gitJSON(EXAM_DERIVED_REF, 'data/tra_pass_obs.json').trains,
      trackSections: gitJSON(EXAM_DERIVED_REF, 'data/tra_track_sections.json').pairs });
    extraDays.push({ day: EXAM_DATE, sched: examSched, timed: examTimed });
  }
  return {
    net: readJSON(network), dispatch: readJSON(dispatch), sched, timed, extraDays,
    base: { net: gitJSON(BASE_REF, 'rail-3d/physical/network.json'), dispatch: gitJSON(BASE_REF, 'rail-3d/physical/dispatch.json') },
    // 單雙線表釘在 BASE_REF：這張表由路網與派車表算出（scripts/build_tra_track_sections.mjs），改派車後重產可能改判；
    // 單線交會的判準不能跟著受測的派車表漂移。重產後有沒有改判，由管線那一步另外檢查。
    sections: gitJSON(BASE_REF, 'data/tra_track_sections.json').pairs,
    protectedPlans: readJSON('scripts/fixtures/remaining-routes-0913.json').afterPlans,
    repairs: readJSON('scripts/fixtures/physical-route-conflicts-0912.json').repairs,
    taimali: readJSON('scripts/fixtures/taimali-platform-track-0912.json'),
  };
}
