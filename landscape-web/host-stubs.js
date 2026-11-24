// engine/main.js 原本 import 的車窗視角（ride-ug）與原型列車（trains-layer）：網站有自己的列車與跟車，這兩支不帶，換成什麼都不做的替身。
export async function createRideUg() { return { update() {}, stationS() { return 0; } }; }
export async function createTrainsLayer() { return { update() {} }; }
// T7 0bd2118 起車窗搭乘線多了月台門與站名牌（ride-stn）、窗框遮罩（ride-cab）、行車模型（run-motion）：網站沒有搭乘視角，一樣換成替身。
export function createRideStn() { return { update() {} }; }
export function createRideCab() { return { set() {}, draw() {} }; }
export function planMotion() { return null; }
