export function encodeStation(xyz, nor, n, tag = null) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) {
    const k = i % 3;
    if (xyz[i] < min[k]) min[k] = xyz[i];
    if (xyz[i] > max[k]) max[k] = xyz[i];
  }
  const origin = min.map((v) => Math.floor(v * 100) / 100), extent = Math.max(max[0] - origin[0], max[1] - origin[1], max[2] - origin[2]), scale = Math.max(0.01, Math.ceil(extent / 65535 * 1e3) / 1e3);
  const qa = new Uint16Array(n * 3), ba = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    qa[i] = Math.round((xyz[i] - origin[i % 3]) / scale);
    ba[i] = Math.max(-127, Math.min(127, Math.round(nor[i] * 127)));
  }
  const seen = /* @__PURE__ */ new Map(), index = new Uint32Array(n), keep = [];
  for (let i = 0; i < n; i++) {
    const k = `${qa[i * 3]},${qa[i * 3 + 1]},${qa[i * 3 + 2]},${ba[i * 3]},${ba[i * 3 + 1]},${ba[i * 3 + 2]},${tag ? tag[i] : 0}`;
    let v = seen.get(k);
    if (v === void 0) {
      v = keep.length;
      seen.set(k, v);
      keep.push(i);
    }
    index[i] = v;
  }
  const V = keep.length, wide = V > 65535, vb = Math.ceil(V * 9 / 4) * 4, buf = new ArrayBuffer(vb + n * (wide ? 4 : 2)), q = new Uint16Array(buf, 0, V * 3), b = new Int8Array(buf, V * 6, V * 3);
  for (let v = 0; v < V; v++) for (let k = 0; k < 3; k++) {
    q[v * 3 + k] = qa[keep[v] * 3 + k];
    b[v * 3 + k] = ba[keep[v] * 3 + k];
  }
  (wide ? new Uint32Array(buf, vb, n) : new Uint16Array(buf, vb, n)).set(index);
  return { buf, origin, scale, vertexCount: V, indexCount: n };
}
export function decodeStation(buf, lod) {
  const n = lod.vertexCount, I = lod.indexCount, vb = Math.ceil(n * 9 / 4) * 4, q = new Uint16Array(buf, 0, n * 3), nor = new Int8Array(buf, n * 6, n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = lod.origin[i % 3] + q[i] * lod.scale;
  return { pos, nor, index: n > 65535 ? new Uint32Array(buf, vb, I) : new Uint16Array(buf, vb, I) };
}
export function expandStation(buf, lod) {
  const { pos, index } = decodeStation(buf, lod), out = new Float32Array(index.length * 3);
  for (let i = 0; i < index.length; i++) {
    const v = index[i] * 3;
    out[i * 3] = pos[v];
    out[i * 3 + 1] = pos[v + 1];
    out[i * 3 + 2] = pos[v + 2];
  }
  return out;
}
