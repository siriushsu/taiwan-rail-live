// 產生 scripts/fixtures/trip_impact_vectors.json（行程出狀況判斷的測試向量；JS 與 railcore 同跑這一份）。
// 期望值全部手寫在這裡，不從比對程式抄；薔琵颱風重播的 impacts 由人工從官方原文結構化，每筆附原文網址。
// 用法：node scripts/fixtures/build_trip_impact_vectors.mjs；改完要在 native 跑 scripts/sync-trip-impact.mjs 同步給 railcore。
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'trip_impact_vectors.json');
const T = (hm, day = '24') => `2026-10-${day}T${hm}:00+08:00`;
const tra = (train, kind, board, alight, dep, arr, route) => ({ system: 'TRA', train, kind, line: '', board, alight, boardAt: T(dep), alightAt: T(arr), ...(route ? { route } : {}) });
const thsr = (train, board, alight, dep, arr) => ({ system: 'THSR', train, kind: '', line: '', board, alight, boardAt: T(dep), alightAt: T(arr) });
const metro = (system, line, board, alight, dep, arr) => ({ system, train: '', kind: '', line, board, alight, boardAt: T(dep), alightAt: T(arr) });
const imp = o => ({ scope: '', state: '停駛', from: '', until: '', trains: [], line: '', fromStation: '', toStation: '', trainClass: '全部', fromAt: '', untilAt: '', ...o });
const sys = (id, label, impacts) => ({ id, label, impacts });
const TRA = (...impacts) => [sys('tra', '台鐵', impacts.map(imp))];
const exp = (verdict, legIndex, system, impactIndex, show, legs) => ({ verdict, legIndex, system, impactIndex, show, legs });

// 真實車次的停靠站（railcore 打包班表 shared/railcore-static/current/data/tra_schedule_dense.json，2026-11 的表；颱風當天的表可能略有不同）
const R = {
  109: '基隆,八堵,南港,臺北,板橋,桃園,中壢,新竹,竹南,苗栗,豐原,臺中,彰化,員林,斗六,嘉義,新營,善化,臺南,新左營,高雄,鳳山,九曲堂,屏東',
  125: '七堵,汐止,松山,臺北,板橋,樹林,桃園,中壢,新竹,竹南,苗栗,豐原,臺中,彰化,員林,田中,斗六,嘉義,新營,永康,臺南,新左營,高雄,鳳山,九曲堂,屏東,潮州',
  1131: '基隆,三坑,八堵,七堵,百福,五堵,汐止,汐科,南港,松山,臺北,萬華,板橋,浮洲,樹林,南樹林,山佳,鶯歌,鳳鳴,桃園,內壢,中壢,平鎮,埔心,楊梅,富岡,新富,北湖,湖口,新豐,竹北,北新竹,新竹',
  2609: '大甲,臺中港,清水,沙鹿,龍井,大肚,追分,成功,新烏日,烏日,大慶,五權,臺中',
  2527: '竹南,談文,大山,後龍,龍港,白沙屯,新埔,通霄,苑裡,日南,大甲,臺中港,清水,沙鹿,龍井,大肚,追分,彰化',
  4138: '中壢,內壢,桃園,鳳鳴,鶯歌,山佳,南樹林,樹林,浮洲,板橋,萬華,臺北,松山,南港,汐科,汐止,五堵,百福,七堵,八堵,暖暖,四腳亭,瑞芳,猴硐,三貂嶺,牡丹,雙溪,貢寮,福隆,石城,大里,大溪,龜山,外澳,頭城,頂埔,礁溪,四城,宜蘭,二結,中里,羅東,冬山,蘇澳新,蘇澳',
  4172: '樹林,浮洲,板橋,萬華,臺北,松山,南港,汐科,汐止,五堵,百福,七堵,八堵,暖暖,四腳亭,瑞芳,猴硐,三貂嶺,牡丹,雙溪,貢寮,福隆,石城,大里,大溪,龜山,外澳,頭城,頂埔,礁溪,四城,宜蘭,二結,中里,羅東,冬山,蘇澳新,蘇澳',
  4184: '宜蘭,二結,中里,羅東,冬山,蘇澳新,永樂,東澳,南澳,武塔,漢本,和平,和仁,崇德,新城,景美,北埔,花蓮',
  236: '樹林,板橋,臺北,松山,南港,宜蘭,羅東,花蓮',
  602: '花蓮,吉安,志學,壽豐,豐田,鳳林,萬榮,光復,富源,瑞穗,玉里,東里,東竹,富里,池上,關山,瑞源,鹿野,臺東',
  406: '樹林,板橋,臺北,松山,南港,七堵,宜蘭,羅東,花蓮,吉安,志學,壽豐,鳳林,光復,瑞穗,玉里,富里,池上,關山,鹿野,臺東',
  4712: '八堵,暖暖,四腳亭,瑞芳,猴硐,三貂嶺,大華,十分,望古,嶺腳,平溪,菁桐',
  4714: '瑞芳,猴硐,三貂嶺,大華,十分,望古,嶺腳,平溪,菁桐',
  4824: '八斗子,海科館,瑞芳,猴硐,三貂嶺,大華,十分,望古,嶺腳,平溪,菁桐',
  3311: '新左營,左營,內惟,美術館,鼓山,三塊厝,高雄,民族,科工館,正義,鳳山,後庄,九曲堂,六塊厝,屏東,歸來,麟洛,西勢,竹田,潮州,崁頂,南州,鎮安,林邊,佳冬,東海,枋寮',
  3171: '嘉義,水上,南靖,後壁,新營,柳營,林鳳營,隆田,拔林,善化,南科,新市,永康,大橋,臺南,保安,仁德,中洲,大湖,路竹,岡山,橋頭,楠梓,新左營,左營,內惟,美術館,鼓山,三塊厝,高雄,民族,科工館,正義,鳳山,後庄,九曲堂,六塊厝,屏東,歸來,麟洛,西勢,竹田,潮州',
  371: '臺中,新烏日,彰化,員林,斗六,嘉義,新營,臺南,岡山,新左營,高雄,鳳山,屏東,潮州,枋寮,大武,金崙,太麻里,知本,臺東',
  472: '員林,彰化,臺中,豐原,苗栗,竹南,新竹,中壢,桃園,樹林,板橋,臺北,松山,七堵,宜蘭,羅東,花蓮,吉安,壽豐,鳳林,光復,瑞穗,玉里,富里,池上,關山,鹿野,臺東',
  271: '花蓮,羅東,宜蘭,礁溪,七堵,松山,臺北,板橋,桃園,中壢,新竹,苗栗,豐原,臺中,彰化',
  5216: '樹林,板橋,臺北,松山,南港,七堵,宜蘭,羅東,花蓮',
  432: '樹林,板橋,臺北,松山,南港,七堵,宜蘭,羅東,花蓮,鳳林,光復,瑞穗,玉里,池上,關山,臺東,知本,太麻里,金崙,大武,枋寮,林邊,南州,潮州,屏東,鳳山,高雄,新左營',
  3288: '潮州,竹田,西勢,麟洛,歸來,屏東,六塊厝,九曲堂,後庄,鳳山,正義,科工館,民族,高雄,三塊厝,鼓山,美術館,內惟,左營,新左營,楠梓,橋頭,岡山,路竹,大湖,中洲,仁德,保安,臺南,大橋,永康,新市,南科,善化',
  157: '七堵,汐止,松山,臺北,板橋,樹林,桃園,中壢,新豐,竹北,新竹,竹南,苗栗',
};
const route = n => R[n].split(',');

