import * as THREE from "../vendor/three.module.js";
const VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }";
export function createBloom(renderer, extra = {}) {
  const opt = { type: THREE.HalfFloatType, depthBuffer: false };
  const main = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }), half = new THREE.WebGLRenderTarget(1, 1, opt), qa = new THREE.WebGLRenderTarget(1, 1, opt), qb = new THREE.WebGLRenderTarget(1, 1, opt);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const mk = (fs, u, tone = false) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: tone });
  const bright = mk(`uniform sampler2D tSrc; uniform float uTh; varying vec2 vUv; void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * max(l - uTh, 0.) / max(l, 1e-4), 1.); }`, { tSrc: { value: null }, uTh: { value: 0.9 } });
  const blur = mk(`uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv; void main(){ vec3 c = texture2D(tSrc, vUv).rgb * .227;
  c += (texture2D(tSrc, vUv + uDir * 1.38).rgb + texture2D(tSrc, vUv - uDir * 1.38).rgb) * .316; c += (texture2D(tSrc, vUv + uDir * 3.23).rgb + texture2D(tSrc, vUv - uDir * 3.23).rgb) * .070; gl_FragColor = vec4(c, 1.); }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
  const comp = mk(`uniform sampler2D tSrc; uniform sampler2D tB; uniform float uK; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb + texture2D(tB, vUv).rgb * uK, 1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`, { tSrc: { value: main.texture }, tB: { value: qb.texture }, uK: { value: 0 }, ...extra }, true);
  const size = new THREE.Vector2(), pass = (m, target) => {
    quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  };
  return {
    // 畫一格：k＝泛光強度（照夜晚程度給）
    render(world, camera, k, th = 0.9) {
      renderer.getDrawingBufferSize(size);
      const w = size.x, h = size.y;
      if (main.width !== w || main.height !== h) {
        main.setSize(w, h);
        half.setSize(w >> 1, h >> 1);
        qa.setSize(w >> 2, h >> 2);
        qb.setSize(w >> 2, h >> 2);
      }
      const info = renderer.info, ar = info.autoReset;
      info.reset();
      info.autoReset = false;
      renderer.setRenderTarget(main);
      renderer.render(world, camera);
      bright.uniforms.tSrc.value = main.texture;
      bright.uniforms.uTh.value = th;
      pass(bright, half);
      blur.uniforms.tSrc.value = half.texture;
      blur.uniforms.uDir.value.set(2 / w, 0);
      pass(blur, qa);
      blur.uniforms.tSrc.value = qa.texture;
      blur.uniforms.uDir.value.set(0, 4 / h);
      pass(blur, qb);
      comp.uniforms.uK.value = k;
      pass(comp, null);
      info.autoReset = ar;
    }
  };
}
