/*
 * A little place among the stars
 * A self-contained, procedural 3D scene. No image, sound, or 3D libraries are required.
 * To personalize the letter, edit its paragraphs in index.html inside #letter-body.
 */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = $('#world');
  const state = { section: 0, quiet: reducedMotion.matches, audio: false, guided: false, flowers: 0, fireflies: 0, currentNeed: 'comfort', raf: 0 };

  // Loading is intentionally short; it gives the sky time to draw its first frame.
  const loader = $('#loader');
  const finishLoading = () => loader?.classList.add('is-gone');
  window.addEventListener('load', () => window.setTimeout(finishLoading, 650), { once: true });
  $('.loader-skip')?.addEventListener('click', finishLoading);
  window.setTimeout(finishLoading, 1800);

  const navLinks = $$('.nav-rail a');
  const sections = $$('.chapter');
  const progress = $('#progress-fill');
  const navCount = $('#nav-count');

  function setSection(index) {
    const safe = Math.max(0, Math.min(sections.length - 1, index));
    state.section = safe;
    navLinks.forEach((link, i) => {
      if (i === safe) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
      link.classList.toggle('is-past', i < safe);
    });
    const pct = ((safe + 1) / sections.length) * 100;
    if (progress) progress.style.width = `${pct}%`;
    if (navCount) navCount.innerHTML = `${String(safe + 1).padStart(2, '0')} <i>/</i> ${String(sections.length).padStart(2, '0')}`;
    drawScene(safe);
  }

  const sectionObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setSection(sections.indexOf(visible.target));
  }, { threshold: [0.2, 0.4, 0.6] });
  sections.forEach(section => sectionObserver.observe(section));

  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  $$('.reveal').forEach(el => revealObserver.observe(el));

  function goTo(id, behavior = 'smooth') {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: state.quiet ? 'auto' : behavior, block: 'start' });
  }

  navLinks.forEach(link => link.addEventListener('click', e => {
    const id = link.getAttribute('href')?.slice(1);
    if (id) { e.preventDefault(); goTo(id); }
  }));
  $$('[data-next]').forEach(button => button.addEventListener('click', () => goTo(button.dataset.next)));
  $('#skip-to-letter')?.addEventListener('click', () => goTo('letter'));

  // The WebGL sky: small luminous 3D sprites and thin orbit/constellation lines.
  const gl = canvas?.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power' });
  let glReady = false;
  let glProgram, starBuffer, objectBuffer, lineBuffer;
  let attributes = {}, uniforms = {};
  let starVertices = new Float32Array(0), objectVertices = new Float32Array(0), lineVertices = new Float32Array(0);
  let pointer = [0, 0], aspect = 1;
  const STRIDE = 8; // x y z size r g b phase
  const vertexSource = `
    attribute vec3 aPosition;
    attribute float aSize;
    attribute vec3 aColor;
    attribute float aPhase;
    uniform float uTime;
    uniform float uAspect;
    uniform float uQuiet;
    uniform float uPointMode;
    uniform vec2 uPointer;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 p = aPosition;
      float drift = 1.0 - uQuiet;
      p.x += uPointer.x * 0.16 * drift + sin(uTime * 0.18 + aPhase) * 0.025 * drift;
      p.y += uPointer.y * 0.11 * drift + cos(uTime * 0.14 + aPhase) * 0.02 * drift;
      float depth = max(1.15, 5.6 - p.z);
      vec2 projected = vec2((p.x / depth) * 2.6 / uAspect, (p.y / depth) * 2.6);
      gl_Position = vec4(projected, 0.0, 1.0);
      gl_PointSize = clamp(aSize * (2.8 / depth), 1.0, 31.0);
      vColor = aColor;
      vAlpha = 0.56 + 0.44 * sin(uTime * 0.45 + aPhase) * drift;
    }`;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vColor;
    varying float vAlpha;
    uniform float uPointMode;
    void main() {
      if (uPointMode < 0.5) {
        gl_FragColor = vec4(vColor, 0.27 + 0.12 * vAlpha);
        return;
      }
      vec2 p = gl_PointCoord - vec2(0.5);
      float d = length(p);
      if (d > 0.5) discard;
      float glow = exp(-d * 13.0) * 0.62 + exp(-d * 5.0) * 0.25;
      float core = smoothstep(0.14, 0.0, d);
      gl_FragColor = vec4(mix(vColor, vec3(1.0, 0.94, 0.84), core * 0.56), glow * vAlpha);
    }`;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message || 'Could not compile the dream sky.');
    }
    return shader;
  }
  function makeBuffer() { return gl.createBuffer(); }
  function initGL() {
    if (!gl) return false;
    try {
      glProgram = gl.createProgram();
      gl.attachShader(glProgram, compileShader(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(glProgram, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(glProgram);
      if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProgram));
      gl.useProgram(glProgram);
      attributes = {
        position: gl.getAttribLocation(glProgram, 'aPosition'),
        size: gl.getAttribLocation(glProgram, 'aSize'),
        color: gl.getAttribLocation(glProgram, 'aColor'),
        phase: gl.getAttribLocation(glProgram, 'aPhase')
      };
      uniforms = {
        time: gl.getUniformLocation(glProgram, 'uTime'),
        aspect: gl.getUniformLocation(glProgram, 'uAspect'),
        quiet: gl.getUniformLocation(glProgram, 'uQuiet'),
        pointMode: gl.getUniformLocation(glProgram, 'uPointMode'),
        pointer: gl.getUniformLocation(glProgram, 'uPointer')
      };
      starBuffer = makeBuffer(); objectBuffer = makeBuffer(); lineBuffer = makeBuffer();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.clearColor(0, 0, 0, 0);
      glReady = true;
      resizeCanvas();
      starVertices = makeBackgroundStars();
      uploadScene(0);
      return true;
    } catch (error) {
      console.warn('The procedural sky is resting; the CSS dream world is still available.', error);
      return false;
    }
  }
  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
  }
  function makeBackgroundStars() {
    const rand = seededRandom(3741), values = [];
    for (let i = 0; i < 520; i++) {
      const z = rand() * 3.8 - 2.2;
      values.push((rand() * 2 - 1) * 7.8, (rand() * 2 - 1) * 4.2, z, 1 + rand() * 2.5,
        0.62 + rand() * 0.3, 0.62 + rand() * 0.26, 0.75 + rand() * 0.19, rand() * 6.28);
    }
    return new Float32Array(values);
  }
  function addPoint(out, x, y, z, size, color, phase = Math.random() * 6.28) {
    out.push(x, y, z, size, color[0], color[1], color[2], phase);
  }
  function addSphere(out, cx, cy, cz, radius, count, color, seed = 71, size = 4.2, solid = false) {
    const rand = seededRandom(seed);
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const u = rand() * 2 - 1;
      const phi = Math.acos(u);
      const r = solid ? radius * Math.cbrt(rand()) : radius * (0.88 + rand() * 0.13);
      const jitter = 0.83 + rand() * 0.42;
      addPoint(out, cx + r * Math.sin(phi) * Math.cos(theta), cy + r * Math.sin(phi) * Math.sin(theta), cz + r * Math.cos(phi), size * jitter, color, rand() * 6.28);
    }
  }
  function addConstellation(out, lines, points, coords, centerX = 0, centerY = 0, scale = 1, z = 0) {
    const projected = coords.map(([x, y]) => [centerX + x * scale, centerY + y * scale, z]);
    projected.forEach(([x, y, pz], i) => addPoint(points, x, y, pz, i % 2 === 0 ? 6 : 4.5, [1.0, .82, .56], 5 + i));
    for (let i = 1; i < projected.length; i++) lines.push(...projected[i - 1], ...projected[i]);
  }
  function buildScene(index) {
    const points = [], lines = [];
    const lavender = [0.72, 0.64, 0.93], pink = [0.94, 0.68, 0.76], gold = [1.0, 0.82, 0.58], blue = [0.56, 0.7, 1.0];
    const rand = seededRandom(5500 + index * 13);
    if (index === 0) {
      addSphere(points, 1.35, .62, -.15, .72, 440, [0.91,.79,.86], 88, 5.4, true);
      addSphere(points, 1.35, .62, -.15, .75, 100, [1,.87,.68], 93, 7.5);
      [[-2.5,1.55,.3],[-1.9,1.9,-.6],[2.25,-.9,.1],[.2,-1.8,-.6]].forEach((p,i) => addSphere(points,...p,.36,100, i%2?pink:lavender, 41+i, 3.5, true));
      for (let i=0;i<120;i++) addPoint(points,(rand()*2-1)*3.5,(rand()*2-1)*2.8,-1+rand()*2,1.5+rand()*3, i%4?lavender:gold,rand()*7);
    } else if (index === 1 || index === 5) {
      const starCoords = [[-2.6,1.15],[-1.55,.1],[-.12,1.15],[1.2,.1],[2.55,1.15],[-1.26,-1.6],[1.1,-1.1],[2.3,-1.45]];
      [[0,1],[1,2],[2,3],[3,4],[1,5],[5,6],[3,6],[6,7]].forEach(([a,b]) => lines.push(starCoords[a][0],starCoords[a][1],-.1,starCoords[b][0],starCoords[b][1],-.1));
      starCoords.forEach(([x,y],i)=>addSphere(points,x,y,-.1,.12,24,i%2?pink:gold,36+i,4.4,true));
      for(let i=0;i<100;i++)addPoint(points,(rand()*2-1)*4,(rand()*2-1)*2.8,-1+rand(),1+rand()*2.3,blue,rand()*8);
    } else if (index === 2) {
      for(let i=0;i<150;i++) {
        const x=(rand()*2-1)*2.5, y=-1.7+rand()*2.5, z=-.5+rand()*1.2;
        addPoint(points,x,y,z,2+rand()*4,[.76,.69,.77],rand()*6);
      }
      for(let f=0;f<7;f++) {
        const x=-2.6+f*.82, h=.5+rand()*1.15, base=-1.65+rand()*.3;
        lines.push(x,base,-.2,x,base+h,-.2);
        for(let p=0;p<9;p++) { const a=p/9*Math.PI*2, radius=.18+rand()*.1; addPoint(points,x+Math.cos(a)*radius,base+h+Math.sin(a)*radius*.7,-.18,3.3+rand()*3,p%2?pink:gold,rand()*7); }
        addPoint(points,x,base+h,-.12,5,gold,rand()*7);
      }
    } else if (index === 3 || index === 4) {
      addSphere(points,0,0,0,.68,360,index===4?pink:lavender,301+index,5.5,true);
      addSphere(points,0,0,0,.8,95,gold,361+index,6.5);
      for(let ring=0;ring<3;ring++) for(let i=0;i<100;i++) { const a=i/100*Math.PI*2, r=1.2+ring*.34; const tilt=.28+ring*.16; addPoint(points,Math.cos(a)*r,Math.sin(a)*r*tilt,-.3+Math.sin(a+ring)*.13,1.4,gold,rand()*7); }
    } else if (index === 6) {
      for(let i=0;i<7;i++) {
        const x=-3+rand()*6, y=-1.9+rand()*3.8;
        addSphere(points,x,y,-.1,.16,20,i%2?pink:gold,105+i,4,true);
      }
      for(let i=0;i<170;i++) addPoint(points,(rand()*2-1)*4.4,(rand()*2-1)*2.8,-.5+rand()*1.5,1+rand()*2.2,lavender,rand()*9);
    } else if (index === 7) {
      for(let i=0;i<12;i++) {
        const x=(rand()*2-1)*3.5,y=(rand()*2-1)*2.15,z=-.5+rand()*1.7;
        addSphere(points,x,y,z,.11+rand()*.12,22,gold,812+i,4.8,true);
      }
    } else if (index === 8) {
      addSphere(points,0,.15,0,1.06,780,[.93,.73,.8],981,5.8,true);
      for(let i=0;i<210;i++)addPoint(points,(rand()*2-1)*4,(rand()*2-1)*2.6,-.4+rand()*1.4,1.5+rand()*3.1,gold,rand()*8);
    } else if (index === 9) {
      // A simple connected star drawing of AASHI. The letters remain responsive to the viewport.
      const wordWidth = Math.min(4.8, Math.max(1.65, aspect * 2.4));
      const unit = wordWidth / 5.4;
      const glyphs = [
        [[0,0],[.5,1],[1,0],[.22,.48],[.78,.48]],
        [[0,0],[.5,1],[1,0],[.22,.48],[.78,.48]],
        [[1,1],[.18,1],[0,.78],[.82,.57],[1,.35],[.83,.08],[0,0]],
        [[0,0],[0,1],[1,1],[1,0],[1,.5],[0,.5]],
        [[.5,0],[.5,1]]
      ];
      let xoff=-wordWidth/2;
      glyphs.forEach((glyph,gi)=>{
        const coords=glyph.map(([x,y])=>[xoff+x*unit-.5*unit,y*unit+.25]);
        for(let i=1;i<coords.length;i++) lines.push(coords[i-1][0],coords[i-1][1],-.1,coords[i][0],coords[i][1],-.1);
        coords.forEach(([x,y],i)=>addPoint(points,x,y,-.1,6.2+(i%2)*1.2,gold,gi*11+i));
        xoff+=1.08*unit;
      });
      addSphere(points,0,-.65,-.5,1.5,100,lavender,404,2.2,true);
    }
    return { points: new Float32Array(points), lines: new Float32Array(lines) };
  }
  function resizeCanvas() {
    if (!canvas || !glReady) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.55);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); }
    aspect = Math.max(.38, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  }
  function uploadBuffer(buffer, data) { gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); }
  function uploadScene(index) {
    if (!glReady) return;
    const scene = buildScene(index);
    objectVertices = scene.points;
    const packedLines = [];
    for (let i = 0; i < scene.lines.length; i += 3) {
      packedLines.push(scene.lines[i], scene.lines[i + 1], scene.lines[i + 2], 1, .84, .68, .9, i * .07);
    }
    lineVertices = new Float32Array(packedLines);
    uploadBuffer(starBuffer, starVertices);
    uploadBuffer(objectBuffer, objectVertices);
    uploadBuffer(lineBuffer, lineVertices);
  }
  function setLayout(buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(attributes.position);
    gl.vertexAttribPointer(attributes.size, 1, gl.FLOAT, false, STRIDE * 4, 12);
    gl.enableVertexAttribArray(attributes.size);
    gl.vertexAttribPointer(attributes.color, 3, gl.FLOAT, false, STRIDE * 4, 16);
    gl.enableVertexAttribArray(attributes.color);
    gl.vertexAttribPointer(attributes.phase, 1, gl.FLOAT, false, STRIDE * 4, 28);
    gl.enableVertexAttribArray(attributes.phase);
  }
  function render(time) {
    if (!glReady) return;
    state.raf = 0;
    resizeCanvas();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(glProgram);
    gl.uniform1f(uniforms.time, time * .001);
    gl.uniform1f(uniforms.aspect, aspect);
    gl.uniform1f(uniforms.quiet, state.quiet ? 1 : 0);
    gl.uniform2f(uniforms.pointer, pointer[0], pointer[1]);
    gl.uniform1f(uniforms.pointMode, 1);
    setLayout(starBuffer);
    gl.drawArrays(gl.POINTS, 0, starVertices.length / STRIDE);
    if (lineVertices.length) {
      gl.uniform1f(uniforms.pointMode, 0);
      setLayout(lineBuffer);
      gl.drawArrays(gl.LINES, 0, lineVertices.length / STRIDE);
      gl.uniform1f(uniforms.pointMode, 1);
    }
    setLayout(objectBuffer);
    gl.drawArrays(gl.POINTS, 0, objectVertices.length / STRIDE);
    if (!state.quiet) state.raf = requestAnimationFrame(render);
  }
  function drawScene(index) { if (glReady && index !== state.lastDrawn) { state.lastDrawn = index; uploadScene(index); } }
  if (initGL()) state.raf = requestAnimationFrame(render);
  else if (canvas) canvas.classList.add('no-webgl');
  window.addEventListener('resize', () => { resizeCanvas(); if (glReady) uploadScene(state.section); }, { passive: true });
  window.addEventListener('pointermove', e => {
    pointer = [((e.clientX / innerWidth) - .5) * 2, (0.5 - e.clientY / innerHeight) * 2];
  }, { passive: true });

  // Gentle star notes.
  $$('.interactive-star').forEach((star, index) => star.addEventListener('click', () => {
    const note = $('#star-note');
    if (note) {
      $('.note-text', note).textContent = star.dataset.note;
      $$('.interactive-star').forEach(item => item.classList.toggle('chosen', item === star));
      star.setAttribute('aria-label', `Revealed: ${star.dataset.note}`);
    }
  }));

  // Growing flowers reveals a message. A full garden can still be revisited and tapped.
  const flowerNotes = [
    'You can go gently, even with yourself.',
    'Rest is allowed before you feel ready.',
    'You don’t need to have the right words.',
    'This moment can be small. So can the next one.',
    'You are cared for, even in the quiet.'
  ];
  $$('.seed-spot').forEach((spot, index) => spot.addEventListener('click', () => {
    if (!spot.classList.contains('bloomed')) {
      spot.classList.add('bloomed');
      spot.setAttribute('aria-label', `A flower has grown in spot ${index + 1}. Reveal its message.`);
      state.flowers++;
      $('#flower-count').textContent = String(state.flowers).padStart(2, '0');
    }
    $('#flower-message').innerHTML = `<span class="flower-message-mark">✿</span><span>${flowerNotes[index]}</span>`;
  }));

  // User-controlled breathing cue, with a one-click stop and no required timing.
  const breathCard = $('.breathing-card');
  const breathButton = $('#breath-toggle');
  const breathStop = $('#breath-stop');
  const breathText = $('#breath-instruction');
  const breathState = $('#breath-state');
  let breathTimer;
  const rhythm = ['If it feels comfortable, let the light grow', 'Nothing to hold here', 'Let the light settle, at your own pace', 'A pause belongs to you'];
  let rhythmIndex = 0;
  function stopBreathing() {
    state.guided = false;
    window.clearInterval(breathTimer);
    breathCard?.classList.remove('is-guided');
    breathButton?.setAttribute('aria-pressed', 'false');
    if (breathButton) breathButton.querySelector('span').textContent = 'Begin the gentle rhythm';
    if (breathStop) breathStop.disabled = true;
    if (breathText) breathText.textContent = 'A little room to breathe';
    if (breathState) breathState.textContent = 'The light is resting here with you.';
  }
  breathButton?.addEventListener('click', () => {
    if (state.guided) return;
    state.guided = true; rhythmIndex = 0;
    breathCard?.classList.add('is-guided');
    breathButton.setAttribute('aria-pressed', 'true');
    breathButton.querySelector('span').textContent = 'The gentle rhythm is on';
    breathStop.disabled = false;
    breathText.textContent = rhythm[0];
    breathState.textContent = 'Follow along only if it feels comfortable. Stop any time.';
    breathTimer = window.setInterval(() => {
      rhythmIndex = (rhythmIndex + 1) % rhythm.length;
      if (breathText) breathText.textContent = rhythm[rhythmIndex];
    }, 4200);
  });
  breathStop?.addEventListener('click', stopBreathing);

  // Editable memory prompts are kept in this browser only.
  const memoryKey = 'little-place-aashi-memories-v1';
  try {
    const saved = JSON.parse(localStorage.getItem(memoryKey) || '{}');
    $$('[data-editable]').forEach(el => { if (typeof saved[el.dataset.editable] === 'string') el.textContent = saved[el.dataset.editable]; });
  } catch (_) { /* Private browsing can disable storage; editing still works for the visit. */ }
  let memorySaveTimer;
  $$('[data-editable]').forEach(el => el.addEventListener('input', () => {
    window.clearTimeout(memorySaveTimer);
    memorySaveTimer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(memoryKey) || '{}');
        saved[el.dataset.editable] = el.textContent.trim();
        localStorage.setItem(memoryKey, JSON.stringify(saved));
        showToast('Your little constellation was saved on this device.');
      } catch (_) { showToast('Your words are here for this visit.'); }
    }, 450);
  }));

  // Each need has its own gentle answer. Every option is valid and optional.
  const needMessages = {
    comfort: ['You are allowed to be exactly where you are. I’m here beside you, with no hurry.', 'Nothing about this feeling makes you harder to care for. I care about you, Aashi.', 'You don’t have to carry the whole night at once. I’m close, in whatever way helps.'],
    distraction: ['A very serious question: if clouds had tiny pockets, what do you think they would keep in them?', 'Imagine a very small moon wearing an enormous, very soft sweater. It is doing its best.', 'Somewhere, a cat has just found the warmest patch of sunlight and has no plans whatsoever.'],
    encouragement: ['You don’t need to feel brave for making it through a hard moment. Being here is enough.', 'There is no deadline for feeling better. You get to take the time you need.', 'Hard days are not a measure of your worth. You are still you, and I still care.'],
    quiet: ['We can let this be quiet. You don’t have to answer, explain, or make anything of this moment.', 'Nothing is being asked of you here. Just some room to rest your eyes.', 'No words needed. I’m thinking of you, softly, from here.'],
    smile: ['A tiny moth just bumped into a lamp and is pretending that was the plan.', 'You have excellent taste in people who make you an entire tiny universe. (Very objective observation.)', 'A little note from the universe: even the moon has phases where it only shows a sliver.']
  };
  const response = $('#need-response');
  function chooseNeed(need, announce = true) {
    state.currentNeed = need;
    $$('.need-option').forEach(option => {
      const active = option.dataset.need === need;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });
    const options = needMessages[need] || needMessages.comfort;
    const message = options[Math.floor(Math.random() * options.length)];
    response.innerHTML = `<span class="response-mark">✦</span><p>${message}</p><span class="response-signature">— a little ${need === 'smile' ? 'lightness' : need}, from Vikram</span>`;
    if (announce) response.setAttribute('aria-label', `${need}: ${message}`);
  }
  $$('.need-option').forEach(option => option.addEventListener('click', () => chooseNeed(option.dataset.need)));

  // Fireflies and lucky stars are tiny interactions without scores or time limits.
  const littleThoughts = ['a minute with nothing to prove', 'a soft place to land', 'a reminder that you are cared for', 'one small thing at a time', 'a little more kindness than you expected', 'permission to rest', 'a quiet moment that belongs to you', 'a light that stays nearby'];
  $$('.firefly').forEach((fly, index) => fly.addEventListener('click', () => {
    if (fly.classList.contains('caught')) return;
    fly.classList.add('caught');
    fly.setAttribute('aria-label', 'A firefly found');
    state.fireflies++;
    $('#firefly-count').textContent = String(state.fireflies).padStart(2, '0');
    $('#play-message').textContent = `You found ${littleThoughts[index]}.`;
  }));
  const luckyThoughts = ['A small nice thing may be closer than it looks.', 'A very cozy cloud has your name on it.', 'You are allowed to change your mind and get more comfortable.', 'Somewhere, a star just made a wish for you.', 'The next thing does not need to be figured out yet.', 'A quiet cup of something nice is a good enough plan.'];
  $('#lucky-star')?.addEventListener('click', () => {
    const message = luckyThoughts[Math.floor(Math.random() * luckyThoughts.length)];
    $('#lucky-message').textContent = message;
  });

  // Inline letter editing is opt-in. The source note is editable in index.html too.
  const letterKey = 'little-place-aashi-letter-v1';
  const letterBody = $('#letter-body');
  const letterCard = $('.letter-card');
  const editLetter = $('#edit-letter');
  try {
    const saved = localStorage.getItem(letterKey);
    if (saved && letterBody) letterBody.innerHTML = sanitizeLetterMarkup(saved);
  } catch (_) { /* Continue with the source copy if storage is unavailable. */ }
  function sanitizeLetterMarkup(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const allowed = new Set(['P', 'BR', 'EM', 'STRONG', 'SPAN']);
    const wrapper = document.createElement('div');
    const clean = node => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
      const children = [...node.childNodes].map(clean);
      if (!allowed.has(node.tagName)) {
        const fragment = document.createDocumentFragment();
        children.forEach(child => fragment.append(child));
        return fragment;
      }
      const safe = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === 'P' && node.classList.contains('letter-sign')) safe.className = 'letter-sign';
      children.forEach(child => safe.append(child));
      return safe;
    };
    [...parsed.body.childNodes].map(clean).forEach(node => wrapper.append(node));
    return wrapper.innerHTML;
  }
  editLetter?.addEventListener('click', () => {
    const editing = letterBody?.getAttribute('contenteditable') === 'true';
    if (letterBody) letterBody.setAttribute('contenteditable', String(!editing));
    letterCard?.classList.toggle('editing', !editing);
    editLetter.innerHTML = editing ? '<span>✓</span> Done' : '<span>✎</span> Personalize this note';
    if (!editing) {
      letterBody?.focus();
      $('#letter-edit-hint').textContent = 'Edit the words, then choose “Done” to keep them on this device.';
    } else {
      try { localStorage.setItem(letterKey, sanitizeLetterMarkup(letterBody.innerHTML)); showToast('Your note was saved on this device.'); }
      catch (_) { showToast('Your note is here for this visit.'); }
    }
  });

  // Optional, locally synthesized ambient tone. No audio starts until requested.
  let audioContext, masterGain, toneOscillatorsStarted = false, masterConnected = false;
  async function toggleAudio() {
    const button = $('#sound-toggle');
    if (!state.audio) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Audio is not available in this browser.');
        audioContext ||= new AudioContextClass();
        if (audioContext.state === 'suspended') await audioContext.resume();
        if (!masterGain) { masterGain = audioContext.createGain(); masterGain.gain.value = 0; }
        if (!masterConnected) { masterGain.connect(audioContext.destination); masterConnected = true; }
        masterGain.gain.cancelScheduledValues(audioContext.currentTime);
        masterGain.gain.setValueAtTime(masterGain.gain.value, audioContext.currentTime);
        if (!toneOscillatorsStarted) {
          [110, 164.81, 220.0].forEach((frequency, i) => {
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = i === 1 ? 'sine' : 'triangle';
            oscillator.frequency.value = frequency;
            gain.gain.value = i === 0 ? .48 : .18;
            oscillator.connect(gain); gain.connect(masterGain); oscillator.start();
          });
          toneOscillatorsStarted = true;
        }
        masterGain.gain.setTargetAtTime(.027, audioContext.currentTime, .7);
        state.audio = true;
        button.setAttribute('aria-pressed', 'true');
        button.title = 'Turn ambient sound off';
        button.setAttribute('aria-label', 'Ambient sound is on');
        $('.utility-label', button).textContent = 'Sound on';
      } catch (error) {
        showToast(error.message || 'Ambient sound is not available here.');
      }
    } else {
      state.audio = false;
      if (masterGain && audioContext) {
        masterGain.gain.cancelScheduledValues(audioContext.currentTime);
        masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .2);
      }
      button.setAttribute('aria-pressed', 'false');
      button.title = 'Ambient sound is off';
      button.setAttribute('aria-label', 'Ambient sound is off');
      $('.utility-label', button).textContent = 'Sound off';
    }
  }
  $('#sound-toggle')?.addEventListener('click', toggleAudio);

  function setQuiet(value) {
    state.quiet = value;
    document.body.classList.toggle('quiet-mode', value);
    $('#motion-toggle')?.setAttribute('aria-pressed', String(value));
    $('#motion-toggle')?.setAttribute('aria-label', value ? 'Turn quiet mode off and resume animations' : 'Turn quiet mode on and skip animations');
    if (value && state.audio) toggleAudio();
    if (glReady) gl.uniform1f(uniforms.quiet, value ? 1 : 0);
    if (value && state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; render(performance.now()); }
    else if (!value && glReady && !state.raf) state.raf = requestAnimationFrame(render);
    if (value) showToast('Quiet mode is on. The sky will keep still.');
  }
  $('#motion-toggle')?.addEventListener('click', () => setQuiet(!state.quiet));
  $('#quiet-finish')?.addEventListener('click', () => { setQuiet(true); });
  if (state.quiet) {
    document.body.classList.add('quiet-mode');
    $('#motion-toggle')?.setAttribute('aria-pressed', 'true');
    $('#motion-toggle')?.setAttribute('aria-label', 'Turn quiet mode off and resume animations');
  }

  let toastTimer;
  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2300);
  }

  function restartExperience() {
    stopBreathing();
    state.flowers = 0; state.fireflies = 0;
    $('#flower-count').textContent = '00';
    $$('.seed-spot').forEach((spot, index) => { spot.classList.remove('bloomed'); spot.setAttribute('aria-label', `Grow a flower in the ${['first','second','third','fourth','fifth'][index]} spot`); });
    $('#flower-message').innerHTML = '<span class="flower-message-mark">✿</span><span>Choose a little patch of earth. See what grows.</span>';
    $('#firefly-count').textContent = '00';
    $$('.firefly').forEach((fly, index) => { fly.classList.remove('caught'); fly.setAttribute('aria-label', `Catch the ${['first','second','third','fourth','fifth','sixth','seventh','eighth'][index]} firefly`); });
    $('#play-message').textContent = 'No score. Just a few lights, if you feel like it.';
    $('#lucky-message').textContent = '';
    $('#star-note .note-text').textContent = 'Choose a star. It has something gentle to say.';
    $$('.interactive-star').forEach(star => star.classList.remove('chosen'));
    chooseNeed('comfort', false);
    goTo('welcome', 'auto');
  }
  $('#replay')?.addEventListener('click', restartExperience);
  $('#restart-top')?.addEventListener('click', restartExperience);
  $('#footer-restart')?.addEventListener('click', restartExperience);

  // Keep guided cues and controls keyboard-friendly.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.guided) stopBreathing();
  });
  reducedMotion.addEventListener?.('change', event => {
    if (event.matches) { setQuiet(true); }
  });
  setSection(0);
})();
