/*
	Sell this Banana: game engine (sell-this-banana.html).
	All player-facing text comes from <script type="application/json" id="stb-content">; the art from
	sell-this-banana-art.js (window.STBArt) and the music from sell-this-banana-sound.js (window.STBSound).
	The game keeps its state in memory only and stores nothing in the browser.

	Levels are listed in the JSON ("levels"). Each has a type with its own runner:
	- "kiosk" (Level 1): customers are small trees of nodes; each choice carries its ripeness cost, trust change,
	  the sale steps it lights, a flag and where it goes (next node, or an outcome: sale, door, leave, fail).
	- "discovery" (Level 2): a question menu that reveals need cards (follow-ups unlock after answers), then a pitch
	  built in three picks: the need, the feature that answers it, and how to say it.
	Every level ends the same way: win card, "Back at the office" (steps: one choice, or pick several), fact card, end.
*/
(function () {
	'use strict';
	var root = document.getElementById('stb');
	var dataEl = document.getElementById('stb-content');
	var ART = window.STBArt;
	var SND = window.STBSound || { isOn: function () { return false; }, setOn: function () { return false; }, setTrack: function () {}, sfx: function () {} };
	if (!root || !dataEl || !ART) return;
	var T;
	try { T = JSON.parse(dataEl.textContent); } catch (e) { return; }
	var U = T.ui, LEVELS = T.levels, LV = LEVELS[0];
	var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

	var canvas = document.getElementById('stb-canvas');
	var g = canvas.getContext('2d');
	var frameEl = root.querySelector('.stb-frame');
	var hudEl = document.getElementById('stb-hud');
	var boxEl = document.getElementById('stb-box');
	var liveEl = document.getElementById('stb-announce');

	/* ---------- Layout (canvas pixels) ---------- */
	var GEO = {
		beach: { lane: 150, entry: -26, exit: 340, counter: 138, coco: 74, sellerX: 182, sellerY: 116 },
		gym: { lane: 152, entry: -26, exit: 340, machine: 76, talk: 148, sellerX: 204, sellerY: 111, tableX: 176, tableY: 116, bunchX: 182, top: 130 }
	};
	var STEPS = ['need', 'offer', 'price', 'ask'];
	/* The office is only scenery for the email, so it is shown as a shorter strip: same pixel scale, less height. */
	var OFFICE_TOP = 10, OFFICE_H = 120;

	/* ---------- State ---------- */
	var S = null, found = {}, losses = {}, best = {}, mode = 'title', scene = 'title', actors = [], emote = null, sellerMood = 'stand', timers = [];
	var waveF = 0, waveT = 0, inView = true, running = false, lastTs = 0, acted = false;

	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
	function say(s) { s = String(s || ''); return s.charAt(0) === '(' ? '<i>' + md(s) + '</i>' : md(s); }
	function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
	function announce(t) { liveEl.textContent = ''; setTimeout(function () { liveEl.textContent = t; }, 40); }
	function later(fn, ms) { if (reduceMotion) fn(); else timers.push(setTimeout(fn, ms)); }
	function clearTimers() { timers.forEach(clearTimeout); timers = []; }
	function btn(act, label, cls, i) { return '<button type="button" class="stb-btn' + (cls ? ' ' + cls : '') + '" data-act="' + act + '"' + (i != null ? ' data-i="' + i + '"' : '') + '>' + esc(label) + '</button>'; }
	function actions(html) { return '<div class="stb-actions">' + html + '</div>'; }
	function meters() { return fmt(U.meters, { r: S.ripe, rmax: LV.ripeness, t: S.trust, tmax: LV.trustMax }); }
	function trustTo(v) { S.trust = Math.max(0, Math.min(LV.trustMax, v)); }
	function costRipe(n) { S.ripe = Math.max(0, S.ripe - n); }
	function countTrue(o) { var n = 0; for (var k in o) if (o[k]) n++; return n; }
	function failIds(lv) { return Object.keys(lv.fails); }
	function foundIn(lv) { return failIds(lv).filter(function (id) { return found[lv.id + ':' + id]; }).length; }
	function totalFound() { return LEVELS.reduce(function (n, lv) { return n + foundIn(lv); }, 0); }
	function totalFails() { return LEVELS.reduce(function (n, lv) { return n + failIds(lv).length; }, 0); }

	/* ---------- Actors ---------- */
	function sp(kind) { return ART.people[kind]; }
	function geo() { return GEO[scene === 'gym' ? 'gym' : 'beach']; }
	function makeActor(kind, x, opts) {
		var a = { kind: kind, x: x, y: geo().lane - sp(kind).h, dir: 1, tx: null, speed: 44, frame: 0, ft: 0, bob: 0, mood: 'stand', held: null, z: 0, cb: null, gone: false };
		for (var k in opts || {}) a[k] = opts[k];
		actors.push(a);
		return a;
	}
	function moveTo(a, tx, cb, gone, face) {
		a.tx = tx; a.cb = cb || null; a.goneAfter = !!gone; a.face = face || 0;
		if (tx !== a.x) a.dir = tx > a.x ? 1 : -1;
		if (reduceMotion || !inView || document.hidden) { a.x = tx; arrive(a); }
		kick();
	}
	/* When the scene is off screen nobody is watching, so walks finish at once and the dialogue never waits on a paused animation. */
	function snapAll() { actors.forEach(function (a) { if (a.tx != null) { a.x = a.tx; arrive(a); } }); actors = actors.filter(function (a) { return !a.gone; }); }
	function arrive(a) {
		a.tx = null; a.frame = 0; a.bob = 0;
		if (a.goneAfter) a.gone = true;
		if (a.face) a.dir = a.face;
		var cb = a.cb; a.cb = null;
		if (cb) setTimeout(cb, 0);
	}
	function update(dt) {
		var moving = false;
		for (var i = 0; i < actors.length; i++) {
			var a = actors[i];
			if (a.tx == null) continue;
			moving = true;
			var step = a.speed * dt, dx = a.tx - a.x;
			if (Math.abs(dx) <= step) { a.x = a.tx; arrive(a); continue; }
			a.x += dx > 0 ? step : -step;
			a.ft += dt;
			if (a.ft > (a.jog ? 0.1 : 0.16)) { a.ft = 0; a.frame ^= 1; }
			a.bob = a.jog && a.frame ? -1 : 0;
		}
		actors = actors.filter(function (a) { return !a.gone; });
		return moving;
	}

	/* ---------- Drawing ---------- */
	function bunchState() { var r = S ? S.ripe : LV.ripeness; return r <= 0 ? 3 : r <= 3 ? 2 : r <= 6 ? 1 : 0; }
	function drawActor(a) {
		var s = sp(a.kind), left = a.dir < 0, walking = a.tx != null;
		var img = walking ? (left ? s.walkL : s.walk)[a.frame] : (a.mood === 'smile' ? (left ? s.smileL : s.smile) : (left ? s.standL : s.stand));
		var x = Math.round(a.x), y = Math.round(a.y + a.bob);
		if (a.kind === 'surfer') g.drawImage(left ? ART.boardL : ART.board, left ? x + s.w - 7 : x - 2, y - 6);
		g.drawImage(img, x, y);
		if (a.held) {
			var it = (left ? ART.itemsL : ART.items)[a.held];
			g.drawImage(it, left ? x + s.w - s.hand.x - it.width : x + s.hand.x, y + s.hand.y - it.height);
		}
	}
	function draw(t) {
		g.imageSmoothingEnabled = false;
		if (scene === 'office') { g.drawImage(ART.office, 0, -OFFICE_TOP); return; }
		var s = sp('seller'), seller = sellerMood === 'smile' ? s.smileL : s.standL, b = ART.bunch[scene === 'title' ? 0 : bunchState()];
		if (scene === 'gym') {
			var G = GEO.gym;
			g.drawImage(ART.gym, 0, 0);
			g.drawImage(seller, G.sellerX, G.sellerY);
			g.drawImage(ART.gymTable, G.tableX, G.tableY);
			g.drawImage(b, G.bunchX, G.top - b.height);
		} else {
			var B = GEO.beach;
			g.drawImage(ART.beach, 0, 0);
			ART.drawWaves(g, waveF);
			g.drawImage(ART.coconutStand, 6, 100);
			g.drawImage(ART.kioskBack, 159, 73);
			g.drawImage(seller, B.sellerX, B.sellerY);
			g.drawImage(ART.kioskFront, 159, 73);
			g.drawImage(b, 163, 136 - b.height);
		}
		var list = actors.slice().sort(function (p, q) { return p.z - q.z; });
		for (var i = 0; i < list.length; i++) drawActor(list[i]);
		if (emote && emote.a && !emote.a.gone && emote.a.tx == null) {
			var bub = ART.bubbles[emote.k];
			if (bub) g.drawImage(bub, Math.round(emote.a.x) + (emote.a.dir < 0 ? -4 : 11), Math.round(emote.a.y) - 12);
		}
		if (scene === 'title') ART.drawTitle(g, reduceMotion ? 0 : t);
		else if (mode === 'end') ART.drawEnd(g, LV.number, S && S.skipped, scene === 'gym');
		else if (mode === 'win') ART.drawBanner(g, U.canvasWin, scene === 'gym');
		else if (mode === 'howto') ART.drawBanner(g, 'LEVEL ' + LV.number, scene === 'gym');
	}
	function frame(ts) {
		running = false;
		var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
		lastTs = ts;
		var moving = update(dt);
		if (!reduceMotion) { waveT += dt; if (waveT > 0.4) { waveT = 0; waveF++; } }
		draw(ts / 1000);
		if (inView && !document.hidden && (!reduceMotion || moving)) { running = true; requestAnimationFrame(frame); }
		else lastTs = 0;
	}
	function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
	function label() {
		var c = U.canvas, t;
		if (scene === 'title') t = c.title;
		else if (scene === 'office') t = c.office;
		else if (mode === 'end') t = fmt(c.end, { n: LV.number });
		else if (scene === 'gym') t = fmt(c.gym, { state: c.ripe[bunchState()] });
		else t = fmt(c.beach, { who: S && S.c && S.lead && !S.lead.gone && S.lead.tx == null ? S.c.name : c.nobody, state: c.ripe[bunchState()] });
		canvas.setAttribute('aria-label', t);
	}
	/* The scene scales to fit the frame's width and about 42% of the window's height, so the dialogue below it fits on
	   screen too. Steps are whole device pixels (1x, 1.5x, 2x… on a Retina screen), which keeps every pixel square.
	   Narrow screens (phones) fill the width instead. The frame itself is as wide as the column (CSS caps it). */
	function fit() {
		var cs = window.getComputedStyle(frameEl);
		var innerW = frameEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		var dpr = window.devicePixelRatio || 1;
		var byW = innerW / ART.W, byH = (window.innerHeight * 0.42) / ART.H;
		if (byW <= byH && byW < 2) { canvas.style.width = '100%'; return; }
		var s = Math.max(1, Math.floor(Math.min(byW, byH) * dpr)) / dpr;
		canvas.style.width = (ART.W * s) + 'px';
	}
	function setScene(name) {
		scene = name;
		SND.setTrack(name === 'office' ? 'office' : name === 'gym' ? 'gym' : 'beach');
		var h = name === 'office' ? OFFICE_H : ART.H;
		if (canvas.height !== h) canvas.height = h;
	}

	/* ---------- HUD and the box below the scene ---------- */
	/* The HUD keeps its space on the title screen (hidden) and collapses on the office and end screens. */
	function hudMode(m) { root.classList.toggle('is-away', m === 'hide'); root.classList.toggle('is-off', m === 'none'); }
	function hud() {
		var ripe = S ? S.ripe : LV.ripeness, trust = S ? S.trust : LV.trustStart;
		var h = '<div class="stb-meter"><span class="stb-label">' + esc(U.ripeness) + '</span><img class="stb-icon" src="' + ART.icons.banana[bunchState()] + '" alt=""><span class="stb-num"><b>' + ripe + '</b>/' + LV.ripeness + '</span></div>';
		h += '<div class="stb-meter"><span class="stb-label">' + esc(U.trust) + '</span><span class="stb-hearts">';
		for (var i = 0; i < LV.trustMax; i++) h += '<img src="' + (i < trust ? ART.icons.heartOn : ART.icons.heartOff) + '" alt="">';
		h += '</span><span class="stb-num"><b>' + trust + '</b>/' + LV.trustMax + '</span></div>';
		hudEl.innerHTML = h + RUN[LV.type].hud();
	}
	function setBox(html, focusSel) {
		var had = root.contains(document.activeElement) && document.activeElement !== document.body;
		boxEl.innerHTML = html;
		if (had) {
			var f = (focusSel && boxEl.querySelector(focusSel + ':not([disabled])')) || boxEl.querySelector('button:not([disabled])') || boxEl;
			try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
		}
		reveal();
	}
	/* Once the player is playing, new content that ends below the window is scrolled into view: just far enough to show the
	   bottom of the frame, never past the top of the box, and only while the game is on screen (no pulling back from the notes). */
	function reveal() {
		if (!acted) return;
		var vh = window.innerHeight || document.documentElement.clientHeight, f = frameEl.getBoundingClientRect();
		if (f.bottom <= 0 || f.top >= vh) return;
		var b = boxEl.getBoundingClientRect(), m = 12, dy = Math.min(f.bottom + m - vh, b.top - m);
		if (dy <= 0) return;
		try { window.scrollBy({ top: dy, behavior: reduceMotion ? 'auto' : 'smooth' }); } catch (e) { window.scrollBy(0, dy); }
	}
	function ratingHtml(r) {
		var h = '<p class="stb-rating" role="img" aria-label="' + esc(fmt(U.ratingLabel, { n: r })) + '">';
		for (var i = 0; i < 3; i++) h += '<img src="' + (i < r ? ART.icons.ratingOn : ART.icons.ratingOff) + '" alt="">';
		return h + '</p>';
	}
	function talk() {
		var h = '<div class="stb-talk">';
		if (S.you) h += '<p class="stb-line stb-you"><span class="stb-who">' + esc(U.you) + '</span><span>' + md(S.you) + '</span></p>';
		if (S.them) h += '<p class="stb-line"><span class="stb-who">' + esc(S.c.name) + '</span><span>' + say(S.them) + '</span></p>';
		return h + '</div>';
	}
	function prompt(text) { return '<p class="stb-q"><b>' + md(text) + '</b></p>'; }
	function choicesHtml(list, act, state, cls) {
		var h = '<ol class="stb-choices' + (cls ? ' ' + cls : '') + '" aria-label="' + esc(U.yourReply) + '">';
		list.forEach(function (ch, i) {
			var st = state ? state(ch, i) : { cls: '', off: false };
			h += '<li><button type="button" class="stb-choice' + st.cls + '" data-act="' + act + '" data-i="' + i + '"' + (st.id ? ' data-id="' + esc(st.id) + '"' : '') + (st.off ? ' disabled' : '') + '><span class="stb-key" aria-hidden="true">' + (i + 1) + '</span><span class="stb-choice-text">' + (st.tag ? '<span class="stb-tag">' + esc(st.tag) + '</span> ' : '') + md(ch.text) + '</span></button></li>';
		});
		return h + '</ol>';
	}

	/* ---------- Shared screens ---------- */
	function goTitle() {
		clearTimers();
		mode = 'title'; S = null; actors = []; emote = null; sellerMood = 'stand';
		setScene('title'); hudMode('hide'); hud();
		var h = '<p class="stb-kicker">' + esc(U.chooseLevel) + '</p><p>' + md(T.intro) + '</p>';
		h += choicesHtml(LEVELS.map(function (lv) { return { text: '**' + lv.name + '** · ' + lv.tagline }; }), 'level', function (ch, i) {
			var r = best[LEVELS[i].id];
			return { cls: '', off: false, tag: r ? fmt(U.levelBest, { n: r }) : '' };
		});
		setBox(h + '<p class="stb-small">' + md(U.comingSoon) + '</p>');
		label(); kick();
	}
	function selectLevel(i) {
		if (!LEVELS[i]) return;
		clearTimers();
		LV = LEVELS[i]; S = null; mode = 'howto'; actors = []; emote = null; sellerMood = 'stand';
		setScene(LV.scene); hudMode('show'); hud();
		var h = '<p class="stb-kicker">' + esc(LV.kicker) + '</p><p>' + md(LV.intro) + '</p><h3>' + esc(LV.howtoTitle) + '</h3><ul class="stb-list">';
		LV.howto.forEach(function (x) { h += '<li>' + md(x) + '</li>'; });
		setBox(h + '</ul>' + actions(btn('open', LV.openLabel)));
		label(); kick();
	}
	function startLevel() { clearTimers(); RUN[LV.type].start(); }
	function viewOutcome() { setBox(talk() + actions(btn('after', U.continue))); }
	function after() {
		if (!S || !S.out) return;
		if (S.out.type === 'fail') return fail(S.out);
		RUN[LV.type].after();
	}
	function fail(out) {
		mode = 'fail';
		var key = LV.id + ':' + out.fail;
		out.isNew = !found[key]; found[key] = true; losses[LV.id] = (losses[LV.id] || 0) + 1;
		SND.sfx('fail');
		S.out = out; hud(); label(); kick();
		var f = LV.fails[out.fail];
		var h = '<div class="stb-fail"><p class="stb-kicker">' + esc(out.isNew ? U.newFail : U.oldFail) + '</p><h3>' + esc(f.title) + '</h3><dl class="stb-dl">';
		h += '<dt>' + esc(U.whatHappened) + '</dt><dd>' + md(out.note || f.what) + '</dd>';
		h += '<dt>' + esc(U.why) + '</dt><dd>' + md(f.why) + '</dd>';
		h += '<dt>' + esc(U.tryThis) + '</dt><dd>' + md(f.try) + '</dd></dl>';
		h += '<p class="stb-small">' + esc(fmt(U.failsLevel, { n: foundIn(LV), total: failIds(LV).length })) + '</p>';
		setBox(h + actions(btn('retry', U.retry) + (losses[LV.id] >= 2 ? btn('skip', U.skip, 'stb-btn-ghost') : '')) + '</div>');
		announce(f.title);
	}
	function finish() {
		var r = RUN[LV.type].result();
		if (r.fail) return fail(r.fail);
		mode = 'win'; S.rating = r.rating;
		best[LV.id] = Math.max(best[LV.id] || 0, r.rating);
		sellerMood = 'smile'; SND.sfx('right');
		hud(); label(); kick();
		var C = LV.win.checks, h = '<p class="stb-kicker">' + esc(fmt(U.levelCleared, { n: LV.number })) + '</p><h3>' + esc(LV.win.title) + '</h3>' + ratingHtml(S.rating) + '<ul class="stb-checks">';
		r.checks.forEach(function (c) {
			h += '<li class="' + (c[1] ? 'is-yes' : 'is-no') + '"><span class="stb-sr">' + esc(c[1] ? U.yes : U.no) + ': </span>' + esc(C[c[0]]) + '</li>';
		});
		setBox(h + '</ul><p>' + md(LV.win.text) + '</p>' + actions(btn('office', U.toOffice)));
		announce(LV.win.title + ' ' + fmt(U.ratingLabel, { n: S.rating }));
	}

	/* ---------- Back at the office: a list of steps ("single": one right answer; "multi": pick several) ---------- */
	function freshOffice(step) { return { step: step || 0, picked: {}, last: null, done: false, sel: {}, locked: {}, wrong: {}, checks: 0 }; }
	function goOffice() {
		clearTimers();
		mode = 'office'; actors = []; emote = null;
		setScene('office'); hudMode('none');
		S.office = freshOffice();
		viewOffice(); label(); kick();
		announce(LV.office.kicker);
	}
	function noteHtml(title, lines, cls) {
		return '<div class="stb-mail' + (cls ? ' ' + cls : '') + '"><p class="stb-mail-head">' + title + '</p><p>' + lines.map(md).join('<br>') + '</p></div>';
	}
	function viewOffice(focusSel) {
		var O = LV.office, st = S.office, step = O.steps[st.step], last = st.step === O.steps.length - 1;
		var h = '<p class="stb-kicker">' + esc(O.kicker) + (O.steps.length > 1 ? ' · ' + esc(fmt(U.stepOf, { n: st.step + 1, total: O.steps.length })) : '') + '</p>';
		if (st.step === 0 && O.intro) h += '<p>' + md(O.intro) + '</p>';
		if (step.mail) h += noteHtml('<span><b>' + esc(U.from) + '</b> ' + esc(step.mail.from) + '</span> <span><b>' + esc(U.subject) + '</b> ' + esc(step.mail.subject) + '</span>', step.mail.body);
		if (step.note) h += noteHtml('<span><b>' + esc(step.note.title) + '</b></span>', step.note.lines, 'stb-note');
		if (step.lead) h += '<p>' + md(step.lead) + '</p>';
		h += prompt(step.question);
		if (step.type === 'multi') {
			h += '<ol class="stb-choices is-grid stb-multi" aria-label="' + esc(step.question) + '">';
			step.options.forEach(function (op, i) {
				var lock = st.locked[i], wrong = st.wrong[i], sel = st.sel[i];
				var cls = lock ? ' is-right' : wrong ? ' is-picked' : sel ? ' is-selected' : '';
				h += '<li><button type="button" class="stb-choice' + cls + '" data-act="toggle" data-i="' + i + '" aria-pressed="' + (lock || sel ? 'true' : 'false') + '"' + (lock || wrong || st.done ? ' disabled' : '') + '><span class="stb-key" aria-hidden="true">' + (i + 1) + '</span><span class="stb-choice-text">' + md(op.text) + '</span></button>';
				if (lock || wrong) h += '<p class="stb-fb' + (lock ? ' is-right' : '') + '"><span class="stb-sr">' + esc(lock ? U.yes : U.no) + ': </span>' + md(op.feedback) + '</p>';
				h += '</li>';
			});
			h += '</ol>';
			if (!st.done) {
				var n = countTrue(st.sel) + countTrue(st.locked);
				if (st.checks) h += '<p class="stb-small">' + esc(fmt(U.multiRetry, { n: countTrue(st.locked), pick: step.pick })) + '</p>';
				h += actions('<button type="button" class="stb-btn" data-act="check"' + (n === step.pick ? '' : ' disabled') + '>' + esc(fmt(step.checkLabel, { n: n, pick: step.pick })) + '</button>');
			}
		} else {
			h += choicesHtml(step.options, 'reply', function (op, i) {
				var picked = !!st.picked[i];
				return { cls: picked ? (op.right ? ' is-right' : ' is-picked') : '', off: st.done || picked };
			});
			if (st.last != null) {
				var op = step.options[st.last];
				h += '<div class="stb-feedback' + (op.right ? ' is-right' : '') + '"><p><b>' + esc(op.right ? U.goodReply : U.notQuite) + '</b> ' + md(op.feedback) + '</p></div>';
			}
		}
		if (st.done) {
			if (step.answer) h += '<div class="stb-feedback is-right"><p>' + say(step.answer) + '</p></div>';
			if (last && O.chain) {
				h += '<div class="stb-chain">' + O.chain.map(function (c) { return '<span class="stb-chain-item"><span class="stb-label">' + esc(c.label) + '</span>' + md(c.text) + '</span>'; }).join('<span class="stb-chain-arrow" aria-hidden="true">&#8594;</span>') + '</div>';
			}
			h += actions(btn(last ? 'fact' : 'onext', U.continue));
		}
		setBox(h, focusSel);
	}
	function reply(i) {
		var st = S.office, step = LV.office.steps[st.step], op = step.options[i];
		if (!op || st.done || step.type === 'multi') return;
		st.picked[i] = true; st.last = i;
		if (op.right) st.done = true;
		SND.sfx(op.right ? 'right' : 'wrong');
		viewOffice();
		announce((op.right ? U.goodReply : U.notQuite) + ' ' + op.feedback);
	}
	function toggle(i) {
		var st = S.office, step = LV.office.steps[st.step];
		if (step.type !== 'multi' || st.done || st.locked[i] || st.wrong[i] || !step.options[i]) return;
		if (st.sel[i]) st.sel[i] = false;
		else if (countTrue(st.sel) + countTrue(st.locked) < step.pick) st.sel[i] = true;
		SND.sfx('pick');
		viewOffice('[data-act="toggle"][data-i="' + i + '"]');
	}
	function check() {
		var st = S.office, step = LV.office.steps[st.step];
		if (step.type !== 'multi' || st.done) return;
		var wrongNow = 0;
		Object.keys(st.sel).forEach(function (k) { if (!st.sel[k]) return; if (step.options[k].right) st.locked[k] = true; else { st.wrong[k] = true; wrongNow++; } });
		st.sel = {}; st.checks++;
		if (countTrue(st.locked) === step.pick) st.done = true;
		SND.sfx(st.done ? 'right' : 'wrong');
		viewOffice();
		announce(st.done ? say(step.answer).replace(/<[^>]+>/g, '') : fmt(U.multiRetry, { n: countTrue(st.locked), pick: step.pick }));
	}
	function nextStep() { var n = S.office.step + 1; S.office = freshOffice(n); viewOffice(); }
	function viewFact() {
		var F = LV.fact, h = '<div class="stb-fact"><p class="stb-kicker">' + esc(F.kicker) + '</p><h3>' + esc(F.title) + '</h3><dl class="stb-dl">';
		F.rows.forEach(function (r) { h += '<dt>' + esc(r[0]) + '</dt><dd>' + md(r[1]) + '</dd>'; });
		h += '</dl><p class="stb-small">' + md(F.note) + '</p></div>';
		h += '<div class="stb-rule"><p class="stb-kicker">' + esc(LV.rule.kicker) + '</p><p class="stb-rule-text">' + md(LV.rule.text) + '</p></div>';
		setBox(h + actions(btn('end', U.continue)));
	}
	function goEnd() {
		clearTimers();
		mode = 'end'; actors = []; emote = null; sellerMood = 'smile';
		setScene(LV.scene); hudMode('none');
		if (!S.skipped) RUN[LV.type].crowd();
		var E = LV.end, idx = LEVELS.indexOf(LV), next = LEVELS[idx + 1];
		var h = '<p class="stb-kicker">' + esc(LV.kicker) + '</p><h3>' + esc(S.skipped ? E.titleSkipped : E.title) + '</h3>';
		if (!S.skipped) h += ratingHtml(S.rating);
		h += '<p>' + md(E.text) + '</p><h4>' + esc(fmt(U.failsLevel, { n: foundIn(LV), total: failIds(LV).length })) + '</h4><ul class="stb-fails">';
		failIds(LV).forEach(function (id) { var on = found[LV.id + ':' + id]; h += '<li' + (on ? ' class="is-found"' : '') + '>' + esc(on ? LV.fails[id].title : U.locked) + '</li>'; });
		h += '</ul><p class="stb-small">' + esc(fmt(U.failsTotal, { n: totalFound(), total: totalFails() })) + ' ' + md(E.fullGame) + '</p>';
		if (!next && E.next) h += '<p class="stb-next">' + md(E.next) + '</p>';
		h += actions((next ? btn('next', fmt(U.playLevel, { n: next.number })) : '') + btn('again', fmt(U.again, { n: LV.number }), next ? 'stb-btn-ghost' : '') + btn('select', U.chooseLevel, 'stb-btn-ghost'));
		setBox(h); label(); kick();
		announce(S.skipped ? E.titleSkipped : E.title);
	}

	/* ---------- Level type "kiosk" (Level 1) ---------- */
	function cust(id) { for (var i = 0; i < LV.customers.length; i++) if (LV.customers[i].id === id) return LV.customers[i]; return null; }
	function light(list) { (list || []).forEach(function (s) { S.steps[s] = true; }); }
	function kStart() {
		S = { ripe: LV.ripeness, queue: LV.order.slice(), idx: -1, c: null, nodeId: null, lead: null, group: [], trust: LV.trustStart, steps: {}, flags: {}, sold: {}, you: null, them: null, out: null, rating: 0, skipped: false, office: freshOffice() };
		mode = 'play'; setScene('beach'); actors = []; emote = null; sellerMood = 'stand';
		hudMode('show');
		kNext();
	}
	function kNext() {
		S.idx++; S.out = null; emote = null; sellerMood = 'stand';
		var id = S.queue[S.idx];
		if (!id) return finish();
		if (S.ripe <= 0) return fail({ fail: 'historian', note: LV.fails.historian.brown });
		S.c = cust(id); S.trust = LV.trustStart; S.steps = {}; S.you = null; S.them = null; S.nodeId = null;
		hud(); setBox('<p class="stb-wait">' + esc(LV.arriving) + '</p>');
		var B = GEO.beach, c = S.c, lead = makeActor(c.art, B.entry, { z: 3, jog: !!c.jog, speed: c.jog ? 64 : 44 });
		S.lead = lead; S.group = [lead];
		if (c.kids) {
			var k1 = makeActor('kid1', B.entry - 16, { z: 2 }), k2 = makeActor('kid2', B.entry - 30, { z: 1 });
			S.group.push(k1, k2);
			moveTo(k1, B.counter - 14); moveTo(k2, B.counter - 27);
		}
		label();
		moveTo(lead, B.counter, function () { if (S && S.lead === lead) kEnter(c.start || 'start'); });
	}
	function kEnter(id) {
		S.nodeId = id; S.out = null;
		var n = S.c.nodes[id];
		light(n.lights);
		S.them = n.say;
		emote = n.emote ? { a: S.lead, k: n.emote } : null;
		hud(); setBox(talk() + choicesHtml(n.choices, 'choose')); label(); kick();
		announce(S.c.name + ': ' + n.say + ' ' + meters());
	}
	function kChoose(i) {
		if (!S || mode !== 'play' || LV.type !== 'kiosk' || !S.nodeId || S.out) return;
		var ch = S.c.nodes[S.nodeId].choices[i];
		if (!ch) return;
		costRipe(ch.cost == null ? 1 : ch.cost);
		trustTo(S.trust + (ch.trust || 0));
		light(ch.lights);
		if (ch.flag) S.flags[ch.flag] = true;
		S.you = ch.text;
		SND.sfx('pick');
		var out = null;
		if (ch.fail) out = { type: 'fail', fail: ch.fail, reply: ch.reply, note: ch.note };
		else if (S.trust <= 0) out = { type: 'fail', fail: 'hardsell', reply: ch.reply || LV.fails.hardsell.reply, note: ch.note || LV.fails.hardsell.what };
		else if (ch.outcome) out = { type: ch.outcome, reply: ch.reply };
		else if (S.ripe <= 0) out = { type: 'fail', fail: 'historian', reply: LV.fails.historian.brownReply, note: LV.fails.historian.brown };
		if (out) kResolve(out); else kEnter(ch.next);
	}
	function kResolve(out) {
		S.out = out; S.them = out.reply;
		var B = GEO.beach, grp = S.group.slice(), lead = S.lead;
		if (out.type === 'sale') {
			S.sold[S.c.id] = true; sellerMood = 'smile'; SND.sfx('sale');
			emote = { a: lead, k: 'heart' };
			grp.forEach(function (a) { a.mood = 'smile'; a.held = 'banana'; });
			later(function () { if (emote && emote.a === lead) emote = null; grp.forEach(function (a, k) { moveTo(a, B.exit + k * 16, null, true); }); }, 900);
		} else if (out.type === 'door') {
			S.queue.push(LV.returner); SND.sfx('door');
			emote = { a: lead, k: '!' };
			later(function () { if (emote && emote.a === lead) emote = null; moveTo(lead, B.exit, null, true); }, 700);
		} else if (out.type === 'leave') {
			emote = { a: lead, k: 'dots' };
			later(function () { if (emote && emote.a === lead) emote = null; grp.forEach(function (a) { moveTo(a, B.entry - 40, null, true); }); }, 700);
		} else {
			var f = LV.fails[out.fail];
			emote = { a: lead, k: out.fail === 'hardsell' ? 'vein' : 'dots' };
			later(function () {
				if (emote && emote.a === lead) emote = null;
				if (f.exit === 'coconut') grp.forEach(function (a, k) { moveTo(a, B.coco - k * 13, function () { a.held = 'coconut'; a.mood = 'smile'; kick(); }, false, -1); });
				else grp.forEach(function (a) { moveTo(a, B.entry - 40, null, true); });
			}, 900);
		}
		hud(); viewOutcome(); label(); kick();
		announce(S.c.name + ': ' + out.reply + ' ' + meters());
	}
	function kHud() {
		var steps = S ? S.steps : {}, n = S && S.c ? LV.order.indexOf(S.c.id) : 0;
		var h = '<div class="stb-meter"><span class="stb-label">' + esc(n >= 0 ? fmt(U.customer, { n: n + 1, total: LV.order.length }) : U.bonus) + '</span></div>';
		h += '<ol class="stb-steps" aria-label="' + esc(U.stepsLabel) + '">';
		STEPS.forEach(function (s) { var on = !!steps[s]; h += '<li' + (on ? ' class="is-on"' : '') + '>' + esc(U.steps[s]) + (on ? '<span class="stb-sr"> (' + esc(U.done) + ')</span>' : '') + '</li>'; });
		return h + '</ol>';
	}
	function kResult() {
		if (!S.sold.surfer || !S.sold.parent) return { fail: { fail: 'forgot', note: LV.fails.forgot.what } };
		var lecture = !!S.flags.lecture;
		return { rating: 1 + (lecture ? 0 : 1) + (!lecture && S.sold.joggerBack ? 1 : 0), checks: [['sales', true], ['nolecture', !lecture], ['jogger', !!S.sold.joggerBack]] };
	}
	function kCrowd() {
		var crowd = [['surfer', 74], ['kid2', 96], ['kid1', 108], ['parent', 121]];
		if (S.sold.joggerBack) crowd.push(['jogger', 140]);
		crowd.forEach(function (c, k) { makeActor(c[0], c[1], { mood: 'smile', held: 'banana', z: k }); });
	}

	/* ---------- Level type "discovery" (Level 2) ---------- */
	function dq(id) { for (var i = 0; i < LV.questions.length; i++) if (LV.questions[i].id === id) return LV.questions[i]; return null; }
	function dAvailable() {
		var open = LV.questions.filter(function (x) { return !S.asked[x.id] && (!x.followup || S.unlocked[x.id]); });
		return open.filter(function (x) { return x.followup; }).concat(open.filter(function (x) { return !x.followup; }));
	}
	function dNeeds() { return S.cards.filter(function (c) { return LV.cards[c].kind !== 'context'; }); }
	function dStart() {
		var G = GEO.gym;
		S = { ripe: LV.ripeness, trust: LV.trustStart, c: LV.member, lead: null, group: [], asked: {}, nAsked: 0, unlocked: {}, cards: [], realAt: 0, leading: false, engaged: false, phase: 'arrive', need: null, misses: 0, tried: {}, lineTried: {}, you: null, them: null, out: null, rating: 0, realSale: false, skipped: false, office: freshOffice() };
		mode = 'play'; setScene('gym'); actors = []; emote = null; sellerMood = 'stand';
		hudMode('show'); hud();
		setBox('<p class="stb-wait">' + esc(LV.arriving) + '</p>');
		var m = makeActor(LV.member.art, G.entry, { z: 2 });
		S.lead = m; S.group = [m];
		label();
		moveTo(m, G.machine, function () {
			if (!S || S.lead !== m) return;
			S.phase = 'ask'; S.them = LV.opening; emote = { a: m, k: '?' };
			dViewAsk(); label(); kick();
			announce(LV.opening + ' ' + meters());
		}, false, -1);
	}
	function dViewAsk() {
		var h = talk() + prompt(U.askPrompt);
		h += choicesHtml(dAvailable(), 'ask', function (x) { return { cls: '', off: false, id: x.id, tag: x.followup ? U.followup : '' }; }, 'is-grid');
		setBox(h + actions(btn('pitch', U.pitch, 'stb-btn-ghost')));
	}
	function dCheck() {
		if (S.trust <= 0) return { type: 'fail', fail: 'just', reply: LV.fails.just.trustReply, note: LV.fails.just.trustNote };
		if (S.ripe <= 0) return { type: 'fail', fail: 'interrogation', reply: LV.fails.interrogation.brownReply, note: fmt(LV.fails.interrogation.brown, { n: S.nAsked }) };
		return null;
	}
	function dAsk(id) {
		if (!S || mode !== 'play' || LV.type !== 'discovery' || S.phase !== 'ask' || S.out) return;
		var x = dq(id);
		if (!x || S.asked[id]) return;
		SND.sfx('pick');
		S.asked[id] = true; S.nAsked++;
		costRipe(1);
		if (x.trust) trustTo(S.trust + x.trust);
		if (x.kind === 'leading') S.leading = true;
		(x.unlocks || []).forEach(function (u) { S.unlocked[u] = true; });
		var card = x.card && S.cards.indexOf(x.card) < 0 ? x.card : null;
		if (card) { S.cards.push(card); if (LV.cards[card].real && !S.realAt) S.realAt = S.nAsked; }
		S.you = x.text;
		var em = card ? '!' : x.kind === 'leading' ? 'vein' : x.kind === 'offtopic' ? 'dots' : null;
		function show() {
			S.them = x.answer;
			var out = dCheck();
			if (out) return dResolve(out);
			emote = em ? { a: S.lead, k: em } : null;
			hud(); dViewAsk(); label(); kick();
			announce(LV.member.name + ': ' + x.answer + (card ? ' ' + fmt(U.newCard, { card: LV.cards[card].text }) : '') + ' ' + meters());
		}
		if (!S.engaged) {
			S.engaged = true; S.phase = 'walking'; S.them = LV.comesOver; emote = null;
			hud(); setBox(talk());
			var m = S.lead;
			moveTo(m, GEO.gym.talk, function () { if (!S || S.lead !== m) return; S.phase = 'ask'; show(); }, false, 1);
			return;
		}
		show();
	}
	function dPitch() {
		if (!S || S.phase !== 'ask' || S.out) return;
		SND.sfx('pick');
		if (!dNeeds().length) {
			costRipe(1); S.you = LV.pitchNoNeed;
			return dResolve({ type: 'fail', fail: 'just', reply: LV.fails.just.reply, note: LV.fails.just.what });
		}
		S.phase = 'need'; dViewNeed();
	}
	function dViewNeed() {
		S.phase = 'need';
		var h = talk() + prompt(U.pitchNeed) + choicesHtml(dNeeds().map(function (c) { return { text: LV.cards[c].text }; }), 'need');
		setBox(h + actions(dAvailable().length ? btn('back', U.backToQuestions, 'stb-btn-ghost') : ''));
	}
	function dPickNeed(i) {
		var c = dNeeds()[i];
		if (!c || S.phase !== 'need') return;
		S.need = c; S.tried = {}; S.phase = 'feature';
		dViewFeature();
	}
	function dViewFeature() {
		var list = LV.features.map(function (f) { return { text: f.label }; }).concat([{ text: LV.dump.label }]);
		var h = talk() + prompt(fmt(U.pitchFeature, { need: LV.cards[S.need].text }));
		h += choicesHtml(list, 'feature', function (ch, i) { return { cls: S.tried[i] ? ' is-picked' : '', off: !!S.tried[i] }; }, 'is-grid');
		setBox(h + actions(btn('needback', U.otherNeed, 'stb-btn-ghost')));
	}
	function dPickFeature(i) {
		if (!S || S.phase !== 'feature' || S.out || S.tried[i]) return;
		SND.sfx('pick');
		if (i === LV.features.length) {
			costRipe(1); S.you = LV.dump.text;
			return dResolve({ type: 'fail', fail: 'dump', reply: LV.dump.reply, note: LV.fails.dump.what });
		}
		var f = LV.features[i], p = LV.pitches[S.need];
		if (!f) return;
		if (p && p.feature === f.id) { S.phase = 'line'; S.lineTried = {}; return dViewLine(); }
		S.tried[i] = true; S.misses++;
		costRipe(1); trustTo(S.trust - 1);
		S.you = f.say; S.them = f.miss;
		var out = S.misses >= 2 ? { type: 'fail', fail: 'dump', reply: f.miss, note: LV.fails.dump.missNote } : dCheck();
		if (out) return dResolve(out);
		emote = { a: S.lead, k: 'dots' };
		hud(); dViewFeature(); kick();
		announce(LV.member.name + ': ' + f.miss + ' ' + meters());
	}
	function dViewLine() {
		var p = LV.pitches[S.need];
		var h = talk() + prompt(U.pitchLine) + choicesHtml(p.lines, 'line', function (ln, i) { return { cls: S.lineTried[i] ? ' is-picked' : '', off: !!S.lineTried[i] }; });
		setBox(h);
	}
	function dPickLine(i) {
		if (!S || S.phase !== 'line' || S.out) return;
		var p = LV.pitches[S.need], ln = p.lines[i];
		if (!ln || S.lineTried[i]) return;
		SND.sfx('pick');
		costRipe(1); S.you = ln.text;
		if (ln.right) {
			var real = !!LV.cards[S.need].real;
			S.realSale = real;
			S.rating = 1 + (real ? 1 : 0) + (real && S.realAt && S.realAt <= LV.quickLimit && !S.leading ? 1 : 0);
			return dResolve({ type: 'sale', reply: S.rating === 3 ? LV.thursday : p.reply });
		}
		S.lineTried[i] = true;
		trustTo(S.trust + (ln.trust || -1));
		S.them = ln.reply;
		var out = dCheck();
		if (out) return dResolve(out);
		emote = { a: S.lead, k: (ln.trust || -1) <= -2 ? 'vein' : 'dots' };
		hud(); dViewLine(); kick();
		announce(LV.member.name + ': ' + ln.reply + ' ' + meters());
	}
	function dResolve(out) {
		S.out = out; S.them = out.reply;
		var G = GEO.gym, m = S.lead;
		if (out.type === 'sale') {
			sellerMood = 'smile'; SND.sfx('sale');
			emote = { a: m, k: 'heart' }; m.mood = 'smile'; m.held = 'banana';
			later(function () { if (emote && emote.a === m) emote = null; moveTo(m, G.exit, null, true); }, 1100);
		} else {
			var f = LV.fails[out.fail];
			emote = { a: m, k: 'dots' };
			later(function () {
				if (emote && emote.a === m) emote = null;
				if (f.exit === 'machine') moveTo(m, G.machine, function () { m.held = 'bar'; kick(); }, false, -1);
				else moveTo(m, G.exit, null, true);
			}, 900);
		}
		hud(); viewOutcome(); label(); kick();
		announce(LV.member.name + ': ' + out.reply + ' ' + meters());
	}
	function dHud() {
		var cards = S ? S.cards : [];
		var h = '<div class="stb-meter"><span class="stb-label">' + esc(U.questions) + '</span><span class="stb-num"><b>' + (S ? S.nAsked : 0) + '</b></span></div>';
		h += '<div class="stb-needs"><span class="stb-label">' + esc(U.needs) + '</span>';
		if (!cards.length) h += '<span class="stb-none">' + esc(U.noneYet) + '</span>';
		cards.forEach(function (c) {
			var card = LV.cards[c];
			h += '<span class="stb-card' + (card.real ? ' is-real' : '') + (card.kind === 'context' ? ' is-context' : '') + '">' + esc(card.text) + (card.real ? '<span class="stb-sr"> (' + esc(U.realCard) + ')</span>' : '') + '</span>';
		});
		return h + '</div>';
	}
	function dResult() { return { rating: S.rating, checks: [['need', true], ['real', S.realSale], ['quick', S.rating === 3]] }; }
	function dCrowd() { makeActor(LV.member.art, 146, { mood: 'smile', held: 'banana' }); }

	var RUN = {
		kiosk: { start: kStart, after: kNext, hud: kHud, result: kResult, crowd: kCrowd },
		discovery: { start: dStart, after: finish, hud: dHud, result: dResult, crowd: dCrowd }
	};

	/* ---------- Input ---------- */
	boxEl.addEventListener('click', function (e) {
		if (e.detail > 1) return;
		acted = true;
		var b = e.target.closest ? e.target.closest('button[data-act]') : null;
		if (!b || b.disabled || !boxEl.contains(b)) return;
		var act = b.getAttribute('data-act'), i = +b.getAttribute('data-i');
		switch (act) {
			case 'level': selectLevel(i); break;
			case 'open': case 'retry': case 'again': startLevel(); break;
			case 'next': selectLevel(LEVELS.indexOf(LV) + 1); break;
			case 'select': goTitle(); break;
			case 'choose': kChoose(i); break;
			case 'ask': dAsk(b.getAttribute('data-id')); break;
			case 'pitch': dPitch(); break;
			case 'need': dPickNeed(i); break;
			case 'back': S.phase = 'ask'; dViewAsk(); break;
			case 'needback': dViewNeed(); break;
			case 'feature': dPickFeature(i); break;
			case 'line': dPickLine(i); break;
			case 'after': after(); break;
			case 'skip': S.skipped = true; S.rating = 0; goOffice(); break;
			case 'office': goOffice(); break;
			case 'reply': reply(i); break;
			case 'toggle': toggle(i); break;
			case 'check': check(); break;
			case 'onext': nextStep(); break;
			case 'fact': viewFact(); break;
			case 'end': goEnd(); break;
		}
	});
	document.addEventListener('keydown', function (e) {
		if (e.altKey || e.ctrlKey || e.metaKey || !inView) return;
		var t = e.target;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		if (/^[1-9]$/.test(e.key)) {
			var b = boxEl.querySelectorAll('.stb-choices button')[+e.key - 1];
			if (b && !b.disabled) { e.preventDefault(); acted = true; try { b.focus({ preventScroll: true }); } catch (x) { b.focus(); } b.click(); }
		}
	});

	/* ---------- Sound toggle (off until the player turns it on) ---------- */
	var sndBtn = document.getElementById('stb-sound');
	function sndLabel() { var v = SND.isOn(); sndBtn.setAttribute('aria-pressed', v ? 'true' : 'false'); sndBtn.querySelector('.stb-sound-label').textContent = v ? U.soundOn : U.soundOff; }
	if (sndBtn) {
		if (!window.STBSound || !(window.AudioContext || window.webkitAudioContext)) sndBtn.hidden = true;
		else { sndLabel(); sndBtn.addEventListener('click', function () { SND.setOn(!SND.isOn()); sndLabel(); }); }
	}

	/* ---------- Start ---------- */
	if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { inView = es[0].isIntersecting; if (inView) kick(); else snapAll(); }).observe(canvas);
	document.addEventListener('visibilitychange', function () { if (document.hidden) snapAll(); else kick(); });
	window.addEventListener('resize', fit);
	fit();
	goTitle();
})();