// ── (b) 薔琵颱風重播：人工結構化的 impacts ─────────────────────────────
const U = {
  tra2130: 'https://www.railway.gov.tw/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=8ae4cac3a1650e3a01a16906f5681318&page=0',
  tra1130: 'https://www.railway.gov.tw/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=8ae4cac2a16a254301a16c15868d53b5&page=0',
  trtc24: 'https://www.metro.taipei/News_Content.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6&s=D24768D861F3702F',
  trtc1710: 'https://www.metro.taipei/News_Content.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6&s=649A1A69E7BC170D',
  trtc1200: 'https://www.metro.taipei/News_Content.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6&s=07211C1B52E9F4FE',
  thsr: 'https://www.thsrc.com.tw/',
};
const NOON = T('12:00');
const A = [
  sys('tra', '台鐵', [
    /* 0 */ imp({ scope: '西部幹線 基隆=彰化 對號列車', state: '停駛', until: '24日12時', line: 'WL', fromStation: '基隆', toStation: '彰化', trainClass: '對號', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 1 */ imp({ scope: '西部幹線 彰化=高雄=枋寮 各級列車', state: '正常', until: '24日12時', line: 'WL', fromStation: '彰化', toStation: '枋寮', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 2 */ imp({ scope: '海線 非對號列車 全區間', state: '停駛', until: '24日12時', line: 'WL-C', trainClass: '非對號', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 3 */ imp({ scope: '成追線 非對號列車 全區間', state: '停駛', until: '24日12時', line: 'CZ', trainClass: '非對號', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 4 */ imp({ scope: '基隆=彰化 其餘非對號列車 視風雨情形機動行駛', state: '減班或改點', until: '24日12時', line: 'WL', fromStation: '基隆', toStation: '彰化', trainClass: '非對號', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 5 */ imp({ scope: '472、102、280、270 次全區間', state: '停駛', until: '24日12時', trains: ['472', '102', '280', '270'], untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 6 */ imp({ scope: '101 次臺中=潮州、191 次臺中=潮州、371 次臺中=臺東全區間', state: '正常', until: '24日12時', trains: ['101', '191', '371'], untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 7 */ imp({ scope: '東部幹線 樹林=宜蘭=花蓮 各級列車（東部幹線部分記成八堵=花蓮；樹林=八堵併在西部幹線那幾筆）', state: '停駛', until: '24日12時', line: 'EL', fromStation: '八堵', toStation: '花蓮', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 8 */ imp({ scope: '東部幹線 花蓮=臺東 各級列車', state: '正常', until: '24日12時', line: 'EL', fromStation: '花蓮', toStation: '臺東', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 9 */ imp({ scope: '207 次全區間', state: '停駛', until: '24日12時', trains: ['207'], untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 10 */ imp({ scope: '南迴線', state: '正常', until: '24日12時', line: 'SL', fromStation: '枋寮', toStation: '臺東', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 11 */ imp({ scope: '六家線', state: '正常', until: '24日12時', line: 'LJ', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 12 */ imp({ scope: '集集線', state: '正常', until: '24日12時', line: 'JJ', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 13 */ imp({ scope: '沙崙線', state: '正常', until: '24日12時', line: 'SH', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 14 */ imp({ scope: '平溪線全區間', state: '停駛', until: '24日12時', line: 'PX', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 15 */ imp({ scope: '深澳線全區間', state: '停駛', until: '24日12時', line: 'SA', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 16 */ imp({ scope: '內灣線全區間', state: '停駛', until: '24日12時', line: 'NW', untilAt: NOON, sourceUrl: U.tra2130 }),
    /* 17 */ imp({ scope: '1 次、2 次環島之星全日', state: '停駛', trains: ['1', '2'], fromAt: T('00:00'), untilAt: T('00:00', '25'), sourceUrl: U.tra2130 }),
    /* 18 */ imp({ scope: '24 日 12 時之後行車資訊預定 24 日 8 時公告', state: '未確認', from: '24日12時', line: '*', fromAt: NOON, sourceUrl: U.tra2130 }),
  ]),
  sys('trtc', '台北捷運', [
    /* 0 */ imp({ scope: '文湖線', state: '停駛', from: '23日18時', until: '24日首班車另行通知', line: '文湖線', fromAt: T('18:00', '23'), sourceUrl: U.trtc24 }),
    /* 1 */ imp({ scope: '淡水信義線 圓山=淡水（高架、平面路段）', state: '停駛', from: '23日18時', line: '淡水信義線', fromStation: '圓山', toStation: '淡水', fromAt: T('18:00', '23'), sourceUrl: U.trtc1710 }),
    /* 2 */ imp({ scope: '新北投線', state: '停駛', from: '23日18時', line: '新北投線', fromAt: T('18:00', '23'), sourceUrl: U.trtc1710 }),
    /* 3 */ imp({ scope: '小碧潭線', state: '停駛', from: '23日18時', line: '小碧潭線', fromAt: T('18:00', '23'), sourceUrl: U.trtc1710 }),
    /* 4 */ imp({ scope: '淡水信義線地下段 班距約 12 分鐘', state: '減班或改點', line: '淡水信義線', sourceUrl: U.trtc24 }),
    /* 5 */ imp({ scope: '松山新店線 班距約 12 分鐘', state: '減班或改點', line: '松山新店線', sourceUrl: U.trtc24 }),
    /* 6 */ imp({ scope: '板南線 班距約 12 分鐘', state: '減班或改點', line: '板南線', sourceUrl: U.trtc24 }),
    /* 7 */ imp({ scope: '中和新蘆線 班距約 12 分鐘', state: '減班或改點', line: '中和新蘆線', sourceUrl: U.trtc24 }),
  ]),
  sys('thsr', '台灣高鐵', [
    /* 0 */ imp({ scope: '全線', state: '正常', line: 'THSR', sourceUrl: U.thsr }),
  ]),
];
const B = [
  sys('tra', '台鐵', [
    /* 0 */ imp({ scope: '西部幹線 基隆=潮州=枋寮', state: '正常', from: '24日12時後', line: 'WL', fromStation: '基隆', toStation: '枋寮', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 1 */ imp({ scope: '北迴線、宜蘭線 路樹倒塌搶修中', state: '停駛', until: '預計15時恢復', line: 'EL', fromStation: '八堵', toStation: '花蓮', untilAt: T('15:00'), sourceUrl: U.tra1130 }),
    /* 2 */ imp({ scope: '432 次樹林=花蓮（臺北 15:00）、273 次花蓮=彰化（花蓮 14:18）恢復', state: '正常', trains: ['432', '273'], fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 3 */ imp({ scope: '5233 次花蓮=樹林、5249 次臺東=樹林、5216 次樹林=花蓮', state: '停駛', trains: ['5233', '5249', '5216'], fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 4 */ imp({ scope: '東部幹線 樹林=花蓮 部分非對號列車截短或停駛（記成八堵=花蓮）', state: '部分停駛', from: '24日12時後', line: 'EL', fromStation: '八堵', toStation: '花蓮', trainClass: '非對號', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 5 */ imp({ scope: '271 次花蓮=松山間停駛，改由松山特開（松山 12:35）', state: '停駛', trains: ['271'], line: 'EL', fromStation: '花蓮', toStation: '松山', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 6 */ imp({ scope: '277 次花蓮=七堵間停駛，改由七堵特開（七堵 17:09）', state: '停駛', trains: ['277'], line: 'EL', fromStation: '花蓮', toStation: '七堵', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 7 */ imp({ scope: '281 次花蓮=七堵間停駛，改由七堵特開（七堵 19:01）', state: '停駛', trains: ['281'], line: 'EL', fromStation: '花蓮', toStation: '七堵', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 8 */ imp({ scope: '南迴線 新左營=臺東', state: '正常', from: '24日12時後', line: 'SL', fromStation: '新左營', toStation: '臺東', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 9 */ imp({ scope: '六家線', state: '正常', line: 'LJ', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 10 */ imp({ scope: '集集線', state: '正常', line: 'JJ', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 11 */ imp({ scope: '沙崙線', state: '正常', line: 'SH', fromAt: NOON, sourceUrl: U.tra1130 }),
    /* 12 */ imp({ scope: '平溪線 俟路線巡查完畢後恢復', state: '停駛', until: '俟路線巡查完畢後', line: 'PX', sourceUrl: U.tra1130 }),
    /* 13 */ imp({ scope: '深澳線 俟路線巡查完畢後恢復', state: '停駛', until: '俟路線巡查完畢後', line: 'SA', sourceUrl: U.tra1130 }),
    /* 14 */ imp({ scope: '內灣線 俟路線巡查完畢後恢復', state: '停駛', until: '俟路線巡查完畢後', line: 'NW', sourceUrl: U.tra1130 }),
    /* 15 */ imp({ scope: '1 次、2 次環島之星全日', state: '停駛', trains: ['1', '2'], fromAt: T('00:00'), untilAt: T('00:00', '25'), sourceUrl: U.tra1130 }),
  ]),
  sys('trtc', '台北捷運', [
    /* 0 */ imp({ scope: '全系統維持營運', state: '正常', line: '*', sourceUrl: U.trtc1200 }),
    /* 1 */ imp({ scope: '文湖線 班距由 12 分鐘逐步調整至 8 至 9 分 30 秒', state: '減班或改點', line: '文湖線', sourceUrl: U.trtc1200 }),
    /* 2 */ imp({ scope: '淡水信義線 班距逐步加密', state: '減班或改點', line: '淡水信義線', sourceUrl: U.trtc1200 }),
    /* 3 */ imp({ scope: '松山新店線 班距逐步加密', state: '減班或改點', line: '松山新店線', sourceUrl: U.trtc1200 }),
    /* 4 */ imp({ scope: '板南線 班距逐步加密', state: '減班或改點', line: '板南線', sourceUrl: U.trtc1200 }),
    /* 5 */ imp({ scope: '中和新蘆線 班距逐步加密', state: '減班或改點', line: '中和新蘆線', sourceUrl: U.trtc1200 }),
  ]),
  sys('thsr', '台灣高鐵', [
    /* 0 */ imp({ scope: '全線', state: '正常', line: 'THSR', sourceUrl: U.thsr }),
  ]),
];

const cases = [];
const add = (group, id, rule, o) => cases.push({ id, group, rule, ...o });

// ── (a) 規則逐條 ──────────────────────────────────────────────
const L109 = tra('109', '自強', '臺北', '新竹', '08:13', '09:23', route(109));
const NOW = T('07:00');
add('rule', 'sys-other-system', '1', { now: NOW, systems: [sys('thsr', '台灣高鐵', [imp({ line: '*' })])], legs: [L109], expect: exp('clear', -1, null, -1, false, ['clear']), reason: '只有高鐵停駛，台鐵這段不看高鐵的 impact；行程沒用到高鐵 ⇒ 不顯示' });
add('rule', 'time-ended-before', '2', { now: NOW, systems: TRA({ line: '*', untilAt: T('08:00') }), legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '08:00 已結束，這段 08:13 才上車；但 now 07:00 時還沒結束 ⇒ 顯示' });
add('rule', 'time-until-equals-board', '2', { now: NOW, systems: TRA({ line: '*', untilAt: T('08:13') }), legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: 'untilAt 等於上車時刻 ⇒ 半開區間，沒交集' });
add('rule', 'time-starts-after', '2', { now: NOW, systems: TRA({ line: '*', fromAt: T('10:00') }), legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '10:00 才開始，這段 09:23 已到；未來的停駛仍要顯示' });
add('rule', 'time-from-equals-alight', '2', { now: NOW, systems: TRA({ line: '*', fromAt: T('09:23') }), legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: 'fromAt 等於下車時刻 ⇒ 沒交集' });
add('rule', 'time-overlap', '2', { now: NOW, systems: TRA({ line: '*', fromAt: T('09:00') }), legs: [L109], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '09:00 起停駛，這段 09:23 才到 ⇒ 有交集' });
add('rule', 'time-unparseable', '2', { now: NOW, systems: TRA({ line: '*', fromAt: '明天', untilAt: '俟巡查完畢' }), legs: [L109], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '時刻解析不了 ⇒ 當空字串（已生效、還沒結束）' });
add('rule', 'time-iso-utc', '2', { now: NOW, systems: TRA({ line: '*', untilAt: '2026-10-24T00:13:00Z' }), legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: 'Z 時區：00:13Z＝台北 08:13＝上車時刻 ⇒ 沒交集' });
add('rule', 'time-iso-no-tz', '2', { now: NOW, systems: TRA({ line: '*', untilAt: '2026-10-24 08:14' }), legs: [L109], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '沒寫時區＝+08:00，08:14 晚於上車 08:13 ⇒ 有交集' });

add('rule', 'named-stopped', '3', { now: NOW, systems: TRA({ trains: ['109'] }), legs: [L109], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '車次被點名停駛' });
add('rule', 'named-leading-zero', '3', { now: NOW, systems: TRA({ trains: ['0109'] }), legs: [L109], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '比較前去前導 0' });
add('rule', 'named-normal-overrides-range', '3（補：點名優先）', { now: NOW, systems: TRA({ line: 'WL', fromStation: '基隆', toStation: '彰化', trainClass: '對號' }, { state: '正常', trains: ['109'] }), legs: [L109], expect: exp('clear', 0, 'tra', 1, true, ['clear']), reason: '基隆=彰化對號停駛，但 109 次被點名正常行駛 ⇒ 依那筆不受影響' });
add('rule', 'named-outside-its-range', '3（補）', { now: NOW, systems: TRA({ trains: ['271'], line: 'EL', fromStation: '花蓮', toStation: '松山' }), legs: [tra('271', '自強', '臺北', '臺中', '12:45', '14:38', route(271))], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '271 次花蓮=松山停駛，這段臺北上車不在停駛區間 ⇒ 可能受影響' });
add('rule', 'named-inside-its-range', '3', { now: NOW, systems: TRA({ trains: ['271'], line: 'EL', fromStation: '花蓮', toStation: '松山' }), legs: [tra('271', '自強', '花蓮', '宜蘭', '10:19', '11:25', route(271))], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '這段在 271 次停駛的區間裡' });
add('rule', 'trains-other-no-range', '3（補）', { now: NOW, systems: TRA({ trains: ['472'] }), legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '只點名 472 次、沒有範圍 ⇒ 跟 109 次無關' });
add('rule', 'trains-other-with-range', '3（補）', { now: NOW, systems: TRA({ trains: ['5233'], line: 'EL', fromStation: '八堵', toStation: '花蓮' }), legs: [tra('4138', '區間車', '宜蘭', '羅東', '08:37', '08:48', route(4138))], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '點名 5233 次在八堵=花蓮停駛，講的是那一班；同區間別班車不適用' });
add('rule', 'trains-other-partial-range', '3（補）', { now: NOW, systems: TRA({ state: '部分停駛', trains: ['5233'], line: 'EL', fromStation: '八堵', toStation: '花蓮' }), legs: [tra('4138', '區間車', '宜蘭', '羅東', '08:37', '08:48', route(4138))], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '「部分停駛」又列了車次：區間只有部分車停、列出的不一定是全部 ⇒ 同區間別班車可能受影響' });
add('rule', 'trains-other-normal', '3（補）', { now: NOW, systems: TRA({ state: '正常', trains: ['101'], line: 'WL' }), legs: [L109], expect: exp('clear', -1, null, -1, false, ['clear']), reason: '101 次正常不能當 109 次的依據' });

const range = { line: 'WL', fromStation: '基隆', toStation: '彰化' };
add('rule', 'class-mismatch', '4', { now: NOW, systems: TRA({ ...range, trainClass: '對號' }), legs: [tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48', route(1131))], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '只停對號，區間車不適用' });
add('rule', 'class-match', '4', { now: NOW, systems: TRA({ ...range, trainClass: '對號' }), legs: [L109], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '自強是對號' });
add('rule', 'class-unknown-in-range', '4（補）', { now: NOW, systems: TRA({ ...range, trainClass: '對號' }), legs: [tra('9001', '電車', '臺北', '桃園', '08:00', '08:40')], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '「電車」認不得，範圍涵蓋 ⇒ 可能受影響' });
add('rule', 'class-unknown-out-of-range', '4（補）', { now: NOW, systems: TRA({ ...range, trainClass: '對號' }), legs: [tra('9002', '電車', '新左營', '潮州', '09:04', '10:18')], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '認不得車種但範圍不涵蓋 ⇒ 不適用' });
add('rule', 'class-empty-kind', '4', { now: NOW, systems: TRA({ ...range, trainClass: '非對號' }), legs: [tra('9003', '', '臺北', '桃園', '08:00', '08:40')], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '沒有車種＝認不得' });
add('rule', 'class-express-local', '4', { now: NOW, systems: TRA({ ...range, trainClass: '非對號' }), legs: [tra('2007', '區間快', '臺北', '新竹', '09:00', '10:00')], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '區間快是非對號' });

add('rule', 'range-star', '5', { now: NOW, systems: TRA({ line: '*' }), legs: [tra('3311', '區間車', '新左營', '潮州', '09:04', '10:18', route(3311))], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '全系統停駛' });
add('rule', 'range-touch-endpoint', '5', { now: NOW, systems: TRA(range), legs: [tra('3137', '區間車', '彰化', '員林', '08:23', '08:40')], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '只在彰化碰到範圍的端點 ⇒ 不算' });
add('rule', 'range-overlap', '5', { now: NOW, systems: TRA(range), legs: [tra('3227', '區間車', '臺中', '彰化', '13:44', '14:07')], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '臺中=彰化在基隆=彰化裡' });
add('rule', 'range-route-passes', '5', { now: NOW, systems: TRA({ line: 'EL', fromStation: '宜蘭', toStation: '花蓮' }), legs: [tra('472', '自強', '臺北', '松山', '08:43', '08:50', route(472))], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '這段臺北=松山不在範圍，但這班車後面要經過宜蘭=花蓮 ⇒ 可能被截短或停駛' });
add('rule', 'range-no-route-outside', '5', { now: NOW, systems: TRA({ line: 'EL', fromStation: '宜蘭', toStation: '花蓮' }), legs: [tra('472', '自強', '臺北', '松山', '08:43', '08:50')], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '沒給 route ⇒ 只看這段' });
add('rule', 'range-line-only', '5', { now: NOW, systems: TRA({ line: 'PX' }), legs: [tra('4712', '區間車', '十分', '平溪', '08:37', '08:50', route(4712))], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '平溪線整條停駛' });
add('rule', 'range-line-only-route', '5', { now: NOW, systems: TRA({ line: 'PX' }), legs: [tra('4714', '區間車', '瑞芳', '猴硐', '09:20', '09:27', route(4714))], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '這段在宜蘭線上，但這班車要開進平溪線' });
add('rule', 'range-unreadable', '5', { now: NOW, systems: TRA({ scope: '行經停駛區間之加班車' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: 'line、站都空又不是 * ⇒ 看不懂 ⇒ 可能受影響' });
add('rule', 'range-unknown-station', '5', { now: NOW, systems: TRA({ line: 'WL', fromStation: '臺北', toStation: '火星' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '站名不在站序資料 ⇒ 看不懂' });
add('rule', 'range-one-end-only', '5', { now: NOW, systems: TRA({ line: 'WL', fromStation: '臺北' }), legs: [tra('3311', '區間車', '新左營', '潮州', '09:04', '10:18')], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '只寫一端 ⇒ 看不懂（就算在南部也不能說不受影響）' });
add('rule', 'range-unknown-line-code', '5', { now: NOW, systems: TRA({ line: '縱貫線' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '路線代號不在清單 ⇒ 看不懂' });
add('rule', 'range-sea-line-bypass', '5', { now: NOW, systems: TRA(range), legs: [tra('2609', '區間車', '大甲', '沙鹿', '08:25', '08:42', route(2609))], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '海線兩端竹南、彰化都在基隆=彰化裡 ⇒ 海線算在範圍內' });
add('rule', 'range-sea-line-not-covered', '5', { now: NOW, systems: TRA({ line: 'WL', fromStation: '苗栗', toStation: '彰化' }), legs: [tra('2527', '區間車', '大甲', '沙鹿', '13:31', '13:47', route(2527))], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '苗栗=彰化不含竹南 ⇒ 海線不在範圍' });
add('rule', 'range-chengzhui-bypass', '5（補）', { now: NOW, systems: TRA({ line: 'WL', fromStation: '竹南', toStation: '彰化' }), legs: [tra('2609', '區間車', '追分', '成功', '08:51', '08:54', route(2609))], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '竹南=彰化含海線，成追線兩端也都在範圍內' });
add('rule', 'range-sea-impact-mountain-leg', '5', { now: NOW, systems: TRA({ line: 'WL-C' }), legs: [tra('109', '自強', '竹南', '臺中', '09:30', '10:10', route(109))], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '海線停駛，109 次走山線 ⇒ 不適用' });
add('rule', 'range-cross-line', '5（補）', { now: NOW, systems: TRA({ line: 'EL', fromStation: '樹林', toStation: '花蓮' }), legs: [tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48', route(1131))], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '樹林=花蓮跨兩條線，最短路經過臺北=樹林 ⇒ 臺北=桃園的前半段在範圍內' });
add('rule', 'range-cross-line-touch', '5', { now: NOW, systems: TRA({ line: 'EL', fromStation: '樹林', toStation: '花蓮' }), legs: [tra('602', '莒光', '花蓮', '臺東', '06:34', '08:17', route(602))], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '花蓮=臺東只碰到端點花蓮' });
add('rule', 'range-prefer-given-line', '5（補）', { now: NOW, systems: TRA({ line: 'WL', fromStation: '基隆', toStation: '枋寮' }), legs: [tra('4138', '區間車', '宜蘭', '羅東', '08:37', '08:48')], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '西部幹線基隆=枋寮沿縱貫線走，不因東部繞過去比較短就算到宜蘭線' });
add('rule', 'range-prefer-given-line-tail', '5（補）', { now: NOW, systems: TRA({ line: 'WL', fromStation: '基隆', toStation: '枋寮' }), legs: [tra('3171', '區間車', '屏東', '潮州', '13:24', '13:43')], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '基隆=枋寮跨到屏東線（屏東=枋寮）' });
add('rule', 'range-tai-normalize', '5', { now: NOW, systems: TRA({ line: 'EL', fromStation: '花蓮', toStation: '台東' }), legs: [tra('602', '莒光', '花蓮', '台東', '06:34', '08:17')], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '「台東」「臺東」同一站' });
add('rule', 'range-single-station', '5（補）', { now: NOW, systems: TRA({ line: 'WL', fromStation: '臺北', toStation: '臺北' }), legs: [tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48')], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '範圍只有一站：這段在那站上車 ⇒ 涵蓋' });
// 單站事項（C）：起訖同一站＝那站暫停停靠／封站；這段在那站上車或下車才算涵蓋（依 state），只是經過不算
const BQ = { scope: '板橋站 暫停停靠', line: 'WL', fromStation: '板橋', toStation: '板橋' };
add('rule', 'single-station-board', '5（補：單站）', { now: NOW, systems: TRA(BQ), legs: [tra('1131', '區間車', '板橋', '桃園', '08:10', '08:48', route(1131))], expect: exp('hit', 0, 'tra', 0, true, ['hit']), reason: '板橋站暫停停靠（停駛），這段在板橋上車 ⇒ 受影響' });
add('rule', 'single-station-alight-by-state', '5（補：單站）', { now: NOW, systems: TRA({ ...BQ, state: '減班或改點' }), legs: [tra('1131', '區間車', '臺北', '板橋', '08:03', '08:10', route(1131))], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '在板橋下車＝涵蓋，依 state（減班或改點）⇒ 可能受影響' });
add('rule', 'single-station-passing', '5（補：單站）', { now: NOW, systems: TRA(BQ), legs: [tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48', route(1131))], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '1131 次臺北=桃園只是經過板橋（中途站）⇒ 不算涵蓋；台鐵有非正常 ⇒ 顯示' });
add('rule', 'single-station-passing-no-route', '5（補：單站）', { now: NOW, systems: TRA(BQ), legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '109 次臺北=新竹經過板橋，不在板橋上下車 ⇒ 不算涵蓋（route 經過也不算）' });
add('rule', 'single-station-thsr-passing', '5（補：單站）', { now: NOW, systems: [sys('thsr', '台灣高鐵', [imp({ scope: '板橋站 暫停停靠', line: 'THSR', fromStation: '板橋', toStation: '板橋' })])], legs: [thsr('0809', '台北', '新竹', '08:11', '08:40')], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '高鐵板橋站暫停停靠，台北=新竹只是經過 ⇒ 不受影響' });
add('rule', 'single-station-thsr-board', '5（補：單站）', { now: NOW, systems: [sys('thsr', '台灣高鐵', [imp({ scope: '板橋站 暫停停靠', line: 'THSR', fromStation: '板橋', toStation: '板橋' })])], legs: [thsr('0809', '板橋', '新竹', '08:20', '08:40')], expect: exp('hit', 0, 'thsr', 0, true, ['hit']), reason: '在高鐵板橋站上車（「板橋」對上站序的「板橋」）⇒ 受影響' });
add('rule', 'single-station-named-passing', '3（補：單站）', { now: NOW, systems: TRA({ ...BQ, scope: '1131 次 板橋站不停靠', trains: ['1131'] }), legs: [tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48', route(1131))], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '點名 1131 次在板橋站的事項，這段只經過板橋 ⇒ 跟「點名但不在它的區間」一樣落可能受影響' });
add('rule', 'single-station-unknown-name', '5（補：單站）', { now: NOW, systems: TRA({ ...BQ, fromStation: '火星', toStation: '火星' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '單站但站名不在站序資料 ⇒ 看不懂 ⇒ 可能受影響' });
add('rule', 'single-station-metro-board', '5（補：單站）', { now: NOW, systems: [sys('trtc', '台北捷運', [imp({ scope: '忠孝復興站 封站', line: '板南線', fromStation: '忠孝復興', toStation: '忠孝復興' })])], legs: [metro('TRTC', '板南線', '忠孝復興', '台北車站', '08:00', '08:06')], expect: exp('hit', 0, 'trtc', 0, true, ['hit']), reason: '捷運單站：在那站上車 ⇒ 涵蓋（停駛 ⇒ 受影響）' });
add('rule', 'single-station-metro-passing', '5（補：單站）', { now: NOW, systems: [sys('trtc', '台北捷運', [imp({ scope: '忠孝復興站 封站', line: '板南線', fromStation: '忠孝復興', toStation: '忠孝復興' })])], legs: [metro('TRTC', '板南線', '市政府', '台北車站', '08:00', '08:10')], expect: exp('maybe', 0, 'trtc', 0, true, ['maybe']), reason: '捷運沒有站序資料，分不出「只是經過」跟「站名對不上」⇒ 照捷運有站名區間的規則落可能受影響' });

// 舊格式（A）：P4 之前的整理只有 scope／state／from／until／trains，沒有 line 這個 key ⇒ 整筆跳過，也不算進 show
const OLD_BIKE = { scope: '板橋站 自行車兩鐵上下車業務（每週五至週日）', state: '停駛', from: '2026-11-13', until: '2026-12-27', trains: [] };
add('rule', 'old-format-skipped', '0（補：舊格式）', { now: NOW, systems: [sys('tra', '台鐵', [OLD_BIKE])], legs: [L109], expect: exp('clear', -1, null, -1, false, ['clear']), reason: '舊格式停駛：不比對、不顯示（以前看不懂＝可能受影響，正常日每趟台鐵都亮）' });
add('rule', 'old-format-named-train-skipped', '0（補：舊格式）', { now: NOW, systems: [sys('tra', '台鐵', [{ scope: '109 次停駛', state: '停駛', from: '', until: '', trains: ['109'] }])], legs: [L109], expect: exp('clear', -1, null, -1, false, ['clear']), reason: '舊格式就算點名這段的車次也整筆跳過' });
add('rule', 'old-format-with-new', '0（補：舊格式）', { now: NOW, systems: [sys('tra', '台鐵', [OLD_BIKE, imp({ scope: '平溪線全區間', line: 'PX' })])], legs: [L109], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '舊格式那筆跳過；新格式平溪線停駛跟這段無關但還沒結束 ⇒ 顯示' });
add('rule', 'new-format-empty-fields', '5（新格式空欄位）', { now: NOW, systems: TRA({ scope: OLD_BIKE.scope }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '同一件事用新格式寫、line／站都是空字串（key 在）⇒ 仍是看不懂＝可能受影響' });
add('rule', 'thsr-range-hit', '5', { now: NOW, systems: [sys('thsr', '台灣高鐵', [imp({ line: 'THSR', fromStation: '台北', toStation: '台中' })])], legs: [thsr('0809', '板橋', '新竹', '08:20', '08:50')], expect: exp('hit', 0, 'thsr', 0, true, ['hit']), reason: '板橋=新竹在台北=台中裡' });
add('rule', 'thsr-range-clear', '5', { now: NOW, systems: [sys('thsr', '台灣高鐵', [imp({ line: 'THSR', fromStation: '台北', toStation: '台中' })])], legs: [thsr('0809', '嘉義', '左營', '09:50', '10:20')], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '嘉義=左營不在範圍' });
add('rule', 'thsr-line-reduced', '6', { now: NOW, systems: [sys('thsr', '台灣高鐵', [imp({ line: 'THSR', state: '減班或改點' })])], legs: [thsr('0809', '台北', '台中', '08:11', '09:15')], expect: exp('maybe', 0, 'thsr', 0, true, ['maybe']), reason: '全線減班' });
add('rule', 'thsr-ignores-class', '4（補）', { now: NOW, systems: [sys('thsr', '台灣高鐵', [imp({ line: '*', trainClass: '對號' })])], legs: [thsr('0809', '台北', '台中', '08:11', '09:15')], expect: exp('hit', 0, 'thsr', 0, true, ['hit']), reason: '車種規則只用在台鐵' });

const TRTC = (...impacts) => [sys('trtc', '台北捷運', impacts.map(imp))];
add('rule', 'metro-line-hit', '5', { now: NOW, systems: TRTC({ line: '文湖線' }), legs: [metro('TRTC', '文湖線', '南港展覽館', '松山機場', '08:00', '08:15')], expect: exp('hit', 0, 'trtc', 0, true, ['hit']), reason: '文湖線停駛' });
add('rule', 'metro-line-alias-branch', '5（補：線名正規化）', { now: NOW, systems: TRTC({ line: '中和新蘆線' }), legs: [metro('TRTC', '中和新蘆線（蘆洲）', '三重國小', '大橋頭', '08:00', '08:08')], expect: exp('hit', 0, 'trtc', 0, true, ['hit']), reason: '規劃器的「中和新蘆線（蘆洲）」＝公告的中和新蘆線' });
add('rule', 'metro-line-alias-zhixian', '5（補：線名正規化）', { now: NOW, systems: TRTC({ line: '新北投線' }), legs: [metro('TRTC', '新北投支線', '北投', '新北投', '08:00', '08:03')], expect: exp('hit', 0, 'trtc', 0, true, ['hit']), reason: '「新北投支線」＝「新北投線」' });
add('rule', 'metro-line-mismatch', '5', { now: NOW, systems: TRTC({ line: '文湖線' }), legs: [metro('TRTC', '板南線', '忠孝復興', '台北車站', '08:00', '08:06')], expect: exp('clear', -1, null, -1, true, ['clear']), reason: '不同線' });
add('rule', 'metro-station-range', '5', { now: NOW, systems: TRTC({ line: '淡水信義線', fromStation: '圓山', toStation: '淡水' }), legs: [metro('TRTC', '淡水信義線', '台北車站', '大安', '08:00', '08:08')], expect: exp('maybe', 0, 'trtc', 0, true, ['maybe']), reason: '捷運有站名區間一律可能受影響（這一版不算捷運站序）' });
add('rule', 'metro-unreadable', '5', { now: NOW, systems: TRTC({ scope: '部分路段' }), legs: [metro('TRTC', '板南線', '忠孝復興', '台北車站', '08:00', '08:06')], expect: exp('maybe', 0, 'trtc', 0, true, ['maybe']), reason: '看不懂' });
add('rule', 'metro-ntmetro-circular', '1（補：環狀線兩邊都看）', { now: NOW, systems: [sys('ntmetro', '新北捷運', [imp({ line: '環狀線' })])], legs: [metro('TRTC', '環狀線', '大坪林', '板橋', '08:00', '08:25')], expect: exp('hit', 0, 'ntmetro', 0, true, ['hit']), reason: '環狀線由新北捷運營運' });
add('rule', 'metro-ntmetro-not-bannan', '1（補）', { now: NOW, systems: [sys('ntmetro', '新北捷運', [imp({ line: '*' })])], legs: [metro('TRTC', '板南線', '忠孝復興', '台北車站', '08:00', '08:06')], expect: exp('clear', -1, null, -1, false, ['clear']), reason: '新北捷運全停不影響板南線；行程也沒用到新北捷運 ⇒ 不顯示' });
add('rule', 'metro-tymc', '6', { now: NOW, systems: [sys('tymc', '桃園機場捷運', [imp({ line: '*', state: '減班或改點' })])], legs: [metro('TYMC', '機場捷運', '台北車站', '機場第一航廈', '08:00', '08:40')], expect: exp('maybe', 0, 'tymc', 0, true, ['maybe']), reason: '機捷減班' });
add('rule', 'metro-leg-line-unknown', '5', { now: NOW, systems: TRTC({ line: '文湖線' }), legs: [metro('TRTC', '', '大安', '中山', '08:00', '08:10')], expect: exp('maybe', 0, 'trtc', 0, true, ['maybe']), reason: '行程端不知道是哪條線 ⇒ 看不懂' });

add('rule', 'state-partial', '6', { now: NOW, systems: TRA({ ...range, state: '部分停駛' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '部分停駛 ⇒ 可能受影響' });
add('rule', 'state-reduced', '6', { now: NOW, systems: TRA({ ...range, state: '減班或改點' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '減班或改點 ⇒ 可能受影響' });
add('rule', 'state-unconfirmed', '6', { now: NOW, systems: TRA({ ...range, state: '未確認' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '未確認 ⇒ 可能受影響' });
add('rule', 'state-normal-basis', '6', { now: NOW, systems: TRA({ ...range, state: '正常' }), legs: [L109], expect: exp('clear', 0, 'tra', 0, false, ['clear']), reason: '涵蓋而且正常 ⇒ 依這筆不受影響；全是正常 ⇒ 不顯示' });
add('rule', 'state-unknown-word', '6', { now: NOW, systems: TRA({ ...range, state: '延誤' }), legs: [L109], expect: exp('maybe', 0, 'tra', 0, true, ['maybe']), reason: '不在清單的狀態當未確認' });
add('rule', 'none', '7', { now: NOW, systems: [], legs: [L109], expect: exp('clear', -1, null, -1, false, ['clear']), reason: '沒有任何整理 ⇒ 不受影響、沒有依據、不顯示' });

add('rule', 'trip-worst-first', '整趟', { now: NOW, systems: TRA({ line: 'PX' }, { line: 'WL', fromStation: '基隆', toStation: '彰化', state: '減班或改點' }, { line: 'EL', fromStation: '八堵', toStation: '花蓮' }),
  legs: [tra('3311', '區間車', '新左營', '潮州', '06:00', '07:00'), tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48'), tra('4712', '區間車', '十分', '平溪', '09:37', '09:50'), tra('4138', '區間車', '宜蘭', '羅東', '10:37', '10:48')],
  expect: exp('hit', 2, 'tra', 0, true, ['clear', 'maybe', 'hit', 'hit']), reason: '最嚴重的是受影響，取第一個受影響的段（第 3 段平溪線）' });
add('rule', 'trip-tie-first', '整趟', { now: NOW, systems: TRA({ line: '*', state: '減班或改點' }), legs: [tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48'), tra('3311', '區間車', '新左營', '潮州', '09:04', '10:18')], expect: exp('maybe', 0, 'tra', 0, true, ['maybe', 'maybe']), reason: '同樣嚴重取第一段' });
add('rule', 'trip-clear-basis-later-leg', '整趟', { now: NOW, systems: TRA({ ...range, state: '正常' }, { line: 'PX' }), legs: [thsr('0809', '台北', '台中', '08:11', '09:15'), tra('3227', '區間車', '臺中', '彰化', '09:44', '10:07')], expect: exp('clear', 1, 'tra', 0, true, ['clear', 'clear']), reason: '高鐵段沒有任何整理、台鐵段依正常那筆；全趟不受影響時指向有依據的那段；平溪線停駛 ⇒ 台鐵有非正常 ⇒ 顯示' });
add('rule', 'show-ended', '顯示', { now: T('13:00'), systems: TRA({ line: '*', untilAt: T('12:00') }), legs: [tra('125', '自強', '臺北', '新竹', '12:57', '14:01', route(125))], expect: exp('clear', -1, null, -1, false, ['clear']), reason: '停駛 12:00 已結束、現在 13:00 ⇒ 不顯示' });

// ── (b) 薔琵颱風重播 ─────────────────────────────────────────
const NA = T('06:00'), NB = T('12:30');
const tA = (id, legs, expect, reason) => add('typhoon', id, '重播 A：10/24 06:00（依 10/23 21:30 台鐵公告、北捷 10/24 營運速報）', { snapshot: 'A', now: NA, legs, expect, reason });
const tB = (id, legs, expect, reason) => add('typhoon', id, '重播 B：10/24 12:30（依 10/24 11:30 台鐵公告、北捷 12:00 速報）', { snapshot: 'B', now: NB, legs, expect, reason });
tA('A-reserved-keelung-changhua', [L109], exp('hit', 0, 'tra', 0, true, ['hit']), '自強 109 次臺北=新竹：基隆=彰化對號列車停駛');
tA('A-local-same-section', [tra('1131', '區間車', '臺北', '桃園', '08:03', '08:48', route(1131))], exp('maybe', 0, 'tra', 4, true, ['maybe']), '區間車臺北=桃園：非對號在基隆=彰化視風雨機動行駛，沒說停駛也沒說正常');
tA('A-sea-line', [tra('2609', '區間車', '大甲', '沙鹿', '08:25', '08:42', route(2609))], exp('hit', 0, 'tra', 2, true, ['hit']), '海線非對號全區間停駛');
tA('A-yilan-line', [tra('4138', '區間車', '宜蘭', '羅東', '08:37', '08:48', route(4138))], exp('hit', 0, 'tra', 7, true, ['hit']), '宜蘭線在樹林=宜蘭=花蓮各級列車停駛的範圍');
tA('A-hualien-taitung', [tra('602', '莒光', '花蓮', '臺東', '06:34', '08:17', route(602))], exp('clear', 0, 'tra', 8, true, ['clear']), '花蓮=臺東正常行駛，602 次從花蓮發車');
tA('A-hualien-taitung-through-train', [tra('406', '自強', '花蓮', '臺東', '09:01', '11:02', route(406))], exp('maybe', 0, 'tra', 0, true, ['maybe']), '花蓮=臺東這段正常，但 406 次從樹林開來，前段經過對號停駛的基隆=彰化（樹林=七堵）與停駛的八堵=花蓮 ⇒ 車可能到不了花蓮（同樣嚴重取第一筆）');
tA('A-pingxi-branch', [tra('4712', '區間車', '十分', '平溪', '08:37', '08:50', route(4712))], exp('hit', 0, 'tra', 14, true, ['hit']), '平溪線全區間停駛');
tA('A-south-outside', [tra('3311', '區間車', '新左營', '潮州', '09:04', '10:18', route(3311))], exp('clear', 0, 'tra', 1, true, ['clear']), '彰化=高雄=枋寮正常行駛（範圍外的南部，有依據）');
tA('A-named-normal-371', [tra('371', '自強', '臺中', '彰化', '06:57', '07:14', route(371))], exp('clear', 0, 'tra', 6, true, ['clear']), '臺中=彰化在對號停駛範圍，但公告點名 371 次全區間正常行駛');
tA('A-named-stopped-472', [tra('472', '自強', '員林', '彰化', '06:00', '06:16', route(472))], exp('hit', 0, 'tra', 5, true, ['hit']), '員林=彰化本身在正常區間，但公告點名 472 次全區間停駛');
tA('A-after-noon-unannounced', [tra('125', '自強', '臺北', '新竹', '12:57', '14:01', route(125))], exp('maybe', 0, 'tra', 18, true, ['maybe']), '12 時前的停駛跟這段沒交集，但 12 時後的行車資訊還沒公告 ⇒ 可能受影響');
tA('A-thsr-only', [thsr('0809', '台北', '台中', '08:11', '09:15')], exp('clear', 0, 'thsr', 0, false, ['clear']), '高鐵全線正常；行程只用高鐵、高鐵沒有非正常 ⇒ 不顯示這一行');
tA('A-wenhu-line', [metro('TRTC', '文湖線', '南港展覽館', '松山機場', '08:00', '08:15')], exp('hit', 0, 'trtc', 0, true, ['hit']), '文湖線 23 日 18 時起停駛，24 日首班車另行通知');
tA('A-tamsui-elevated-limit', [metro('TRTC', '淡水信義線', '台北車站', '淡水', '08:00', '08:35')], exp('maybe', 0, 'trtc', 1, true, ['maybe']), '圓山=淡水高架段停駛；這一版捷運不算站序 ⇒ 落可能受影響（人看會說受影響，已知限制）');
tA('A-bannan-then-tra', [metro('TRTC', '板南線', '忠孝復興', '台北車站', '07:50', '07:56'), L109], exp('hit', 1, 'tra', 0, true, ['maybe', 'hit']), '板南線班距 12 分（可能受影響），第 2 段 109 次對號停駛（受影響）⇒ 整趟受影響、指第 2 段');
tB('B-named-stopped-5216', [tra('5216', '自強', '臺北', '宜蘭', '12:25', '13:40', route(5216))], exp('hit', 0, 'tra', 3, true, ['hit']), '5216 次點名停駛');
tB('B-271-special-from-songshan', [tra('271', '自強', '臺北', '臺中', '12:45', '14:38', route(271))], exp('maybe', 0, 'tra', 5, true, ['maybe']), '271 次花蓮=松山停駛、改由松山特開；這段臺北上車在特開區間 ⇒ 提醒可能受影響（人看大致照開）');
tB('B-yilan-before-15', [tra('4172', '區間車', '宜蘭', '羅東', '13:01', '13:12', route(4172))], exp('hit', 0, 'tra', 1, true, ['hit']), '宜蘭線路樹倒塌搶修、預計 15 時恢復，13:01 還在停駛');
tB('B-yilan-local-after-15', [tra('4184', '區間車', '宜蘭', '羅東', '15:21', '15:32', route(4184))], exp('maybe', 0, 'tra', 4, true, ['maybe']), '15 時預計恢復後，東部幹線仍有部分非對號列車截短或停駛');
tB('B-yilan-reserved-after-15', [tra('236', '自強', '宜蘭', '花蓮', '16:56', '18:01', route(236))], exp('clear', -1, null, -1, true, ['clear']), '時間在預計恢復（15 時）之後，對號列車沒有其他限制 ⇒ 不受影響（公告沒有直接說這班正常，所以沒有依據）');
tB('B-named-normal-432', [tra('432', '自強', '臺北', '花蓮', '15:00', '17:26', route(432))], exp('clear', 0, 'tra', 2, true, ['clear']), '432 次（臺北 15:00）點名恢復正常行駛');
tB('B-pingxi-awaiting-inspection', [tra('4824', '區間車', '十分', '平溪', '13:37', '13:50', route(4824))], exp('hit', 0, 'tra', 12, true, ['hit']), '平溪線俟路線巡查完畢後恢復 ⇒ 沒有恢復時間、仍停駛');
tB('B-sea-line-normal', [tra('2527', '區間車', '大甲', '沙鹿', '13:31', '13:47', route(2527))], exp('clear', 0, 'tra', 0, true, ['clear']), '西部幹線基隆=枋寮 12 時後正常，海線兩端在範圍內');
tB('B-south-normal', [tra('3171', '區間車', '屏東', '潮州', '13:24', '13:43', route(3171))], exp('clear', 0, 'tra', 0, true, ['clear']), '基隆=潮州=枋寮正常（屏東=潮州在屏東線，範圍跨到 SL）');
tB('B-thsr-then-tra', [thsr('0829', '台北', '台中', '13:11', '14:15'), tra('125', '自強', '臺中', '彰化', '15:05', '15:20', route(125))], exp('clear', 0, 'thsr', 0, true, ['clear', 'clear']), '高鐵全線正常、台鐵西部幹線正常；台鐵還有別處停駛 ⇒ 顯示「依公告不受影響」');
tB('B-wenhu-reduced', [metro('TRTC', '文湖線', '南港展覽館', '松山機場', '12:40', '12:55')], exp('maybe', 0, 'trtc', 1, true, ['maybe']), '文湖線恢復但班距 8～9 分半（減班或改點）');

// ── (c) 正式站樣本：11/17 21:21 抓的 /api/rail-status（native build/pp3/p4-android/prod-rail-status-1117.json）──
// impacts 原樣照抄（P4 之前的舊格式：沒有 line 這個 key）；systems 只留比對會讀的 id、label、impacts。
// 正常日不該有任何一趟亮「可能受影響」，也不該顯示那一行。
const D17 = hm => `2026-11-17T${hm}:00+08:00`;
const NP = '2026-11-17T21:21:56+08:00';
const P = [
  sys('tra', '台鐵', [
    { scope: '全線', state: '正常', from: '', until: '', trains: [] },
    { scope: '選舉返鄉加開（東線自強號6列次、西線自強號4列次、區間快車2列次，合計加開28列次）', state: '正常', from: '2026-11-27', until: '2026-11-29', trains: [] },
    { scope: '歲末逢週五至週日加開（東線自強號8列次、西線自強號16列次）', state: '正常', from: '2026-11-20', until: '2026-12-20', trains: [] },
    { scope: '板橋站 自行車兩鐵上下車業務（每週五至週日）', state: '停駛', from: '2026-11-13', until: '2026-12-27', trains: [] },
  ]),
  sys('afr', '阿里山林鐵', [
    { scope: '本線 嘉義=阿里山', state: '停駛', from: '10月23日', until: '10月25日', trains: [] },
    { scope: '支線 祝山線', state: '停駛', from: '10月23日', until: '10月25日', trains: [] },
    { scope: '支線 沼平線、神木線', state: '正常', from: '10月24日下午1時', until: '', trains: [] },
  ]),
  sys('thsr', '台灣高鐵', [
    { scope: '高鐵全線', state: '正常', from: '', until: '', trains: [] },
    { scope: '選舉疏運加開列車（南下 18 班、北上 22 班）', state: '減班或改點', from: '2026-11-27', until: '2026-11-30', trains: ['1297', '1173', '1336', '1698', '1296'] },
  ]),
  sys('trtc', '台北捷運', [
    { scope: '台北捷運全線（TDX即時狀態）', state: '正常', from: '', until: '', trains: [] },
    { scope: '板南線（配合臺北大巨蛋活動進散場時間加密班距）', state: '減班或改點', from: '11月12日', until: '11月15日', trains: [] },
    { scope: '10月24日颱風營運速報所列班距調整與設施暫停服務', state: '未確認', from: '', until: '', trains: [] },
  ]),
];
const tP = (id, legs, reason) => add('prod', id, '正式站樣本：11/17 21:21 /api/rail-status 原樣（舊格式整理）', { snapshot: 'P', now: NP, legs, expect: exp('clear', -1, null, -1, false, legs.map(() => 'clear')), reason });
tP('P-tra-jiuqutang-kaohsiung', [{ system: 'TRA', train: '3288', kind: '區間車', line: '', board: '九曲堂', alight: '高雄', boardAt: D17('21:52'), alightAt: D17('22:11'), route: route(3288) }], '區間車 3288 次九曲堂=高雄：板橋站自行車兩鐵是舊格式、又是附屬服務 ⇒ 不亮、不顯示');
tP('P-tra-taipei-hsinchu', [{ system: 'TRA', train: '157', kind: '自強', line: '', board: '臺北', alight: '新竹', boardAt: D17('21:55'), alightAt: D17('23:14'), route: route(157) }], '自強 157 次臺北=新竹（經過板橋）：同上');
tP('P-trtc-bannan', [metro('TRTC', '板南線', '忠孝復興', '台北車站', '22:00', '22:06')].map(l => ({ ...l, boardAt: D17('22:00'), alightAt: D17('22:06') })), '板南線忠孝復興=台北車站：11/12～11/15 加密班距那筆、10/24 颱風「未確認」那筆都是舊格式 ⇒ 不亮、不顯示');

const out = {
  note: 'AI 串聯行程 P4 出狀況判斷的測試向量。網頁 node scripts/verify_trip_impact.mjs 與 railcore TripImpactTest 跑同一份（native 由 scripts/sync-trip-impact.mjs 拷貝）。'
    + '時刻寫 ISO（+08:00），測試先用 parseIsoSec 換成 epoch 秒再比對。期望值是人工判讀，不是從程式抄來的。',
  format: {
    snapshots: '颱風重播的 /api/rail-status systems：A＝10/24 06:00、B＝10/24 12:30；impacts 多一個 sourceUrl 欄註明原文（比對不看）。P＝正式站 11/17 21:21 的樣本（舊格式 impacts 原樣）',
    cases: 'legs＝行程各段；systems（或 snapshot 指名）；now；expect＝{ verdict, legIndex, system, impactIndex, show, legs[] }',
    sources: '原文：native build/pp3/p4/rail_ai_articles_1024.json（正式 D1 rail_ai_articles 匯出）；高鐵 10/24 沒有颱風公告原文，依 rail_ai_revisions id 1（10/24 22:39）高鐵「全線營運正常」',
  },
  snapshots: { A: { at: NA, systems: A }, B: { at: NB, systems: B }, P: { at: NP, systems: P } },
  cases,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`寫入 ${OUT}：${cases.length} 條（規則 ${cases.filter(c => c.group === 'rule').length}、颱風 ${cases.filter(c => c.group === 'typhoon').length}、正式站樣本 ${cases.filter(c => c.group === 'prod').length}）`);
