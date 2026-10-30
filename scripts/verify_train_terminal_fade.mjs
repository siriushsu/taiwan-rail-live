import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../rail-3d/vendor/three.module.js';
import {createWenhuMaterial} from '../rail-3d/assets/wenhu-v1/wenhu.js';
import {installTrainLighting,nightAmount} from '../rail-3d/integration/train-lighting.js';
import {createTrainHalo} from '../rail-3d/integration/train-halo.js';
import {trainDisplayOpacity,createFadingTrainMaterial} from '../rail-3d/integration/train-display.js';

// 使用 renderer 真正的逐 mesh callback，確認共用材質不會讓下一台車繼承前一台的淡出。
const renderer = fs.readFileSync(new URL('../rail-3d/integration/map3d.js', import.meta.url), 'utf8');
const callback = renderer.match(/  function lightUniforms\(mat,view,mesh\)\{[^\n]+\}/)?.[0];
assert(callback, 'renderer 需保留逐 mesh 的 lightUniforms');
const lightUniforms = vm.runInNewContext(`(${callback.trim()})`, {nightAmount, trainDisplayOpacity});
const normal = createWenhuMaterial(THREE);
installTrainLighting(normal, THREE);
normal.uniforms.trainClipMatrix = {value: new THREE.Matrix4()};
const faded = createFadingTrainMaterial(normal, lightUniforms);
const view = {projectionMatrix: new THREE.Matrix4()};
const mesh = {userData: {}, modelViewMatrix: new THREE.Matrix4(), geometry: {boundingBox: {min: {x: -10}, max: {x: 10}}}};
assert.equal(normal.transparent, false);
assert.equal(normal.depthWrite, true);
assert.equal(faded.transparent, true);
assert.equal(faded.depthWrite, false);
assert.notEqual(faded.uniforms.trainOpacity, normal.uniforms.trainOpacity);
for (const [opacity, translucent, expected] of [[.5, false, .5], [.25, true, .105], [undefined, false, 1]]) {
  mesh.userData = {displayOpacity: opacity, trainTranslucent: translucent};
  faded.onBeforeRender(null, null, view, null, mesh);
  assert.equal(faded.uniforms.trainOpacity.value, expected);
  assert.equal(normal.uniforms.trainOpacity.value, 1, '淡出車不可改動正常車的 alpha');
}
mesh.userData = {};
lightUniforms(normal, view, mesh);
assert.equal(normal.uniforms.trainOpacity.value, 1);
assert.equal(trainDisplayOpacity(0), 0);
assert.equal(trainDisplayOpacity(NaN), 1);

// 光暈用真正的 Three geometry，車體位置不變時，半透明只會改第四通道。
const scene = new THREE.Scene(), halo = createTrainHalo(scene);
const model = {
  group: {visible: true}, model: {parts: [{bodyLengthM: 20}], widthM: 3},
  screenPose: {color: '#db3434', sample: {displayScale: 1, cars: [{coordinate: [120, 23], height: 0, angle: 0, underground: false}]}}
};
const models = new Map([['arriving', model]]);
const project = (coordinate, height) => ({x: 500 + (coordinate[0] - 120) * 1e5, y: 350 + (coordinate[1] - 23) * 1e5 - height, z: 0});
const readHalo = () => {
  const mesh = scene.children.find(item => item.name === 'train-halo' && item.visible);
  return mesh ? {positions: [...mesh.geometry.attributes.position.array.slice(0, mesh.geometry.drawRange.count * 3)],
    colors: [...mesh.geometry.attributes.haloColor.array.slice(0, mesh.geometry.drawRange.count * 4)]} : null;
};
halo.update(models, project, 1000, 700, {enabled: true, trainHalo: true});
const full = readHalo();
assert(full && halo.stats.trains === 1);
model.screenPose.displayOpacity = .5;
halo.update(models, project, 1000, 700, {enabled: true, trainHalo: true});
const half = readHalo();
assert.deepEqual(half.positions, full.positions);
for (let i = 0; i < full.colors.length; i++) assert.equal(half.colors[i], full.colors[i] * (i % 4 === 3 ? .5 : 1));
model.screenPose.displayOpacity = 0;
halo.update(models, project, 1000, 700, {enabled: true, trainHalo: true});
assert.equal(readHalo(), null);
assert.equal(halo.stats.trains, 0);
halo.destroy(); normal.dispose(); faded.dispose();
console.log('PASS 3D 終點淡出材質、地下透視倍率、正常車隔離與同座標光暈淡出');
