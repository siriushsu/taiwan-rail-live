export function stationNameKey(name) {
  return name.replaceAll('臺','台').replace(/^捷運/,'').replace(/出入口.*$/,'').replace(/(?:火車站|車站|站)+$/,'');
}
