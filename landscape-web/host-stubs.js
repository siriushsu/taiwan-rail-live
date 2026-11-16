// engine/main.js 原本 import 的車窗視角（ride-ug）與原型列車（trains-layer）：網站有自己的列車與跟車，這兩支不帶，換成什麼都不做的替身。
export async function createRideUg() { return { update() {}, stationS() { return 0; } }; }
export async function createTrainsLayer() { return { update() {} }; }
