#!/usr/bin/env python3
"""
Fetch real rail track geometry from OpenStreetMap (Overpass) and attach a
curved `shape` polyline to each line in mrt.json / tra.json, plus each
station's arc-length position `d` (km) along that shape.

Approach: pull every rail way (with node ids + geometry) in the bbox, build a
topological graph keyed by OSM node id (junctions share ids -> real topology),
snap each station to the nearest graph node, Dijkstra between consecutive
stations to trace the real track, concatenate into one polyline per line.
Disconnected pairs fall back to a straight segment (counted + reported).
"""
import json, math, heapq, sys, urllib.request, urllib.parse, os

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")
CACHE = os.path.join(HERE, "scripts", ".overpass_cache")

def haversine(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dla, dlo = la2 - la1, lo2 - lo1
    h = math.sin(dla/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlo/2)**2
    return 2 * R * math.asin(math.sqrt(h))

def overpass(query, cache_key):
    os.makedirs(CACHE, exist_ok=True)
    cf = os.path.join(CACHE, cache_key + ".json")
    if os.path.exists(cf):
        print(f"  (cache hit {cache_key})", flush=True)
        return json.load(open(cf))
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    import time
    for attempt in range(6):
        ep = OVERPASS[attempt % len(OVERPASS)]
        try:
            req = urllib.request.Request(ep, data=data,
                                         headers={"User-Agent": "rail-shape/1.0"})
            with urllib.request.urlopen(req, timeout=300) as r:
                out = json.loads(r.read().decode())
            json.dump(out, open(cf, "w"))
            return out
        except Exception as e:
            last = e
            print(f"  attempt {attempt+1} on {ep.split('/')[2]} failed: {e}; backing off", flush=True)
            time.sleep(15 * (attempt + 1))
    raise last

def build_graph(elements):
    """node_id -> (lat,lon); adj: node_id -> list of (nbr_id, dist_km)."""
    coord = {}
    adj = {}
    for el in elements:
        if el.get("type") != "way":
            continue
        nodes = el.get("nodes") or []
        geom = el.get("geometry") or []
        if len(nodes) != len(geom):
            continue
        for nid, g in zip(nodes, geom):
            coord[nid] = (g["lat"], g["lon"])
        for i in range(len(nodes) - 1):
            a, b = nodes[i], nodes[i+1]
            d = haversine(coord[a], coord[b])
            adj.setdefault(a, []).append((b, d))
            adj.setdefault(b, []).append((a, d))
    return coord, adj

def nearest_node(coord, pt):
    best, bd = None, 1e9
    for nid, c in coord.items():
        d = haversine(pt, c)
        if d < bd:
            bd, best = d, nid
    return best, bd

def dijkstra(adj, coord, src, dst, max_km=60):
    """Return list of node ids src..dst, or None."""
    if src == dst:
        return [src]
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            break
        if d > dist.get(u, 1e9):
            continue
        if d > max_km:
            continue
        for v, w in adj.get(u, ()):
            nd = d + w
            if nd < dist.get(v, 1e9):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if dst not in prev and dst != src:
        return None
    path = [dst]
    while path[-1] != src:
        p = prev.get(path[-1])
        if p is None:
            return None
        path.append(p)
    path.reverse()
    return path

def process(fname, query, label):
    print(f"\n=== {label}: querying Overpass ===", flush=True)
    res = overpass(query, fname.replace(".json", ""))
    els = res.get("elements", [])
    print(f"  ways returned: {sum(1 for e in els if e.get('type')=='way')}", flush=True)
    coord, adj = build_graph(els)
    print(f"  graph nodes: {len(coord)}", flush=True)

    path = os.path.join(DATA, fname)
    d = json.load(open(path))
    total_fb = 0
    for ln in d["lines"]:
        sts = ln["stations"]
        snapped = []
        for st in sts:
            nid, gap = nearest_node(coord, (st["lat"], st["lon"]))
            snapped.append(nid)
        shape = [list(coord[snapped[0]])]
        cum = 0.0
        sts[0]["d"] = 0.0
        fb = 0
        for i in range(1, len(sts)):
            straight = haversine((sts[i-1]["lat"], sts[i-1]["lon"]),
                                 (sts[i]["lat"], sts[i]["lon"]))
            p = dijkstra(adj, coord, snapped[i-1], snapped[i])
            routed = None
            if p and len(p) >= 2:
                routed = 0.0
                for j in range(len(p)-1):
                    routed += haversine(coord[p[j]], coord[p[j+1]])
            # reject absurd detours (wrong parallel track / graph gap)
            if p is None or len(p) < 2 or routed > 2.5 * straight + 1.0:
                fb += 1
                cur = [sts[i]["lat"], sts[i]["lon"]]
                cum += haversine(shape[-1], cur)
                shape.append(cur)
                sts[i]["d"] = round(cum, 4)
            else:
                for nid in p[1:]:
                    c = list(coord[nid])
                    cum += haversine(shape[-1], c)
                    shape.append(c)
                sts[i]["d"] = round(cum, 4)
        ln["shape"] = [[round(a, 6), round(b, 6)] for a, b in shape]
        ln["shapeLen"] = round(cum, 4)
        total_fb += fb
        print(f"  {ln['id']:14s} stations={len(sts):3d} shapePts={len(shape):5d} "
              f"len={cum:7.1f}km fallback={fb}", flush=True)
    d["shape_source"] = "OSM Overpass railway ways, Dijkstra-routed between stations"
    json.dump(d, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"  WROTE {path}  (total straight-line fallbacks: {total_fb})", flush=True)

TRA_Q = """
[out:json][timeout:280];
(
  way["railway"="rail"]["usage"!="industrial"]["service"!~"siding|yard|spur"]
    (21.85,120.05,25.35,122.05);
);
out geom;
"""

MRT_Q = """
[out:json][timeout:280];
(
  way["railway"="subway"](24.90,121.35,25.20,121.75);
  way["railway"="rail"]["usage"!="industrial"]["service"!~"siding|yard|spur"](24.90,121.35,25.20,121.75);
);
out geom;
"""

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "tra"):
        process("tra.json", TRA_Q, "TRA (台鐵)")
    if which in ("all", "mrt"):
        process("mrt.json", MRT_Q, "MRT (台北捷運)")
    print("\nDONE", flush=True)
