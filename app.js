/* ArcSense showcase: simulator, live chart, flow diagram, scroll motion.
   Everything here is simulated in the browser. No real sensor data. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceMQ.matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rad = (d) => (d * Math.PI) / 180;
  const fmt = (v) => `${Math.round(v)}°`;
  const hasGSAP = typeof window.gsap !== 'undefined';

  /* Shared bus so hardware.js can follow the exploded-view scroll. */
  const bus = (window.ArcSense = window.ArcSense || {});
  bus.explode = { p: reduced() ? 1 : 0, active: -1, listeners: new Set() };
  bus.setExplode = (p, active) => {
    bus.explode.p = p; bus.explode.active = active;
    bus.explode.listeners.forEach((fn) => fn(p, active));
  };

  /* ================================================================
     MODEL
     lean = upper-sensor tilt from upright (0..80°).
     Hip hinge: the pelvis tips with the trunk, so the lower sensor
     follows closely (lower = 82% of upper). Rounded back: the pelvis
     barely moves (lower = 25% of upper), so the lumbar bend grows.
     These ratios are illustrative, not measured.
     ================================================================ */
  const MODES = { hinge: 0.82, round: 0.25 };
  const state = {
    mode: 'hinge', lean: 0, limit: 30,
    over: false, events: [], timeOver: 0, peak: 0,
    startedAt: performance.now(), interacted: false,
  };
  const angles = () => {
    const upper = state.lean;
    const lower = upper * MODES[state.mode];
    return { upper, lower, bend: upper - lower };
  };

  /* ================================================================
     FIGURE (side view, facing right)
     ================================================================ */
  const fig = $('#figure');
  const body = $('#fig-body');
  const sensorsG = $('#fig-sensors');
  const buzzG = $('#fig-buzz');
  const mk = (tag, attrs, parent) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const HIP = { x: 168, y: 262 };
  const dir = (a) => ({ x: Math.sin(rad(a)), y: -Math.cos(rad(a)) });      // along the spine
  const back = (a) => ({ x: -Math.cos(rad(a)), y: -Math.sin(rad(a)) });    // toward the back surface

  const legs = mk('polyline', { class: 'limb', 'stroke-width': 24 }, body);
  const torso = mk('polyline', { class: 'limb', 'stroke-width': 34 }, body);
  const arm = mk('polyline', { class: 'limb', 'stroke-width': 14 }, body);
  const head = mk('circle', { class: 'head', r: 21 }, body);
  const spine = mk('polyline', { class: 'spine' }, body);
  const lumbar = mk('polyline', { class: 'lumbar' }, body);

  const makeSensor = (w, h, label) => {
    const g = mk('g', {}, sensorsG);
    const shake = mk('g', {}, g);
    mk('rect', { class: 'pod', x: -w / 2, y: -h / 2, width: w, height: h, rx: 2 }, shake);
    const led = mk('circle', { class: 'pod-led', r: 2.6, cx: 0, cy: 0 }, shake);
    const ref = mk('line', { class: 'tilt' }, sensorsG);
    const arc = mk('path', { class: 'tilt' }, sensorsG);
    const txt = mk('text', { class: 'tilt-txt' }, sensorsG);
    return { g, shake, led, ref, arc, txt, label };
  };
  const podT12 = makeSensor(22, 13, 'T12');
  const hubS2 = makeSensor(32, 17, 'S2');

  const pts = (arr) => arr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const add = (p, v, s) => ({ x: p.x + v.x * s, y: p.y + v.y * s });

  function placeSensor(s, p, a, labelSide) {
    const n = back(a);
    const c = add(p, n, 18);
    s.g.setAttribute('transform', `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${a.toFixed(1)})`);
    // tilt guide: vertical reference + arc to the sensor's direction
    const o = add(c, n, 14);
    const L = 34;
    s.ref.setAttribute('x1', o.x); s.ref.setAttribute('y1', o.y);
    s.ref.setAttribute('x2', o.x); s.ref.setAttribute('y2', o.y - L);
    const r = 22;
    const d = dir(a);
    const end = add(o, d, r);
    const large = a > 180 ? 1 : 0;
    s.arc.setAttribute('d', a < 1 ? '' : `M ${o.x} ${o.y - r} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`);
    s.txt.setAttribute('x', (o.x + labelSide).toFixed(1));
    s.txt.setAttribute('y', (o.y - L - 6).toFixed(1));
    s.txt.setAttribute('text-anchor', labelSide < 0 ? 'end' : 'start');
    s.txt.textContent = `${s.label} ${fmt(a)}`;
    return c;
  }

  let hubPos = { x: 0, y: 0 };
  function drawFigure() {
    const { upper, lower, bend } = angles();
    const over = bend > state.limit;
    // legs: hips flex a little with the lean, feet planted
    const knee = { x: HIP.x + 6 + lower * 0.12, y: 322 };
    legs.setAttribute('points', pts([HIP, knee, { x: 170, y: 378 }, { x: 196, y: 380 }]));

    // trunk chain: pelvis -> S2 -> lumbar curve -> T12 -> thorax -> neck
    const chain = [HIP];
    let p = add(HIP, dir(lower), 26);
    const s2 = p; chain.push(p);
    const lumbarPts = [p];
    const N = 10;
    for (let i = 1; i <= N; i++) {
      const a = lower + (upper - lower) * (i / N);
      p = add(p, dir(a), 8);
      chain.push(p); lumbarPts.push(p);
    }
    const t12 = p;
    for (let i = 1; i <= 4; i++) { p = add(p, dir(upper + i * 1.5), 20); chain.push(p); }
    const shoulder = p;
    const neck = add(shoulder, dir(upper + 10), 14);
    const headC = add(neck, dir(upper + 14), 18);
    torso.setAttribute('points', pts(chain));
    head.setAttribute('cx', headC.x.toFixed(1)); head.setAttribute('cy', headC.y.toFixed(1));

    // arms hang toward the floor
    const elbow = { x: shoulder.x + 6, y: shoulder.y + 44 };
    const hand = { x: shoulder.x + 12, y: Math.min(shoulder.y + 90, 372) };
    arm.setAttribute('points', pts([shoulder, elbow, hand]));

    // spine line along the back surface, lumbar section highlighted
    const offset = (q, a) => add(q, back(a), 10);
    const spinePts = chain.map((q, i) => {
      const a = i <= 1 ? lower : i <= N + 1 ? lower + (upper - lower) * ((i - 1) / N) : upper;
      return offset(q, a);
    });
    spine.setAttribute('points', pts(spinePts));
    lumbar.setAttribute('points', pts(lumbarPts.map((q, i) => offset(q, lower + (upper - lower) * (i / N)))));
    lumbar.classList.toggle('over', over);

    placeSensor(podT12, t12, upper, 26);
    hubPos = placeSensor(hubS2, s2, lower, -26);
    podT12.led.classList.toggle('over', over);
    hubS2.led.classList.toggle('over', over);
  }

  /* Drag the upper body to set the lean. */
  let dragging = false;
  function leanFromPointer(e) {
    const r = fig.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 440;
    const y = ((e.clientY - r.top) / r.height) * 400;
    const a = Math.atan2(x - HIP.x, HIP.y - y) * (180 / Math.PI);
    setLean(clamp(Math.round(a * 1.08), 0, 80), true);
  }
  fig.addEventListener('pointerdown', (e) => {
    dragging = true; fig.setPointerCapture(e.pointerId); fig.classList.add('dragging'); leanFromPointer(e);
  });
  fig.addEventListener('pointermove', (e) => { if (dragging) leanFromPointer(e); });
  const endDrag = () => { dragging = false; fig.classList.remove('dragging'); };
  fig.addEventListener('pointerup', endDrag);
  fig.addEventListener('pointercancel', endDrag);

  /* ================================================================
     CONTROLS + READOUT
     ================================================================ */
  const leanIn = $('#lean'), limitIn = $('#limit');
  const modeBtns = $$('.seg [data-mode]');
  const el = {
    leanOut: $('#lean-out'), limitOut: $('#limit-out'),
    upper: $('#r-upper'), lower: $('#r-lower'), bend: $('#r-bend'), formula: $('#r-formula'),
    chip: $('#state-chip'), chipText: $('#state-text'),
    log: $('#log-list'), logEmpty: $('#log-empty'),
    sEvents: $('#s-events'), sOver: $('#s-over'), sPeak: $('#s-peak'), sLimit: $('#s-limit'),
    fSense: $('#f-sense'), fCompare: $('#f-compare'), fCheck: $('#f-check'), fCue: $('#f-cue'),
  };

  function userTouched() { state.interacted = true; stopDemo(); }

  function setLean(v, byUser) {
    if (byUser) userTouched();
    state.lean = v; leanIn.value = Math.round(v); render();
  }
  function setMode(m, byUser) {
    if (byUser) userTouched();
    state.mode = m;
    modeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
    render();
  }
  leanIn.addEventListener('input', () => setLean(+leanIn.value, true));
  limitIn.addEventListener('input', () => { state.limit = +limitIn.value; render(); });
  modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode, true)));
  // radiogroup arrow keys
  $('.seg').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = state.mode === 'hinge' ? 'round' : 'hinge';
    setMode(next, true); $(`.seg [data-mode="${next}"]`).focus();
  });
  modeBtns.forEach((b) => b.setAttribute('tabindex', b.dataset.mode === state.mode ? '0' : '-1'));

  const clock = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  function render() {
    const { upper, lower, bend } = angles();
    el.leanOut.textContent = fmt(upper);
    el.limitOut.textContent = fmt(state.limit);
    el.upper.textContent = fmt(upper);
    el.lower.textContent = fmt(lower);
    el.bend.textContent = fmt(bend);
    el.formula.textContent = `${fmt(upper)} − ${fmt(lower)} = ${fmt(bend)}`;
    modeBtns.forEach((b) => b.setAttribute('tabindex', b.dataset.mode === state.mode ? '0' : '-1'));
    checkLimit(bend);
    drawFigure();
    const over = state.over;
    el.fSense.textContent = `upper ${fmt(upper)} · lower ${fmt(lower)}`;
    el.fCompare.textContent = `bend ${fmt(bend)}`;
    el.fCheck.textContent = `limit ${fmt(state.limit)} · ${over ? 'over' : 'under'}`;
    el.fCheck.classList.toggle('over', over);
    el.fCue.textContent = `${state.events.length} event${state.events.length === 1 ? '' : 's'} logged`;
    el.fCue.classList.toggle('over', over);
    el.sLimit.textContent = fmt(state.limit);
  }

  /* Limit crossing: rising edge = one event; 1° hysteresis on the way back. */
  function checkLimit(bend) {
    if (!state.over && bend > state.limit) {
      state.over = true;
      const ev = { t: performance.now() - state.startedAt, peak: bend, mode: state.mode };
      state.events.push(ev);
      addLogRow(ev);
      buzz();
      el.chip.dataset.over = 'true';
      el.chipText.textContent = 'Over limit · buzz';
      updateSummary();
    } else if (state.over) {
      const ev = state.events[state.events.length - 1];
      if (bend > ev.peak) { ev.peak = bend; ev.row.querySelector('.v').textContent = fmt(bend); }
      if (bend < state.limit - 1) {
        state.over = false;
        el.chip.dataset.over = 'false';
        el.chipText.textContent = 'Under limit · no cue';
      }
    }
    if (bend > state.peak) { state.peak = bend; }
  }

  function addLogRow(ev) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${clock(ev.t)}</span><span class="m">${ev.mode === 'round' ? 'Rounded back' : 'Hip hinge'} past limit</span><span class="v">${fmt(ev.peak)}</span>`;
    ev.row = li;
    el.log.prepend(li);
    el.logEmpty.hidden = true;
  }
  $('#log-clear').addEventListener('click', () => {
    state.events = []; state.timeOver = 0; state.peak = 0; state.startedAt = performance.now();
    el.log.innerHTML = ''; el.logEmpty.hidden = false; updateSummary(); render();
  });

  function buzz() {
    if (!hasGSAP || reduced()) return;
    gsap.fromTo(hubS2.shake, { x: -1.6 }, { x: 1.6, duration: 0.035, repeat: 9, yoyo: true, ease: 'none', overwrite: true, onComplete: () => gsap.set(hubS2.shake, { x: 0 }) });
    for (let i = 0; i < 2; i++) {
      const ring = mk('circle', { class: 'ring', cx: hubPos.x, cy: hubPos.y, r: 14 }, buzzG);
      gsap.fromTo(ring, { scale: 0.8, opacity: 0.9, svgOrigin: `${hubPos.x} ${hubPos.y}` },
        { scale: 2.6, opacity: 0, duration: 0.7, delay: i * 0.16, ease: 'power2.out', onComplete: () => ring.remove() });
    }
  }

  /* ================================================================
     DEMO MOTION (for the pitch video; pauses on any user input)
     ================================================================ */
  const demoBtn = $('#demo-toggle');
  let demo = null;
  function buildDemo() {
    const proxy = { lean: 0 };
    const tl = gsap.timeline({ repeat: -1, paused: true, defaults: { ease: 'sine.inOut' },
      onUpdate: () => { state.lean = proxy.lean; leanIn.value = Math.round(proxy.lean); render(); } });
    const move = (mode, to, up, hold, down) => {
      tl.call(() => setMode(mode, false));
      tl.to(proxy, { lean: to, duration: up });
      tl.to(proxy, { lean: to, duration: hold });
      tl.to(proxy, { lean: 0, duration: down });
      tl.to(proxy, { lean: 0, duration: 0.6 });
    };
    move('hinge', 58, 1.7, 0.6, 1.4);
    move('round', 52, 1.8, 0.9, 1.5);
    move('hinge', 42, 1.3, 0.4, 1.2);
    move('round', 34, 1.4, 0.5, 1.2);
    return tl;
  }
  function startDemo() {
    if (!hasGSAP) return;
    demo = demo || buildDemo();
    demo.play();
    demoBtn.setAttribute('aria-pressed', 'true');
    demoBtn.querySelector('span').textContent = 'Pause demo motion';
  }
  function stopDemo() {
    if (demo) demo.pause();
    demoBtn.setAttribute('aria-pressed', 'false');
    demoBtn.querySelector('span').textContent = 'Play demo motion';
  }
  demoBtn.addEventListener('click', () => {
    if (demoBtn.getAttribute('aria-pressed') === 'true') { state.interacted = true; stopDemo(); }
    else startDemo();
  });

  /* ================================================================
     LIVE CHART (canvas, 20 samples/s, last 30 s)
     ================================================================ */
  const canvas = $('#chart'), ctx = canvas.getContext('2d');
  const tip = $('#chart-tip');
  const RATE = 20, WINDOW = 30, MAXN = RATE * WINDOW;
  const samples = []; // { bend, limit }
  // Seed with gentle hip-hinge motion (all under the limit) so the chart is never empty.
  for (let i = 0; i < MAXN; i++) {
    const t = i / RATE;
    const lean = Math.max(0, 50 * Math.sin((t / 6) * Math.PI)) * (Math.floor(t / 6) % 2 ? 0 : 1);
    samples.push({ bend: lean * (1 - MODES.hinge), limit: 30 });
  }
  let colors = {};
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    colors = { accent: cs.getPropertyValue('--accent').trim(), warn: cs.getPropertyValue('--warn').trim(), warnSoft: cs.getPropertyValue('--warn-soft').trim(), line: cs.getPropertyValue('--line').trim(), muted: cs.getPropertyValue('--muted').trim(), ink: cs.getPropertyValue('--ink').trim(), surface: cs.getPropertyValue('--surface').trim() };
  };
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawChart(); });
  new MutationObserver(() => { readColors(); drawChart(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let W = 0, H = 0, dpr = 1, hoverX = null;
  const PAD = { l: 36, r: 12, t: 12, b: 26 };
  const YMAX = 65;
  function sizeChart() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    drawChart();
  }
  const xAt = (i) => PAD.l + (i / (MAXN - 1)) * (W - PAD.l - PAD.r);
  const yAt = (v) => PAD.t + (1 - v / YMAX) * (H - PAD.t - PAD.b);

  function drawChart() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '400 11px "JetBrains Mono", ui-monospace, monospace';
    // grid + y ticks
    ctx.lineWidth = 1; ctx.strokeStyle = colors.line; ctx.fillStyle = colors.muted;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [0, 15, 30, 45, 60].forEach((v) => {
      const y = Math.round(yAt(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.fillText(`${v}°`, PAD.l - 6, y);
    });
    // x ticks
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    [[0, '−30 s'], [10, '−20 s'], [20, '−10 s'], [30, 'now']].forEach(([s, label]) => {
      const x = xAt((s / WINDOW) * (MAXN - 1));
      ctx.fillText(label, clamp(x, PAD.l + 14, W - PAD.r - 14), H - PAD.b + 8);
    });

    // over-limit fill (status color, reserved for "over limit")
    ctx.fillStyle = colors.warnSoft;
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i], x = xAt(i);
      if (s.bend > s.limit) {
        if (!open) { ctx.moveTo(x, yAt(s.limit)); open = true; }
        ctx.lineTo(x, yAt(s.bend));
      } else if (open) {
        ctx.lineTo(x, yAt(s.limit)); ctx.closePath(); open = false;
      }
    }
    if (open) { ctx.lineTo(xAt(samples.length - 1), yAt(samples[samples.length - 1].limit)); ctx.closePath(); }
    ctx.fill();

    // limit line (follows the slider over time)
    ctx.setLineDash([5, 5]); ctx.strokeStyle = colors.muted; ctx.lineWidth = 1.5;
    ctx.beginPath();
    samples.forEach((s, i) => { const x = xAt(i), y = yAt(s.limit); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
    const last = samples[samples.length - 1];
    ctx.fillStyle = colors.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`limit ${Math.round(last.limit)}°`, PAD.l + 6, yAt(last.limit) - 4);

    // bend line
    ctx.strokeStyle = colors.accent; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((s, i) => { const x = xAt(i), y = yAt(s.bend); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    // endpoint with surface ring
    const ex = xAt(samples.length - 1), ey = yAt(last.bend);
    ctx.fillStyle = colors.surface; ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors.accent; ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();

    // hover crosshair + tooltip
    if (hoverX !== null) {
      const i = clamp(Math.round(((hoverX - PAD.l) / (W - PAD.l - PAD.r)) * (MAXN - 1)), 0, samples.length - 1);
      const s = samples[i], x = xAt(i), y = yAt(s.bend);
      ctx.strokeStyle = colors.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, PAD.t); ctx.lineTo(Math.round(x) + 0.5, H - PAD.b); ctx.stroke();
      ctx.fillStyle = colors.surface; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.accent; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      const ago = ((samples.length - 1 - i) / RATE).toFixed(1);
      tip.hidden = false;
      tip.textContent = `${ago === '0.0' ? 'now' : `−${ago} s`} · ${fmt(s.bend)}${s.bend > s.limit ? ' · over' : ''}`;
      tip.style.left = `${clamp(x, 70, W - 70)}px`;
    } else tip.hidden = true;
  }
  canvas.addEventListener('pointermove', (e) => { hoverX = e.clientX - canvas.getBoundingClientRect().left; drawChart(); });
  canvas.addEventListener('pointerleave', () => { hoverX = null; drawChart(); });
  new ResizeObserver(sizeChart).observe(canvas);

  /* Table view of the chart (one row per second). */
  const tableView = $('.table-view'), tbody = $('#chart-table tbody');
  function fillTable() {
    if (!tableView.open) return;
    const rows = [];
    for (let s = 0; s <= WINDOW; s += 1) {
      const i = samples.length - 1 - s * RATE;
      if (i < 0) break;
      const v = samples[i];
      rows.push(`<tr><td>${s === 0 ? 'now' : `${s} s`}</td><td>${fmt(v.bend)}</td><td>${v.bend > v.limit ? 'Yes' : 'No'}</td></tr>`);
    }
    tbody.innerHTML = rows.join('');
  }
  tableView.addEventListener('toggle', fillTable);

  /* Summary card */
  const strip = $('#strip');
  function updateSummary() {
    el.sEvents.textContent = state.events.length;
    el.sOver.textContent = `${state.timeOver.toFixed(1)} s`;
    el.sPeak.textContent = fmt(state.peak);
    const mins = Math.max(1, Math.ceil((performance.now() - state.startedAt) / 60000));
    const n = 10, first = Math.max(0, mins - n);
    const counts = new Array(n).fill(0);
    state.events.forEach((ev) => { const m = Math.floor(ev.t / 60000) - first; if (m >= 0 && m < n) counts[m]++; });
    const max = Math.max(1, ...counts);
    strip.innerHTML = counts.map((c, i) => `<span class="${c ? '' : 'zero'}" style="height:${c ? Math.max(12, (c / max) * 100) : 6}%" title="Minute ${first + i + 1}: ${c} event${c === 1 ? '' : 's'}"></span>`).join('');
    strip.setAttribute('aria-label', `Buzz events per minute of this session: ${counts.join(', ')}`);
  }

  /* Sampling loop: GSAP ticker if present, else rAF. */
  let acc = 0, last = performance.now(), tableAcc = 0;
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    acc += dt; tableAcc += dt;
    if (state.over) state.timeOver += dt;
    let pushed = false;
    while (acc >= 1 / RATE) {
      acc -= 1 / RATE;
      samples.push({ bend: angles().bend, limit: state.limit });
      if (samples.length > MAXN) samples.shift();
      pushed = true;
    }
    if (pushed) { drawChart(); el.sOver.textContent = `${state.timeOver.toFixed(1)} s`; el.sPeak.textContent = fmt(state.peak); }
    if (tableAcc > 1) { tableAcc = 0; fillTable(); updateSummary(); }
  }
  if (hasGSAP) gsap.ticker.add(tick);
  else (function loop() { tick(); requestAnimationFrame(loop); })();

  /* ================================================================
     AUDIENCE MINI FIGURES (same body model as the simulator, smaller)
     ================================================================ */
  function drawMini(svg, { upper, lower, prop, over, limit = 30 }) {
    svg.innerHTML = '';
    const S = 0.27, H = { x: 74, y: 70 };
    const m = (tag, attrs) => mk(tag, attrs, svg);
    const chain = [H];
    let p = add(H, dir(lower), 26 * S); const s2 = p; chain.push(p);
    const lum = [p];
    for (let i = 1; i <= 10; i++) { p = add(p, dir(lower + (upper - lower) * (i / 10)), 8 * S); chain.push(p); lum.push(p); }
    const t12 = p;
    for (let i = 1; i <= 4; i++) { p = add(p, dir(upper), 20 * S); chain.push(p); }
    const sh = p, head = add(add(sh, dir(upper + 10), 14 * S), dir(upper + 14), 18 * S);
    const knee = { x: H.x + 3 + lower * 0.06, y: 86 }, foot = { x: H.x + 2, y: 100 };
    const handY = Math.min(sh.y + 26, 92);
    const hand = { x: sh.x + 5, y: handY };
    m('ellipse', { class: 'shadow', cx: foot.x + 4, cy: 103, rx: 15, ry: 1.8 });
    m('polyline', { class: 'limb', 'stroke-width': 7, points: pts([H, knee, foot, { x: foot.x + 8, y: 101 }]) });
    m('polyline', { class: 'limb', 'stroke-width': 10, points: pts(chain) });
    m('polyline', { class: 'limb', 'stroke-width': 4.5, points: pts([sh, { x: sh.x + 2, y: sh.y + 13 }, hand]) });
    m('circle', { class: 'head', cx: head.x, cy: head.y, r: 6.5 });
    const off = (q, a) => add(q, back(a), 3.2);
    m('polyline', { class: `lumbar${over ? ' over' : ''}`, points: pts(lum.map((q, i) => off(q, lower + (upper - lower) * (i / 10)))) });
    const pod = (q, a, w, h) => { const c = add(q, back(a), 6); m('rect', { class: 'pod', x: -w / 2, y: -h / 2, width: w, height: h, rx: 1, transform: `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${a})` }); return c; };
    pod(t12, upper, 7, 4);
    const hub = pod(s2, lower, 10, 5.5);
    if (prop === 'bar') {
      m('line', { class: 'prop', x1: hand.x - 24, y1: hand.y, x2: hand.x + 24, y2: hand.y });
      [-21, 17].forEach((dx) => m('rect', { class: 'prop-fill', x: hand.x + dx, y: hand.y - 7, width: 4, height: 14 }));
    } else if (prop === 'box') {
      m('rect', { class: 'prop', x: hand.x - 8, y: hand.y - 1, width: 16, height: 11 });
    }
    if (over) [[-9, -5, -14, -8], [-9, 5, -14, 8], [-10, 0, -16, 0]].forEach(([a, b, c, d]) =>
      m('line', { class: 'buzz', x1: hub.x + a, y1: hub.y + b, x2: hub.x + c, y2: hub.y + d }));
    // live readout, top right
    const bend = upper - lower;
    m('text', { x: 6, y: 10 }).textContent = 'LUMBAR BEND';
    m('text', { class: 'val', x: 6, y: 18 }).textContent = `${Math.round(bend)}° / LIMIT ${Math.round(limit)}°`;
    m('text', { x: 6, y: 26 }).textContent = over ? 'BUZZ + LOG' : 'NO CUE';
  }

  // Each group's typical movement: peak lean and how much the pelvis follows (illustrative).
  const WHO = {
    rehab: { peak: 32, ratio: 0.82, prop: null, period: 5 },   // careful reach, hinge
    athlete: { peak: 60, ratio: 0.82, prop: 'bar', period: 3.6 }, // deadlift, hinge
    older: { peak: 60, ratio: 0.25, prop: 'box', period: 4.4 },   // box lift, rounded back
  };
  const whoFig = $('#who-fig'), whoBody = $('#who-body');

  const whoLimit = 30;
  const whoTabs = $$('.who-tabs [role="tab"]');
  let whoKey = 'rehab', whoT0 = performance.now(), whoVisible = false;
  let whoManual = null; // lean set by dragging; null = play the loop
  function drawWho(now) {
    const w = WHO[whoKey];
    const phase = reduced() ? 0.5 : (((now - whoT0) / 1000) % w.period) / w.period;
    const lean = w.peak * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    const upper = whoManual !== null ? whoManual : reduced() ? w.peak : lean, lower = upper * w.ratio;
    const over = upper - lower > whoLimit;
    drawMini(whoBody, { upper, lower, prop: w.prop, over, limit: whoLimit });
  }
  function selectWho(key, focus) {
    whoKey = key; whoT0 = performance.now();
    whoTabs.forEach((t) => {
      const on = t.dataset.who === key;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    drawWho(performance.now());
  }
  whoTabs.forEach((t, i) => {
    t.addEventListener('click', () => selectWho(t.dataset.who));
    t.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      selectWho(whoTabs[(i + d + whoTabs.length) % whoTabs.length].dataset.who, true);
    });
  });
  // Drag the figure to bend it yourself; it goes back to playing when you let go.
  const whoLean = (e) => {
    const r = whoFig.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 192, y = ((e.clientY - r.top) / r.height) * 108;
    whoManual = clamp(Math.atan2(x - 74, 70 - y) * (180 / Math.PI) * 1.05, 0, 80);
    drawWho(performance.now());
  };
  whoFig.addEventListener('pointerdown', (e) => { whoFig.setPointerCapture(e.pointerId); whoFig.classList.add('dragging'); whoLean(e); });
  whoFig.addEventListener('pointermove', (e) => { if (whoFig.classList.contains('dragging')) whoLean(e); });
  const whoRelease = () => {
    if (!whoFig.classList.contains('dragging')) return;
    whoFig.classList.remove('dragging');
    // resume the loop from the pose you left it in
    const w = WHO[whoKey], f = clamp(whoManual / w.peak, 0, 1);
    whoT0 = performance.now() - (Math.acos(1 - 2 * f) / (Math.PI * 2)) * w.period * 1000;
    whoManual = null;
  };
  whoFig.addEventListener('pointerup', whoRelease);
  whoFig.addEventListener('pointercancel', whoRelease);
  new IntersectionObserver((es) => { whoVisible = es.some((e) => e.isIntersecting); }).observe(whoFig);
  (function whoLoop(now) { if (whoVisible && !reduced()) drawWho(now); requestAnimationFrame(whoLoop); })(performance.now());
  drawWho(performance.now());

  render();
  updateSummary();

  /* ================================================================
     SCROLL: Lenis smooth scroll + ScrollTrigger (off for reduced motion)
     ================================================================ */
  let lenis = null;
  const navH = () => $('#nav').offsetHeight;
  function goTo(target) {
    const y = target.getBoundingClientRect().top + window.scrollY - navH() - 8;
    if (lenis) lenis.scrollTo(y, { duration: 1.1 });
    else window.scrollTo({ top: y, behavior: 'auto' });
  }
  // In-page links: smooth scroll, then move keyboard focus to the target.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const target = id && document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    goTo(target);
    history.replaceState(null, '', `#${id}`);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  /* Nav: visible only at the very top; fades out as soon as the page scrolls. */
  const nav = $('#nav');
  let navTick = false;
  const syncNav = () => { navTick = false; nav.classList.toggle('is-hidden', window.scrollY > 8); };
  window.addEventListener('scroll', () => { if (!navTick) { navTick = true; requestAnimationFrame(syncNav); } }, { passive: true });
  syncNav();

  if (!hasGSAP) return;
  gsap.registerPlugin(ScrollTrigger);

  const mm = gsap.matchMedia();
  mm.add({ motion: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' }, (ctx) => {
    const { motion } = ctx.conditions;

    if (motion && typeof window.Lenis !== 'undefined') {
      lenis = new Lenis({ lerp: 0.12, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      const raf = (time) => lenis.raf(time * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
    }

    // Hero enters once on load.
    if (motion) gsap.from('[data-enter]', { y: 18, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, clearProps: 'all' });

    // Simulator: start the demo motion the first time it comes into view.
    ScrollTrigger.create({
      trigger: '#simulator', start: 'top 65%', once: true,
      onEnter: () => { if (motion && !state.interacted) startDemo(); },
    });

    /* Exploded view: pin the section and scrub the layers apart. */
    const layerBtns = $$('#layers button');
    const setActive = (i) => layerBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    let explodeST = null;
    const pinEl = $('#inside-pin');
    if (motion) {
      $('#inside').classList.add('is-scrub');
      setActive(0); // measure with one description open
      const fits = pinEl.offsetHeight <= window.innerHeight + 4;
      setActive(-1);
      explodeST = ScrollTrigger.create({
        trigger: '#inside', start: 'top top', end: () => `+=${Math.round(window.innerHeight * 2.2)}`,
        pin: fits ? pinEl : false, scrub: true, invalidateOnRefresh: true,
        ...(fits ? {} : { start: 'top 70%', end: 'bottom 30%' }),
        onUpdate: (self) => {
          const p = self.progress;
          const i = p < 0.04 ? -1 : Math.min(4, Math.floor(p * 5));
          setActive(i); bus.setExplode(p, i);
        },
      });
    } else {
      bus.setExplode(1, -1);
    }
    layerBtns.forEach((b, i) => b.addEventListener('click', () => {
      if (explodeST) {
        const y = explodeST.start + ((i + 0.6) / 5) * (explodeST.end - explodeST.start);
        lenis ? lenis.scrollTo(y, { duration: 1 }) : window.scrollTo({ top: y });
      } else {
        setActive(i); bus.setExplode(1, i);
      }
    }));

    /* System flow: a signal travels along the line and lights each step. */
    const steps = $$('#steps .step');
    if (motion) {
      gsap.timeline({ scrollTrigger: { trigger: '#flow', start: 'top 70%', end: 'center 45%', scrub: 0.6 } })
        .fromTo('#flow-trace', { scaleX: 0 }, { scaleX: 1, ease: 'none', duration: 1,
          onUpdate() { const p = this.progress(); steps.forEach((s, i) => s.classList.toggle('lit', p >= i / 3 - 0.02)); } });
    } else {
      steps.forEach((s) => s.classList.add('lit'));
    }

    return () => {
      if (lenis) { lenis.destroy(); lenis = null; }
      $('#inside').classList.remove('is-scrub');
      steps.forEach((s) => s.classList.remove('lit'));
    };
  });

  document.fonts && document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
