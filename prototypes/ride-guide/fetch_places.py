"""乘車導覽原型：從 OpenStreetMap（Overpass）抓導覽站周邊的店家與景點，輸出 data/places.js。

為什麼是 OSM 而不是 Google 地圖：Google 地圖的服務條款不允許抓取或轉存它的店家資料；
OSM 是開放授權（ODbL），可以合法取用，但要標示「© OpenStreetMap 貢獻者」。
OSM 上的店家資料由志工標註，名稱與位置大致可信，營業時間常常缺或過時——
頁面上一律標「OSM」，缺的欄位由前端補「模擬」值並清楚標示。

用法：python3 prototypes/ride-guide/fetch_places.py
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
STATIONS = {
    'shifen': (25.04111, 121.77514),
    'pingxi': (25.02571, 121.74019),
    'jingtong': (25.02391, 121.72391),
    'guangfu': (23.66631, 121.42117),
    'tongxiao': (24.49141, 120.67843),
}
RADIUS = 1500
ENDPOINTS = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]
UA = 'RailIslandPrototype/0.1 (github siriushsu/taiwan-rail-live)'

# 只收「旅客會想去」的店：在地吃喝與伴手禮。連鎖超商、加油站、銀行、診所之類不收。
EAT = {'restaurant', 'fast_food', 'food_court'}
DRINK = {'cafe', 'ice_cream', 'bar'}
BUY = {'bakery', 'confectionery', 'tea', 'gift', 'farm', 'deli', 'pastry', 'beverages', 'souvenir', 'craft', 'seafood', 'greengrocer'}
GENERIC = {'餐廳', '小吃', '小吃店', '咖啡', '早餐', '飲料', '商店'}  # 只寫類別、沒有店名的點
CHAINS = ('7-ELEVEN', '7-Eleven', '全家', 'FamilyMart', '萊爾富', 'OK超商', '全聯', '麥當勞', "McDonald", '肯德基', 'KFC', '星巴克', 'Starbucks', '中油', '摩斯', '50嵐', '清心', '八方雲集', '丹丹')


def hav_m(a, b):
    r = math.radians
    dlat, dlon = r(b[0] - a[0]), r(b[1] - a[1])
    q = math.sin(dlat / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(dlon / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(q))


def query(lat, lon):
    q = f"""[out:json][timeout:90];
(
  nwr(around:{RADIUS},{lat},{lon})[amenity~"^(restaurant|cafe|fast_food|ice_cream|bar|food_court)$"][name];
  nwr(around:{RADIUS},{lat},{lon})[shop][name];
);
out center tags;"""
    last = None
    for ep in ENDPOINTS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(ep, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': UA})
                return ep, json.load(urllib.request.urlopen(req, timeout=150))['elements']
            except Exception as e:  # 鏡像站常逾時，換下一個
                last = e
                print(f'  {ep} 失敗：{str(e)[:80]}', file=sys.stderr)
                time.sleep(5)
    raise RuntimeError(f'所有 Overpass 端點都失敗：{last}')


def category(t):
    a, s = t.get('amenity'), t.get('shop')
    if a in EAT:
        return 'eat'
    if a in DRINK:
        return 'drink'
    if s in BUY:
        return 'buy'
    return None


def main():
    out = {'license': 'ODbL', 'attribution': '© OpenStreetMap contributors', 'fetched': time.strftime('%Y-%m-%d'), 'radiusM': RADIUS, 'stations': {}}
    for sid, (lat, lon) in STATIONS.items():
        ep, els = query(lat, lon)
        out.setdefault('endpoints', {})[sid] = ep
        rows = []
        for e in els:
            t = e.get('tags', {})
            name = t.get('name', '').strip()
            cat = category(t)
            if not name or name in GENERIC or not cat or any(c.lower() in name.lower() for c in CHAINS) or t.get('brand'):
                continue
            plat = e.get('lat', e.get('center', {}).get('lat'))
            plon = e.get('lon', e.get('center', {}).get('lon'))
            if plat is None:
                continue
            rows.append({
                'osm': f"{e['type']}/{e['id']}",
                'name': name,
                'nameEn': t.get('name:en'),
                'cat': cat,
                'kind': t.get('amenity') or t.get('shop'),
                'cuisine': t.get('cuisine'),
                'hours': t.get('opening_hours'),
                'lat': round(plat, 6),
                'lon': round(plon, 6),
                'distM': round(hav_m((lat, lon), (plat, plon))),
            })
        rows.sort(key=lambda r: r['distM'])
        out['stations'][sid] = rows
        print(f'{sid}: {len(els)} 筆 → 收 {len(rows)} 家（{ep}）')
        time.sleep(3)
    path = os.path.join(HERE, 'data', 'places.js')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('// 自動產生：python3 prototypes/ride-guide/fetch_places.py（勿手改）\n')
        f.write('// 資料：© OpenStreetMap 貢獻者，ODbL 授權。店家資訊未逐一查證。\n')
        f.write('window.RIDE_PLACES = ' + json.dumps(out, ensure_ascii=False) + ';\n')
    print('寫出', path)


if __name__ == '__main__':
    main()
