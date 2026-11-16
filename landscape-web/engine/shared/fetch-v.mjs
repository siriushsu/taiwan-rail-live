export const VSHA = { on: true };
export const JSON_INIT = { cache: "no-cache" };
export const fspec = (files, name) => {
  const f = files?.[name];
  return f?.sha256 ? { v: f.sha256.slice(0, 16), bytes: f.bytes, sha: f.sha256 } : null;
};
export const vurl = (u, spec, n = 0) => u + "?v=" + spec.v + (n > 0 ? "&r=" + n : "");
export async function sha256hex(data) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  let s = "";
  for (const x of h) s += (x < 16 ? "0" : "") + x.toString(16);
  return s;
}
export async function hex16(text) {
  if (globalThis.crypto?.subtle) return (await sha256hex(new TextEncoder().encode(text))).slice(0, 16);
  let a = 2166136261, b = 16777619;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 1540483477) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const MAGIC = { png: [137, 80, 78, 71], jpg: [255, 216, 255] }, TAIL = { png: [73, 69, 78, 68, 174, 66, 96, 130], jpg: [255, 217] };
export async function checkBuf(u, b, spec, st = null) {
  const name = u.slice(u.lastIndexOf("/") + 1);
  if (spec.bytes != null && b.byteLength !== spec.bytes) throw Error(`${u} 長度 ${b.byteLength}，應為 ${spec.bytes}`);
  const ext = name.slice(name.lastIndexOf(".") + 1), m = MAGIC[ext], z = TAIL[ext];
  if (m) {
    const h = new Uint8Array(b, 0, Math.min(m.length, b.byteLength));
    if (h.length < m.length || m.some((x, i) => h[i] !== x)) throw Error(`${u} 檔頭不對`);
  }
  if (z) {
    const e = new Uint8Array(b, Math.max(0, b.byteLength - z.length));
    if (e.length < z.length || z.some((x, i) => e[i] !== x)) throw Error(`${u} 檔尾不對（不完整）`);
  }
  if (spec.sha && VSHA.on && globalThis.crypto?.subtle) {
    const t = performance.now(), got = await sha256hex(b);
    if (st) {
      st.sha = (st.sha || 0) + performance.now() - t;
      st.shaN = (st.shaN || 0) + 1;
      st.shaKB = (st.shaKB || 0) + b.byteLength / 1024;
    }
    if (got !== spec.sha) throw Error(`${u} sha256 不符`);
  }
  return b;
}
export async function fetchV(u, spec, n = 0, st = null) {
  const r = await fetch(vurl(u, spec, n));
  if (!r.ok) throw Error(u + " " + r.status);
  return checkBuf(u, await r.arrayBuffer(), spec, st);
}
