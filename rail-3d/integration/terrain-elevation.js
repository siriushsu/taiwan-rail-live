// 本站固定版 MapLibre 的 queryTerrainElevation 在缺 DEM 時回 0，
// 不能用 Number.isFinite 當「已載入」。先確認它實際會採用的圖磚有 DEM；
// 有效圖磚的 0 公尺仍然是合法高程（沿海不能被當成缺資料）。
export function terrainElevation(map,coordinate,maplibre){
  const terrain=map.terrain;
  if(!terrain?._getOverscaledTileIDFromLngLatZoom||!terrain.sourceCache?.getSourceTile)return null;
  const {tileID}=terrain._getOverscaledTileIDFromLngLatZoom(maplibre.LngLat.convert(coordinate),map.transform.tileZoom);
  if(!terrain.sourceCache.getSourceTile(tileID,true)?.dem)return null;
  const elevation=map.queryTerrainElevation(coordinate);
  return Number.isFinite(elevation)?elevation:null;
}
