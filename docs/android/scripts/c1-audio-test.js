(async () => {
  document.getElementById('rail-c1-audio-test')?.remove();
  window.__railC1Audio?.audio?.pause();

  const sampleRate = 44_100;
  const seconds = 10;
  const sampleCount = sampleRate * seconds;
  const bytes = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(bytes);
  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  for (let i = 0; i < sampleCount; i++) {
    const attack = Math.min(1, i / 441);
    const release = Math.min(1, (sampleCount - i) / 441);
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.25 * attack * release;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.volume = 1;
  const log = [];
  const record = event => log.push({
    event,
    atMs: Math.round(performance.now()),
    currentTime: Number(audio.currentTime.toFixed(3)),
    volume: audio.volume,
    paused: audio.paused,
  });

  const button = document.createElement('button');
  button.id = 'rail-c1-audio-test';
  button.textContent = 'C-1 PLAY 1.0 → 0.3';
  Object.assign(button.style, {
    position: 'fixed', left: '24px', top: '180px', zIndex: '2147483647',
    width: '320px', height: '96px', fontSize: '28px', color: '#fff',
    background: '#b3261e', border: '4px solid #fff', borderRadius: '16px',
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    record('tap-before-play');
    try {
      await audio.play();
      record('play-resolved-1.0');
    } catch (error) {
      log.push({ event: 'play-rejected', message: String(error) });
      return;
    }
    setTimeout(() => {
      record('before-set-0.3');
      audio.volume = 0.3;
      record('immediate-readback-0.3');
      setTimeout(() => record('delayed-readback-0.3'), 750);
    }, 8000);
    setTimeout(() => {
      record('before-pause');
      audio.pause();
      record('after-pause');
    }, 17_000);
  }, { once: true });
  document.body.append(button);
  window.__railC1Audio = { audio, log, url, button };
  await new Promise(resolve => {
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) resolve();
    else audio.addEventListener('canplay', resolve, { once: true });
  });
  const rect = button.getBoundingClientRect();
  return {
    readyState: audio.readyState,
    requestedInitialVolume: 1,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  };
})()
