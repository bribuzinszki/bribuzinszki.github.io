/*
	Sell this Banana: music and sound effects, synthesized with the Web Audio API (no audio files, nothing loaded).
	Three original loops: "beach" (a bossa nova chiptune in D), "gym" (an upbeat workout loop in A minor) and
	"office" (soft muzak in C, with a clock tick).
	Sound is off until the player turns it on; the AudioContext is created on that click. Nothing is stored.
	Exposes window.STBSound = { setOn(bool), isOn(), setTrack(name), sfx(name) }.
*/
(function () {
	'use strict';
	var AC = window.AudioContext || window.webkitAudioContext;
	var ctx = null, master = null, noise = null, on = false, track = null, timer = null;
	var tracks = {}, buses = {};

	/* ---------- Songs: each note is [step, midi, length in steps]; 16 steps per bar ---------- */
	function bars(list) { var out = []; list.forEach(function (bar, b) { bar.forEach(function (n) { out.push([b * 16 + n[0], n[1], n[2]]); }); }); return out; }
	var BEACH = {
		bpm: 126, steps: 128,
		chords: [[62, 66, 69, 73], [59, 62, 66, 69], [64, 67, 71, 74], [57, 61, 64, 67], [62, 66, 69, 73], [59, 62, 66, 69], [64, 67, 71, 74], [57, 61, 64, 67]],
		roots: [38, 35, 40, 33, 38, 35, 40, 33],
		comp: [0, 3, 6, 10, 12],
		melody: bars([
			[[0, 78, 3], [3, 76, 3], [6, 74, 2], [8, 69, 6]],
			[[2, 71, 2], [4, 74, 2], [6, 78, 4], [10, 76, 6]],
			[[0, 79, 3], [3, 78, 3], [6, 76, 2], [8, 71, 4], [12, 74, 4]],
			[[0, 73, 4], [4, 76, 2], [6, 81, 4], [10, 79, 2], [12, 76, 4]],
			[[0, 78, 3], [3, 76, 3], [6, 74, 2], [8, 69, 4], [12, 71, 2], [14, 74, 2]],
			[[0, 78, 2], [2, 81, 4], [6, 78, 2], [8, 76, 8]],
			[[0, 74, 3], [3, 76, 3], [6, 79, 2], [8, 78, 4], [12, 76, 4]],
			[[0, 73, 3], [3, 71, 3], [6, 69, 2], [8, 74, 8]]
		])
	};
	var OFFICE = {
		bpm: 84, steps: 64,
		chords: [[60, 64, 67, 71], [57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]],
		roots: [36, 33, 38, 31],
		melody: bars([
			[[0, 67, 4], [4, 71, 4], [8, 76, 8]],
			[[0, 72, 4], [4, 76, 4], [8, 69, 8]],
			[[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 69, 8]],
			[[0, 71, 4], [4, 74, 4], [8, 77, 4], [12, 76, 4]]
		])
	};
	var GYM = {
		bpm: 132, steps: 128,
		chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
		roots: [45, 41, 48, 43, 45, 41, 48, 43],
		melody: bars([
			[[0, 76, 2], [2, 74, 2], [4, 72, 2], [6, 74, 2], [8, 76, 4], [12, 79, 4]],
			[[0, 77, 2], [2, 76, 2], [4, 74, 4], [8, 72, 4], [12, 69, 4]],
			[[0, 72, 2], [2, 74, 2], [4, 76, 2], [6, 79, 2], [8, 84, 4], [12, 79, 4]],
			[[0, 83, 4], [4, 81, 2], [6, 79, 2], [8, 74, 8]],
			[[0, 76, 2], [2, 74, 2], [4, 72, 2], [6, 74, 2], [8, 76, 2], [10, 81, 2], [12, 79, 4]],
			[[0, 77, 4], [4, 81, 4], [8, 77, 2], [10, 76, 2], [12, 74, 4]],
			[[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 84, 2], [8, 83, 2], [10, 81, 2], [12, 79, 4]],
			[[0, 79, 2], [2, 81, 2], [4, 83, 4], [8, 81, 8]]
		])
	};
	function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

	/* ---------- Instruments ---------- */
	function tone(bus, t, midi, dur, type, vol, attack, release) {
		var o = ctx.createOscillator(), gn = ctx.createGain();
		o.type = type; o.frequency.setValueAtTime(hz(midi), t);
		gn.gain.setValueAtTime(0, t);
		gn.gain.linearRampToValueAtTime(vol, t + (attack || 0.005));
		gn.gain.setTargetAtTime(0, t + Math.max(0.01, dur - (release || 0.05)), (release || 0.05) / 3);
		o.connect(gn); gn.connect(bus);
		o.start(t); o.stop(t + dur + (release || 0.05) + 0.1);
	}
	function hiss(bus, t, dur, vol, freq) {
		var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
		s.buffer = noise; f.type = 'highpass'; f.frequency.value = freq || 6000;
		gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		s.connect(f); f.connect(gn); gn.connect(bus);
		s.start(t); s.stop(t + dur + 0.02);
	}

	function kick(bus, t) {
		var o = ctx.createOscillator(), gn = ctx.createGain();
		o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
		gn.gain.setValueAtTime(0.5, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
		o.connect(gn); gn.connect(bus); o.start(t); o.stop(t + 0.2);
	}

	/* ---------- One step of each song ---------- */
	function beachStep(bus, st, t, sd) {
		var bar = Math.floor(st / 16), s = st % 16, ch = BEACH.chords[bar], root = BEACH.roots[bar];
		if (BEACH.comp.indexOf(s) > -1) ch.forEach(function (m) { tone(bus, t, m, sd * 1.4, 'square', 0.022, 0.004, 0.04); });
		if (s === 0 || s === 8) tone(bus, t, root, sd * 5.5, 'triangle', 0.16, 0.005, 0.06);
		if (s === 6 || s === 14) tone(bus, t, root + 7, sd * 1.8, 'triangle', 0.13, 0.005, 0.05);
		if (s % 2 === 0) hiss(bus, t, s % 4 === 2 ? 0.07 : 0.04, s % 4 === 2 ? 0.05 : 0.025, 7000);
		BEACH.melody.forEach(function (n) { if (n[0] === st) tone(bus, t, n[1], n[2] * sd * 0.92, 'square', 0.045, 0.01, 0.06); });
	}
	function officeStep(bus, st, t, sd) {
		var bar = Math.floor(st / 16), s = st % 16, ch = OFFICE.chords[bar], root = OFFICE.roots[bar];
		if (s === 0) ch.forEach(function (m) { tone(bus, t, m, sd * 15, 'sine', 0.035, 0.25, 0.4); });
		if (s === 0 || s === 8) tone(bus, t, s === 0 ? root : root + 7, sd * 7, 'sine', 0.12, 0.02, 0.2);
		if (s % 4 === 0) hiss(bus, t, 0.02, 0.03, 9000);
		OFFICE.melody.forEach(function (n) { if (n[0] === st) { tone(bus, t, n[1], n[2] * sd, 'triangle', 0.06, 0.01, 0.3); tone(bus, t, n[1] + 12, n[2] * sd * 0.5, 'sine', 0.015, 0.01, 0.2); } });
	}

	function gymStep(bus, st, t, sd) {
		var bar = Math.floor(st / 16), s = st % 16, ch = GYM.chords[bar], root = GYM.roots[bar];
		if (s % 4 === 0) kick(bus, t);
		if (s === 4 || s === 12) hiss(bus, t, 0.12, 0.07, 1500);
		if (s % 4 === 2) hiss(bus, t, 0.05, 0.035, 8000);
		if (s % 2 === 0) tone(bus, t, (s % 4 === 0) ? root - 12 : root, sd * 1.6, 'square', 0.05, 0.003, 0.03);
		if (s % 4 === 2) ch.forEach(function (m) { tone(bus, t, m, sd * 1.2, 'square', 0.018, 0.003, 0.03); });
		GYM.melody.forEach(function (n) { if (n[0] === st) tone(bus, t, n[1], n[2] * sd * 0.9, 'square', 0.04, 0.005, 0.05); });
	}

	/* ---------- Scheduler (look-ahead) and buses for cross-fades ---------- */
	function makeTrack(name, song, stepFn) {
		var bus = ctx.createGain(); bus.gain.value = 0; bus.connect(master);
		buses[name] = bus;
		tracks[name] = { song: song, fn: stepFn, step: 0, next: 0 };
	}
	function tick() {
		if (!ctx || !track) return;
		var tr = tracks[track], sd = 60 / tr.song.bpm / 4;
		if (tr.next < ctx.currentTime) tr.next = ctx.currentTime + 0.05;
		while (tr.next < ctx.currentTime + 0.15) {
			tr.fn(buses[track], tr.step, tr.next, sd);
			tr.step = (tr.step + 1) % tr.song.steps;
			tr.next += sd;
		}
	}
	function init() {
		if (ctx || !AC) return !!ctx;
		ctx = new AC();
		master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
		noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
		var d = noise.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
		makeTrack('beach', BEACH, beachStep);
		makeTrack('office', OFFICE, officeStep);
		makeTrack('gym', GYM, gymStep);
		document.addEventListener('visibilitychange', function () { if (!ctx || !on) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
		return true;
	}
	function fadeTo(name) {
		if (!ctx) return;
		var t = ctx.currentTime;
		Object.keys(buses).forEach(function (k) {
			var gn = buses[k].gain; gn.cancelScheduledValues(t); gn.setValueAtTime(gn.value, t);
			gn.linearRampToValueAtTime(on && k === name ? 1 : 0, t + 0.6);
		});
		if (name && tracks[name] && track !== name) { tracks[name].step = 0; tracks[name].next = t + 0.05; }
	}

	/* ---------- Sound effects ---------- */
	var SFX = {
		pick: function (t) { tone(master, t, 84, 0.05, 'square', 0.05, 0.002, 0.02); },
		sale: function (t) { [72, 76, 79, 84].forEach(function (m, i) { tone(master, t + i * 0.07, m, 0.12, 'square', 0.06, 0.003, 0.04); }); },
		door: function (t) { tone(master, t, 79, 0.1, 'square', 0.05); tone(master, t + 0.1, 84, 0.14, 'square', 0.05); },
		fail: function (t) { [67, 66, 65, 62].forEach(function (m, i) { tone(master, t + i * 0.16, m, i === 3 ? 0.45 : 0.15, 'triangle', 0.12, 0.005, 0.08); }); },
		wrong: function (t) { tone(master, t, 55, 0.18, 'square', 0.04, 0.003, 0.05); },
		right: function (t) { [76, 79, 84].forEach(function (m, i) { tone(master, t + i * 0.08, m, 0.14, 'triangle', 0.1); }); }
	};

	window.STBSound = {
		isOn: function () { return on; },
		setOn: function (v) {
			if (v && !init()) return false;
			on = !!v;
			if (!ctx) return on;
			if (on) {
				ctx.resume();
				if (!timer) timer = setInterval(tick, 25);
				fadeTo(track);
			} else {
				fadeTo(null);
				setTimeout(function () { if (!on && ctx) { clearInterval(timer); timer = null; ctx.suspend(); } }, 700);
			}
			return on;
		},
		setTrack: function (name) {
			if (name === track) return;
			var prev = track; track = name;
			if (ctx && on) { track = prev; fadeTo(name); track = name; }
		},
		sfx: function (name) { if (ctx && on && SFX[name]) SFX[name](ctx.currentTime + 0.01); }
	};
})();
