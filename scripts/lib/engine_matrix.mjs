export const ENGINES = Object.freeze(['leaflet', 'maplibre']);

export const ENGINE_MATRIX_ASSERTION_PREFIX = 'ENGINE_MATRIX_ASSERTION ';

function assertEngine(engine) {
  if (!ENGINES.includes(engine)) throw new TypeError(`未知地圖引擎：${engine}`);
}

function appendExtraQuery(params, extraQuery) {
  if (extraQuery == null || extraQuery === '') return;
  if (typeof extraQuery === 'string') {
    const raw = extraQuery.replace(/^[?&]/, '');
    for (const [key, value] of new URLSearchParams(raw)) params.set(key, value);
    return;
  }
  if (extraQuery instanceof URLSearchParams) {
    for (const [key, value] of extraQuery) params.set(key, value);
    return;
  }
  if (typeof extraQuery === 'object') {
    for (const [key, value] of Object.entries(extraQuery)) {
      if (value == null) continue;
      params.set(key, String(value));
    }
    return;
  }
  throw new TypeError('extraQuery 必須是 query 字串、URLSearchParams 或物件');
}

/**
 * 將 engine 與額外 query 合併進網址；原有 fragment 永遠留在 query 後方。
 * extraQuery 若帶同名 key 會覆蓋 base，engine 則永遠以引數為準。
 */
export function engineUrl(base, engine, extraQuery = '') {
  assertEngine(engine);
  if (typeof base !== 'string' || !base) throw new TypeError('base 必須是非空網址字串');

  const hashAt = base.indexOf('#');
  const fragment = hashAt < 0 ? '' : base.slice(hashAt);
  const beforeHash = hashAt < 0 ? base : base.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const pathname = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? '' : beforeHash.slice(queryAt + 1));
  appendExtraQuery(params, extraQuery);
  params.set('engine', engine);
  return `${pathname}?${params.toString()}${fragment}`;
}

function printableDetail(detail) {
  if (detail == null || detail === '') return '';
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

/**
 * 固定跑完整 Leaflet／MapLibre 矩陣。刻意不提供環境變數或參數縮小範圍，
 * 避免 CI gate 在少驗一半時仍回綠。
 */
export async function runEngineMatrix(scenario, options = {}) {
  if (typeof scenario !== 'function') throw new TypeError('scenario 必須是函式');
  const logger = options.logger || console.log;
  const emitJson = options.emitJson ?? process.env.ENGINE_MATRIX_JSON === '1';
  const results = [];
  const declarations = new Map();

  logger(`本次跑了哪些引擎：${ENGINES.join('、')}`);

  const record = (engine, status, label, detail = '', engineSpecific = null) => {
    assertEngine(engine);
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) throw new TypeError('斷言標籤不得為空');
    const item = {
      engine,
      label: `[${engine}] ${cleanLabel}`,
      baseLabel: cleanLabel,
      status,
      pass: status !== 'failed',
      detail: printableDetail(detail),
      engineSpecific,
    };
    results.push(item);
    const word = status === 'passed' ? 'PASS' : status === 'failed' ? 'FAIL' : 'SKIP';
    logger(`${word} ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
    if (emitJson) logger(ENGINE_MATRIX_ASSERTION_PREFIX + JSON.stringify(item));
    return item;
  };

  for (const engine of ENGINES) {
    const check = (pass, label, detail = '') =>
      record(engine, pass ? 'passed' : 'failed', label, detail);

    const onlyFor = (targetEngine, reason, label, pass, detail = '') => {
      assertEngine(targetEngine);
      const why = String(reason || '').trim();
      if (!why) throw new TypeError(`引擎專屬斷言「${label || '(未命名)'}」必須帶理由字串`);
      const cleanLabel = String(label || '').trim();
      if (!cleanLabel) throw new TypeError('引擎專屬斷言標籤不得為空');
      const key = `${targetEngine}\u0000${cleanLabel}`;
      const known = declarations.get(key);
      if (known && known.reason !== why) {
        throw new Error(`引擎專屬斷言「${cleanLabel}」的理由不一致`);
      }
      const declaration = known || { engine: targetEngine, label: cleanLabel, reason: why, executed: 0 };
      declarations.set(key, declaration);
      const metadata = { engine: targetEngine, reason: why };

      if (engine !== targetEngine) {
        return record(engine, 'skipped', cleanLabel, `僅於 ${targetEngine}：${why}`, metadata);
      }
      if (pass === undefined) {
        return record(engine, 'skipped', cleanLabel, `未執行：${why}`, metadata);
      }
      declaration.executed++;
      return record(engine, pass ? 'passed' : 'failed', cleanLabel, detail, metadata);
    };

    try {
      await scenario(Object.freeze({
        engine,
        engineUrl: (base, extraQuery = '') => engineUrl(base, engine, extraQuery),
        check,
        onlyFor,
      }));
    } catch (error) {
      const detail = error && (error.stack || error.message) || String(error);
      record(engine, 'failed', '情境執行', detail);
    }
  }

  for (const declaration of declarations.values()) {
    if (declaration.executed) continue;
    record(
      declaration.engine,
      'failed',
      declaration.label,
      `死斷言：兩個引擎都未執行；宣告理由：${declaration.reason}`,
      { engine: declaration.engine, reason: declaration.reason, dead: true },
    );
  }

  const assertions = results.filter(item => item.status !== 'skipped');
  const failures = assertions.filter(item => !item.pass);
  return {
    engines: [...ENGINES],
    results,
    assertions,
    failures,
    passed: failures.length === 0,
    stats: {
      engines: ENGINES.length,
      assertions: assertions.length,
      engineSpecific: declarations.size,
      failures: failures.length,
    },
  };
}
