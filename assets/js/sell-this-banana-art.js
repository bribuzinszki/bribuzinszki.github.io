/*
	Sell this Banana: pixel art, drawn in code (no image files, no font files). All art is original.
	Everything is built once at load into small off-screen canvases, most with an automatic 1px outline,
	and drawn by the engine (sell-this-banana.js). The game canvas is 320 x 180.
	Exposes window.STBArt.
*/
(function () {
	'use strict';
	var W = 320, H = 180;

	var P = {
		ink: '#2a1f33',
		white: '#fff8ea', cream: '#fff1c9',
		sky1: '#4fb3ea', sky2: '#6cc4f0', sky3: '#93d6f4', sky4: '#bfe8f7',
		sunCore: '#fff7c2', sunRing: '#ffe27a',
		cloud: '#ffffff', cloudShade: '#d9effa',
		rock: '#3f8a6a', rockDark: '#2c6a52', rockLight: '#5aa883',
		sea1: '#1f6fb8', sea2: '#2b88cc', sea3: '#3ea2dc', horizon: '#1a5e9e', foam: '#effaff', sparkle: '#cdeffc',
		sand1: '#f6dfae', sand2: '#eccf94', sand3: '#d9b679', sandDot: '#c79f62', wet: '#e2c387',
		wood: '#b06f3c', woodDark: '#7a4523', woodLight: '#d39256', interior: '#5a3320', interiorDark: '#45261a',
		leaf: '#3f9e48', leafDark: '#2a6e35', leafLight: '#79c95a',
		trunk: '#a8743f', trunkDark: '#7a5129',
		yellow: '#f7d23e', yellowShade: '#d9a521', yellowLight: '#fff09a', awningShade: '#e3b52c', whiteShade: '#eadfc8',
		spot: '#6b4a1e', stem: '#6e7d2a', tip: '#4a3a1a',
		red: '#e0483f', redDark: '#a42e35', orange: '#f28c3a', pink: '#f27aa8', pinkLight: '#ffc4dc',
		blue: '#3f7fd6', navy: '#26407a', teal: '#2aa59a', purple: '#8a55c7', green: '#5bb04a', lime: '#a6d84a',
		grey: '#9aa3ad', greyDark: '#5b6470', greyLight: '#d5dbe0',
		coco: '#6fae3f', cocoLight: '#a3d46c', cocoDark: '#3f7a26',
		straw: '#e8c26a', strawDark: '#c79a3e',
		skin1: '#f6cfa6', skin2: '#e3a874', skin3: '#bf7f48', skin4: '#7d4b2a',
		hairBlond: '#f2cc5c', hairBrown: '#7a4a26', hairDark: '#33221a', hairGrey: '#d1cbc4', hairRed: '#c4572e',
		gymWall: '#dfe3ea', gymPanel: '#c3cad6', gymPanelLine: '#b3bccb', gymFloor: '#3a3f4e', gymFloorDark: '#2c303c', gymSpeck: '#4a5062', machine: '#c8553d', glassDark: '#1d2333',
		wall: '#efe5d2', wallShade: '#e4d7bf', floor: '#b98a5c', floorDark: '#9a6f45',
		screen: '#f7fbff', ui: '#3f7fd6', hill: '#6cae4f', hillDark: '#4f8f3a', roof: '#c8553d', house: '#f3e6cf'
	};

	/* ---------- Helpers ---------- */
	function cv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
	function cx(c) { var g = c.getContext('2d'); g.imageSmoothingEnabled = false; return g; }
	function rect(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
	function px(g, x, y, col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
	function disc(g, x0, y0, r, col) {
		g.fillStyle = col;
		for (var y = -r; y <= r; y++) {
			var hw = Math.floor(Math.sqrt(r * r + r * 0.6 - y * y));
			g.fillRect(x0 - hw, y0 + y, hw * 2 + 1, 1);
		}
	}
	function shade(hex, f) {
		var n = parseInt(hex.slice(1), 16), k = 1 - f;
		return 'rgb(' + Math.round((n >> 16) * k) + ',' + Math.round(((n >> 8) & 255) * k) + ',' + Math.round((n & 255) * k) + ')';
	}
	function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
	/* Adds a 1px outline around every opaque shape (the canvas grows by 1px on each side). */
	function outline(src, col) {
		var w = src.width, h = src.height, out = cv(w + 2, h + 2), g = cx(out);
		var d = src.getContext('2d').getImageData(0, 0, w, h).data;
		function on(x, y) { return x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0; }
		g.fillStyle = col || P.ink;
		for (var y = -1; y <= h; y++) {
			for (var x = -1; x <= w; x++) {
				if (on(x, y)) continue;
				if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) g.fillRect(x + 1, y + 1, 1, 1);
			}
		}
		g.drawImage(src, 1, 1);
		return out;
	}
	function flip(src) { var c = cv(src.width, src.height), g = cx(c); g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); return c; }
	function grid(rows, map) {
		var c = cv(rows[0].length, rows.length), g = cx(c);
		for (var y = 0; y < rows.length; y++) for (var x = 0; x < rows[y].length; x++) { var ch = rows[y][x]; if (map[ch]) px(g, x, y, map[ch]); }
		return c;
	}

	/* ---------- Pixel font (5 x 7, rows as bit masks, leftmost pixel = 16) ---------- */
	var FONT = {
		A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
		E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
		I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
		M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
		Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
		U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
		Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
		'0': [14, 17, 17, 17, 17, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
		'4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
		'8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
		'$': [4, 15, 20, 14, 5, 30, 4], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], '.': [0, 0, 0, 0, 0, 0, 4],
		'-': [0, 0, 0, 14, 0, 0, 0], '·': [0, 0, 0, 4, 0, 0, 0], "'": [4, 4, 8, 0, 0, 0, 0], ':': [0, 0, 4, 0, 0, 4, 0],
		',': [0, 0, 0, 0, 4, 4, 8], '/': [1, 1, 2, 4, 8, 16, 16], '€': [6, 9, 28, 8, 28, 9, 6], ' ': [0, 0, 0, 0, 0, 0, 0]
	};
	function textW(s, sc) { return (String(s).length * 6 - 1) * (sc || 1); }
	function text(g, s, x, y, col, sc) {
		sc = sc || 1; s = String(s).toUpperCase(); g.fillStyle = col;
		for (var i = 0; i < s.length; i++) {
			var gl = FONT[s[i]]; if (!gl) continue;
			for (var r = 0; r < 7; r++) for (var b = 0; b < 5; b++) if (gl[r] & (16 >> b)) g.fillRect(x + (i * 6 + b) * sc, y + r * sc, sc, sc);
		}
	}
	/* Text with an ink outline and a small drop shadow, for titles on top of the scene. */
	function textBold(g, s, x, y, sc, col) {
		for (var dy = -1; dy <= 2; dy++) for (var dx = -1; dx <= 1; dx++) text(g, s, x + dx, y + dy, P.ink, sc);
		text(g, s, x, y, col, sc);
	}
	function center(s, sc) { return Math.round((W - textW(s, sc)) / 2); }

	/* ---------- Bananas ---------- */
	var BAN = [
		{ main: P.yellow, shade: P.yellowShade, light: P.yellowLight, spot: P.spot, n: 0 },
		{ main: P.yellow, shade: P.yellowShade, light: P.yellowLight, spot: P.spot, n: 4 },
		{ main: '#e8c23a', shade: '#c4901c', light: '#f6df7c', spot: P.spot, n: 11 },
		{ main: '#8f6b2c', shade: '#634a1e', light: '#a9874a', spot: '#3c2a10', n: 9 }
	];
	var GREY = { main: '#6d72a0', shade: '#565a85', light: '#8a8fbd', spot: '#565a85', n: 0 };
	/* One banana as a smile-shaped crescent: (x0, y0) is where the tips sit, depth is how far the middle sags. */
	function banana(g, x0, y0, len, thick, depth, col, pts) {
		for (var i = 0; i < len; i++) {
			var u = (i / (len - 1)) * 2 - 1;
			var bottom = y0 + Math.round((1 - u * u) * depth);
			var th = Math.max(1, Math.round(thick * Math.sqrt(Math.max(0, 1 - u * u * 0.8))));
			for (var k = 0; k < th; k++) {
				var c = col.main;
				if (k === 0) c = col.shade;
				else if (k === th - 1 && th > 2 && Math.abs(u) < 0.7) c = col.light;
				px(g, x0 + i, bottom - k, c);
				if (pts && k > 0 && i > 1 && i < len - 2) pts.push([x0 + i, bottom - k]);
			}
		}
		px(g, x0, y0, P.tip);
		px(g, x0 + len, y0 - 1, P.stem);
	}
	function sprinkle(g, pts, n, col, seed) { var r = rng(seed); for (var i = 0; i < n && pts.length; i++) { var p = pts[Math.floor(r() * pts.length)]; px(g, p[0], p[1], col); } }
	function bunch(state) {
		var c = cv(20, 12), g = cx(c), col = BAN[state], pts = [];
		banana(g, 1, 3, 15, 3, 3, col, pts);
		banana(g, 2, 5, 15, 3, 3, col, pts);
		banana(g, 3, 7, 14, 3, 3, col, pts);
		rect(g, 16, 3, 2, 5, P.stem); px(g, 18, 2, P.stem); px(g, 17, 2, shade(P.stem, 0.2));
		sprinkle(g, pts, col.n, col.spot, 11 + state);
		return outline(c);
	}
	function single(len, thick, depth, col, seed) {
		var c = cv(len + 3, thick + depth + 3), g = cx(c), pts = [];
		banana(g, 1, thick + 0, len, thick, depth, col, pts);
		sprinkle(g, pts, Math.round(col.n * len / 30), col.spot, seed || 5);
		return outline(c);
	}

	/* ---------- People (facing right; the engine flips them to face left) ---------- */
	var PEOPLE = {
		seller: { skin: P.skin2, hair: P.hairBrown, hairStyle: 'short', cap: P.red, shirt: P.teal, shirtStyle: 'tee', apron: P.cream, bottom: P.navy, shoes: P.white },
		surfer: { skin: P.skin3, hair: P.hairBlond, hairStyle: 'spiky', shades: true, shirtStyle: 'none', bottom: P.orange, shoes: P.skin3 },
		jogger: { skin: P.skin2, hair: P.hairDark, hairStyle: 'ponytail', band: P.red, shirt: P.pink, shirtStyle: 'tank', bottom: P.navy, shoes: P.white },
		parent: { skin: P.skin4, hair: P.hairDark, hairStyle: 'long', hat: P.straw, hatBand: P.red, shirt: P.purple, shirtStyle: 'dress', bottom: P.purple, bottomStyle: 'skirt', shoes: P.orange, bag: P.lime },
		member: { skin: P.skin1, hair: P.hairRed, hairStyle: 'short', shirt: P.lime, shirtStyle: 'tank', bottom: '#2b2f3a', shoes: P.white, towel: P.white },
		vendor: { skin: P.skin3, hair: P.hairGrey, hairStyle: 'short', hat: P.straw, hatBand: P.green, shirt: P.white, shirtStyle: 'tank', bottom: P.blue, shoes: P.greyDark }
	};
	function hair(g, o) {
		var h = o.hair;
		rect(g, 5, 0, 7, 2, h); rect(g, 4, 1, 3, 6, h); rect(g, 7, 2, 3, 1, h); px(g, 12, 1, h);
		if (o.hairStyle === 'spiky') { px(g, 13, 1, h); px(g, 12, 2, h); rect(g, 3, 1, 1, 3, h); px(g, 5, 0, shade(h, 0.15)); px(g, 8, 0, shade(h, 0.15)); }
		if (o.hairStyle === 'ponytail') { rect(g, 1, 2, 3, 2, h); rect(g, 1, 4, 2, 3, h); }
		if (o.hairStyle === 'long') rect(g, 4, 1, 3, 12, h);
	}
	function person(o, legs, mood) {
		var c = cv(16, 25), g = cx(c), sk = o.skin, sh = shade(o.skin, 0.18);
		/* legs and shoes: frame 0 = stride, frame 1 = together */
		if (legs === 0) { rect(g, 6, 20, 2, 4, sh); rect(g, 9, 20, 2, 4, sk); rect(g, 5, 24, 3, 1, o.shoes); rect(g, 9, 24, 3, 1, o.shoes); }
		else { rect(g, 7, 20, 2, 4, sh); rect(g, 8, 20, 2, 4, sk); rect(g, 7, 24, 4, 1, o.shoes); }
		if (o.bottomStyle === 'skirt') rect(g, 5, 16, 7, 5, o.bottom); else rect(g, 6, 17, 5, 3, o.bottom);
		var top = o.shirtStyle === 'none' ? sk : o.shirt;
		rect(g, 6, 11, 5, 6, top);
		if (o.shirtStyle === 'tank') { px(g, 6, 11, sk); px(g, 10, 11, sk); }
		if (o.shirtStyle === 'none') { px(g, 7, 13, sh); px(g, 7, 15, sh); }
		if (o.apron) { rect(g, 8, 13, 3, 6, o.apron); px(g, 7, 12, o.apron); }
		if (o.towel) { rect(g, 9, 10, 2, 6, o.towel); px(g, 10, 16, shade(o.towel, 0.15)); }
		if (o.bag) { rect(g, 3, 14, 3, 4, o.bag); px(g, 4, 12, shade(o.bag, 0.35)); px(g, 5, 13, shade(o.bag, 0.35)); }
		/* front arm */
		var sleeve = (o.shirtStyle === 'tee' || o.shirtStyle === 'dress') ? shade(o.shirt, 0.2) : sh;
		rect(g, 8, 12, 2, 2, sleeve); rect(g, 8, 14, 2, 2, sh); rect(g, 8, 16, 2, 1, sk);
		/* head */
		rect(g, 6, 1, 6, 1, sk); rect(g, 5, 2, 8, 7, sk); rect(g, 6, 9, 6, 1, sk); px(g, 13, 5, sk);
		rect(g, 8, 10, 2, 1, sh);
		hair(g, o);
		px(g, 7, 5, sh); px(g, 7, 6, sh);
		if (o.shades) { rect(g, 9, 4, 4, 2, P.ink); px(g, 8, 4, P.ink); px(g, 12, 4, '#7fd3ef'); }
		else rect(g, 10, 4, 1, 2, P.ink);
		if (mood === 'smile') { rect(g, 11, 7, 2, 1, P.ink); px(g, 10, 6, P.pink); }
		else px(g, 12, 7, sh);
		if (o.band) { rect(g, 5, 2, 8, 1, o.band); px(g, 4, 2, o.band); px(g, 3, 3, o.band); }
		if (o.cap) { rect(g, 5, 0, 8, 2, o.cap); rect(g, 12, 2, 3, 1, o.cap); px(g, 6, 0, shade(o.cap, 0.15)); }
		if (o.hat) { rect(g, 6, 0, 6, 2, o.hat); rect(g, 6, 1, 6, 1, o.hatBand); rect(g, 2, 2, 13, 1, o.hat); px(g, 2, 2, P.strawDark); px(g, 14, 2, P.strawDark); }
		return outline(c);
	}
	var KIDS = {
		kid1: { skin: P.skin4, hair: P.hairDark, shirt: P.yellow, bottom: P.blue, shoes: P.red },
		kid2: { skin: P.skin4, hair: P.hairDark, pigtails: true, shirt: P.red, bottom: P.green, shoes: P.white }
	};
	function kid(o, legs, mood) {
		var c = cv(12, 17), g = cx(c), sk = o.skin, sh = shade(sk, 0.18);
		if (legs === 0) { rect(g, 4, 13, 1, 3, sh); rect(g, 7, 13, 1, 3, sk); rect(g, 3, 16, 2, 1, o.shoes); rect(g, 7, 16, 2, 1, o.shoes); }
		else { rect(g, 5, 13, 2, 3, sk); rect(g, 5, 16, 3, 1, o.shoes); }
		rect(g, 4, 11, 4, 2, o.bottom);
		rect(g, 4, 7, 4, 4, o.shirt);
		rect(g, 6, 8, 2, 2, shade(o.shirt, 0.2)); rect(g, 6, 10, 2, 1, sk);
		rect(g, 4, 0, 5, 1, sk); rect(g, 3, 1, 7, 5, sk); rect(g, 4, 6, 5, 1, sk); px(g, 10, 3, sk);
		rect(g, 3, 0, 6, 2, o.hair); rect(g, 2, 1, 2, 4, o.hair);
		if (o.pigtails) { px(g, 1, 2, o.hair); px(g, 1, 3, o.hair); px(g, 0, 3, o.hair); }
		rect(g, 8, 2, 1, 2, P.ink);
		if (mood === 'smile') { rect(g, 8, 5, 2, 1, P.ink); } else px(g, 9, 5, sh);
		return outline(c);
	}
	function pack(make, o, hand) {
		var s = { walk: [make(o, 0), make(o, 1)], stand: make(o, 1, 'stand'), smile: make(o, 1, 'smile'), hand: hand };
		s.walkL = [flip(s.walk[0]), flip(s.walk[1])]; s.standL = flip(s.stand); s.smileL = flip(s.smile);
		s.w = s.stand.width; s.h = s.stand.height;
		return s;
	}

	function surfboard() {
		var c = cv(7, 30), g = cx(c);
		for (var y = 0; y < 30; y++) {
			var hw = y < 4 ? [1, 2, 2, 3][y] : y > 25 ? [3, 2, 2, 1][y - 26] : 3;
			rect(g, 3 - hw, y, hw * 2 + 1, 1, P.white);
			px(g, 3 - hw, y, P.teal); px(g, 3 + hw, y, P.teal);
			if (y > 2 && y < 27) px(g, 3, y, P.red);
		}
		return outline(c);
	}
	function coconutItem() { var c = cv(6, 6), g = cx(c); disc(g, 3, 3, 2, P.coco); px(g, 2, 2, P.cocoLight); rect(g, 4, 0, 1, 2, P.pink); return outline(c); }

	/* ---------- Emote bubbles ---------- */
	var EMO = { '!': [4, 4, 4, 0, 4], '?': [14, 1, 6, 0, 4], dots: [0, 0, 0, 0, 21], heart: [10, 31, 31, 14, 4], vein: [27, 17, 0, 17, 27] };
	function bubble(k) {
		var c = cv(11, 10), g = cx(c), rows = EMO[k], col = (k === 'heart' || k === 'vein') ? P.red : P.ink;
		rect(g, 1, 0, 9, 8, P.white); rect(g, 0, 1, 11, 6, P.white); px(g, 2, 8, P.white); px(g, 1, 9, P.white);
		for (var r = 0; r < 5; r++) for (var b = 0; b < 5; b++) if (rows[r] & (16 >> b)) px(g, 3 + b, 1 + r, col);
		return outline(c);
	}

	/* ---------- Kiosk (two layers so the seller stands behind the counter) ---------- */
	function kioskLayers() {
		var back = cv(112, 80), g = cx(back);
		rect(g, 30, 10, 3, 8, P.woodDark); rect(g, 80, 10, 3, 8, P.woodDark);
		rect(g, 20, 0, 72, 13, P.wood); rect(g, 22, 2, 68, 9, P.cream);
		text(g, 'BANANAS', 56 - Math.floor(textW('BANANAS') / 2), 3, P.redDark);
		var small = single(6, 2, 1, BAN[0]);
		g.drawImage(small, 24, 4); g.drawImage(small, 81, 4);
		for (var x = 2; x < 110; x++) {
			var s = Math.floor((x - 2) / 8) % 2;
			rect(g, x, 16, 1, 12, s ? P.white : P.yellow);
			rect(g, x, 24, 1, 4, s ? P.whiteShade : P.awningShade);
		}
		rect(g, 2, 16, 108, 1, P.yellowShade);
		for (var k = 0; k < 14; k++) {
			var c0 = 2 + k * 8 + 4, col = k % 2 ? P.whiteShade : P.awningShade;
			if (c0 + 3 > 110) break;
			rect(g, c0 - 4, 28, 8, 1, col); rect(g, c0 - 3, 29, 6, 1, col); rect(g, c0 - 2, 30, 4, 1, col);
		}
		rect(g, 6, 31, 4, 33, P.wood); rect(g, 102, 31, 4, 33, P.wood); rect(g, 9, 31, 1, 33, P.woodDark); rect(g, 102, 31, 1, 33, P.woodDark);
		rect(g, 10, 31, 92, 30, P.interior); rect(g, 10, 31, 92, 3, P.interiorDark);
		rect(g, 40, 46, 58, 2, P.woodDark);
		var b0 = bunch(0);
		g.drawImage(b0, 44, 47 - b0.height); g.drawImage(b0, 68, 47 - b0.height);
		disc(g, 93, 43, 2, P.coco); disc(g, 89, 44, 2, P.cocoDark);
		var front = cv(112, 80), f = cx(front);
		rect(f, 2, 61, 108, 3, P.woodLight); rect(f, 2, 63, 108, 1, P.woodDark);
		rect(f, 6, 64, 100, 16, P.wood);
		for (var y = 69; y < 80; y += 5) rect(f, 6, y, 100, 1, P.woodDark);
		rect(f, 12, 66, 28, 11, P.cream); text(f, 'R$ 3', 14, 68, P.redDark);
		banana(f, 66, 67, 24, 5, 4, BAN[0]);
		return { back: outline(back), front: outline(front) };
	}

	/* ---------- Coconut stand (with its vendor) ---------- */
	function coconutStand(vendor) {
		var c = cv(64, 52), g = cx(c);
		for (var x = -22; x <= 22; x++) {
			var h = Math.round(Math.sqrt(1 - (x / 22) * (x / 22)) * 10), col = (Math.floor((x + 22) / 6) % 2) ? P.white : P.red;
			rect(g, 32 + x, 12 - h, 1, h + 1, col);
		}
		for (var s = 0; s < 8; s++) { var sx = 10 + s * 6; rect(g, sx, 13, 4, 1, (s % 2) ? P.white : P.red); }
		rect(g, 31, 10, 2, 34, P.greyDark);
		g.drawImage(vendor, 40, 7);
		rect(g, 4, 30, 52, 3, P.woodLight); rect(g, 6, 33, 48, 12, P.teal); rect(g, 6, 39, 48, 1, shade(P.teal, 0.25));
		text(g, 'COCO', 18, 35, P.white);
		var pile = [[12, 26], [19, 25], [26, 26], [15, 21], [23, 21], [19, 17]];
		for (var i = 0; i < pile.length; i++) { disc(g, pile[i][0], pile[i][1], 3, i % 2 ? P.cocoDark : P.coco); px(g, pile[i][0] - 1, pile[i][1] - 1, P.cocoLight); }
		disc(g, 16, 46, 5, P.greyDark); disc(g, 16, 46, 2, P.grey); rect(g, 48, 45, 3, 6, P.woodDark);
		return outline(c);
	}

	/* ---------- Palm ---------- */
	function palm() {
		var c = cv(64, 116), g = cx(c);
		for (var i = 0; i <= 100; i++) {
			var t = i / 100, x = Math.round(46 - 20 * t * t), y = 114 - i, w = Math.round(5 - 2 * t);
			rect(g, x - (w >> 1), y, w, 1, (Math.floor(i / 5) % 2) ? P.trunkDark : P.trunk);
		}
		var cxT = 26, cyT = 14;
		var leaves = [[-2.95, 24, 0.5], [-2.45, 22, 0.6], [-0.55, 24, 0.55], [-0.15, 26, 0.5], [0.3, 20, 0.6], [2.6, 18, 0.7], [-1.6, 12, 0.2]];
		for (var l = 0; l < leaves.length; l++) {
			var a = leaves[l][0], L = leaves[l][1], droop = leaves[l][2];
			for (var s2 = 0; s2 <= L; s2++) {
				var lx = Math.round(cxT + Math.cos(a) * s2), ly = Math.round(cyT + Math.sin(a) * s2 + droop * s2 * s2 / L);
				rect(g, lx, ly, 2, 2, P.leaf); px(g, lx, ly, P.leafLight);
				if (s2 > 3 && s2 % 2 === 0) { var fl = Math.max(1, 4 - Math.floor(s2 / (L / 3))); rect(g, lx, ly + 2, 1, fl, P.leafDark); }
			}
		}
		disc(g, 24, 16, 2, P.cocoDark); disc(g, 28, 17, 2, P.cocoDark); disc(g, 26, 19, 2, shade(P.cocoDark, 0.2));
		return outline(c);
	}

	/* ---------- Beach background ---------- */
	function cloud(g, x, y) {
		disc(g, x, y + 3, 4, P.cloud); disc(g, x + 6, y, 5, P.cloud); disc(g, x + 12, y + 2, 4, P.cloud);
		rect(g, x - 3, y + 4, 19, 4, P.cloud); rect(g, x - 2, y + 7, 17, 1, P.cloudShade);
	}
	function umbrella(g, x0, y0) {
		rect(g, x0, y0, 2, 26, P.greyDark);
		for (var x = -13; x <= 13; x++) {
			var h = Math.round(Math.sqrt(1 - (x / 13) * (x / 13)) * 7), col = (Math.floor((x + 13) / 5) % 2) ? P.white : P.blue;
			rect(g, x0 + 1 + x, y0 - h, 1, h + 1, col);
		}
	}
	function beach(palmImg) {
		var c = cv(W, H), g = cx(c), r = rng(42), i, x, y;
		var bands = [[0, P.sky1], [18, P.sky2], [36, P.sky3], [54, P.sky4]];
		for (i = 0; i < bands.length; i++) rect(g, 0, bands[i][0], W, 18, bands[i][1]);
		for (i = 1; i < bands.length; i++) for (x = 0; x < W; x += 2) { px(g, x, bands[i][0], bands[i - 1][1]); px(g, x + 1, bands[i][0] - 1, bands[i][1]); }
		disc(g, 46, 24, 13, P.sunRing); disc(g, 46, 24, 10, P.sunCore);
		cloud(g, 112, 14); cloud(g, 182, 32); cloud(g, 262, 10);
		for (x = 0; x <= 40; x++) {
			var u = x / 40 * 2 - 1, h = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * (x < 18 ? 13 : 9));
			rect(g, 204 + x, 72 - h, 1, h, P.rock);
			if (x > 3 && x < 14) px(g, 204 + x, 72 - h, P.rockLight);
		}
		rect(g, 0, 72, W, 8, P.sea1); rect(g, 0, 80, W, 9, P.sea2); rect(g, 0, 89, W, 12, P.sea3);
		for (x = 0; x < W; x += 2) { px(g, x, 80, P.sea1); px(g, x + 1, 89, P.sea2); }
		rect(g, 0, 72, W, 1, P.horizon);
		rect(g, 0, 101, W, 79, P.sand1); rect(g, 0, 101, W, 5, P.wet);
		rect(g, 0, 162, W, 18, P.sand2);
		for (x = 0; x < W; x += 2) px(g, x + ((x / 2) % 2), 161, P.sand2);
		for (i = 0; i < 300; i++) { x = Math.floor(r() * W); y = 107 + Math.floor(r() * 73); px(g, x, y, r() < 0.5 ? P.sand3 : (r() < 0.5 ? P.sand2 : P.sandDot)); }
		for (i = 0; i < 6; i++) { x = Math.floor(r() * W); y = 160 + Math.floor(r() * 16); px(g, x, y, P.pinkLight); px(g, x + 1, y, P.white); }
		umbrella(g, 110, 104);
		for (x = 0; x < 28; x++) rect(g, 96 + x, 131, 1, 6, (Math.floor(x / 3) % 2) ? P.white : P.pink);
		g.drawImage(palmImg, 258, 36);
		var deco = cv(60, 20), d = cx(deco);
		disc(d, 8, 8, 5, P.white); rect(d, 3, 6, 11, 2, P.red); rect(d, 7, 3, 2, 11, P.blue); px(d, 6, 5, P.white);
		rect(d, 26, 10, 14, 6, P.sand3); rect(d, 28, 5, 4, 5, P.sand3); rect(d, 34, 6, 4, 4, P.sand3); rect(d, 29, 1, 1, 4, P.greyDark); rect(d, 30, 1, 3, 2, P.red);
		var star = outline(grid(['..o..', 'ooooo', '.ooo.', 'o...o'], { o: P.orange }));
		g.drawImage(outline(deco), 120, 158);
		g.drawImage(star, 236, 168);
		return c;
	}
	var sparkles = (function () { var r = rng(9), a = []; for (var i = 0; i < 26; i++) a.push([Math.floor(r() * W), 75 + Math.floor(r() * 22)]); return a; })();
	function drawWaves(g, f) {
		g.fillStyle = P.sparkle;
		for (var i = 0; i < sparkles.length; i++) if ((i + f) % 3 === 0) g.fillRect(sparkles[i][0], sparkles[i][1], 2, 1);
		g.fillStyle = P.foam;
		for (var x = 0; x < W; x++) {
			var y = 99 + Math.round(Math.sin((x + f * 2) / 6) * 0.8 + Math.sin((x - f * 3) / 15) * 1.2);
			g.fillRect(x, y, 1, 2);
		}
	}

	/* ---------- Office ---------- */
	function office() {
		var c = cv(W, H), g = cx(c), x, y;
		rect(g, 0, 0, W, 140, P.wall);
		for (x = 10; x < W; x += 20) rect(g, x, 0, 1, 136, P.wallShade);
		rect(g, 0, 136, W, 4, P.woodDark);
		rect(g, 0, 140, W, 40, P.floor);
		for (y = 147; y < H; y += 8) rect(g, 0, y, W, 1, P.floorDark);
		var wi = cv(104, 80), w = cx(wi);
		rect(w, 0, 0, 104, 80, P.white);
		rect(w, 4, 4, 96, 72, P.sky3); rect(w, 4, 4, 96, 22, P.sky2);
		for (x = 4; x < 100; x++) {
			var h = Math.round(28 + Math.sin(x / 11) * 6 + Math.sin(x / 5) * 2);
			rect(w, x, 76 - h, 1, h, P.hill);
			for (y = 76 - h + 3; y < 76; y += 4) if ((x + y) % 3 === 0) px(w, x, y, P.hillDark);
		}
		var houses = [[10, 14], [26, 18], [44, 12], [62, 16], [80, 13]];
		for (var k = 0; k < houses.length; k++) {
			var hx = houses[k][0], hw = houses[k][1];
			rect(w, hx, 62, hw, 14, P.house);
			for (var rr = 0; rr < 6; rr++) rect(w, hx - 1 + rr, 61 - rr, hw + 2 - rr * 2, 1, P.roof);
			rect(w, hx + 3, 66, 3, 3, P.sky1); if (hw > 13) rect(w, hx + hw - 6, 66, 3, 3, P.sky1);
		}
		rect(w, 51, 4, 2, 72, P.white); rect(w, 4, 39, 96, 2, P.white);
		g.drawImage(outline(wi), 20, 18);
		var po = cv(48, 58), q = cx(po);
		rect(q, 0, 0, 48, 58, P.navy); rect(q, 3, 3, 42, 52, P.cream);
		text(q, 'KARL-', 24 - Math.floor(textW('KARL-') / 2), 8, P.navy);
		text(q, 'KLEIN', 24 - Math.floor(textW('KLEIN') / 2), 18, P.navy);
		text(q, '2.0', 24 - Math.floor(textW('2.0', 2) / 2), 30, P.red, 2);
		rect(q, 9, 48, 30, 2, P.yellow);
		g.drawImage(outline(po), 262, 16);
		var ob = cv(W, H), o = cx(ob);
		rect(o, 128, 112, 176, 5, P.woodLight); rect(o, 132, 117, 168, 20, P.wood); rect(o, 132, 117, 168, 1, P.woodDark);
		rect(o, 250, 121, 42, 7, P.woodLight); rect(o, 268, 124, 6, 1, P.woodDark); rect(o, 250, 130, 42, 6, P.woodLight); rect(o, 268, 132, 6, 1, P.woodDark);
		rect(o, 134, 137, 4, 15, P.woodDark); rect(o, 294, 137, 4, 15, P.woodDark);
		rect(o, 172, 56, 76, 46, P.greyDark); rect(o, 175, 59, 70, 38, P.screen); rect(o, 175, 59, 70, 6, P.ui);
		px(o, 178, 61, P.white); px(o, 180, 61, P.white); px(o, 182, 61, P.white);
		rect(o, 196, 70, 28, 18, P.cream);
		for (var e = 0; e < 14; e++) { var ey = 71 + Math.floor(e * 0.6); px(o, 197 + e, ey, P.ink); px(o, 222 - e, ey, P.ink); }
		disc(o, 225, 70, 3, P.red);
		rect(o, 206, 102, 8, 10, P.grey); rect(o, 196, 110, 28, 2, P.greyDark);
		rect(o, 178, 107, 44, 5, P.greyLight); for (x = 180; x < 220; x += 3) px(o, x, 109, P.grey);
		rect(o, 254, 100, 9, 11, P.red); rect(o, 263, 103, 2, 5, P.red); px(o, 257, 96, P.white); px(o, 258, 94, P.white); px(o, 259, 97, P.white);
		banana(o, 268, 107, 14, 3, 2, BAN[0]);
		rect(o, 142, 100, 14, 12, P.orange); rect(o, 140, 97, 18, 3, shade(P.orange, 0.2));
		disc(o, 144, 91, 5, P.leaf); disc(o, 153, 89, 5, P.leaf); disc(o, 149, 84, 5, P.leafDark); px(o, 143, 89, P.leafLight); px(o, 152, 87, P.leafLight);
		g.drawImage(outline(ob), -1, -1);
		return c;
	}

	/* ---------- Gym in Stuttgart ---------- */
	function stuttgartView(w0, h0) {
		var c = cv(w0, h0), w = cx(c), x, y;
		rect(w, 0, 0, w0, h0, P.white);
		rect(w, 3, 3, w0 - 6, h0 - 6, P.sky3); rect(w, 3, 3, w0 - 6, Math.round(h0 * 0.3), P.sky2);
		for (x = 3; x < w0 - 3; x++) {
			var h = Math.round(h0 * 0.36 + Math.sin(x / 9) * 4 + Math.sin(x / 4) * 1.5);
			rect(w, x, h0 - 3 - h, 1, h, P.hill);
			for (y = h0 - 3 - h + 3; y < h0 - 3; y += 4) if ((x + y) % 3 === 0) px(w, x, y, P.hillDark);
		}
		[[8, 12], [24, 15], [42, 11], [58, 14], [76, 12]].forEach(function (hs) {
			if (hs[0] + hs[1] > w0 - 4) return;
			var base = h0 - 14;
			rect(w, hs[0], base, hs[1], 11, P.house);
			for (var rr = 0; rr < 5; rr++) rect(w, hs[0] - 1 + rr, base - 1 - rr, hs[1] + 2 - rr * 2, 1, P.roof);
			rect(w, hs[0] + 3, base + 3, 3, 3, P.sky1);
		});
		rect(w, Math.floor(w0 / 2) - 1, 3, 2, h0 - 6, P.white);
		return outline(c);
	}
	function gym() {
		var c = cv(W, H), g = cx(c), r = rng(77), i, x;
		rect(g, 0, 0, W, 130, P.gymWall);
		rect(g, 0, 96, W, 34, P.gymPanel); rect(g, 0, 95, W, 1, P.gymPanelLine);
		for (x = 12; x < W; x += 24) rect(g, x, 96, 1, 34, P.gymPanelLine);
		rect(g, 0, 130, W, 50, P.gymFloor); rect(g, 0, 130, W, 2, P.gymFloorDark);
		for (i = 0; i < 240; i++) px(g, Math.floor(r() * W), 132 + Math.floor(r() * 48), r() < 0.5 ? P.gymSpeck : P.gymFloorDark);
		rect(g, 0, 168, W, 1, P.gymSpeck);
		g.drawImage(stuttgartView(100, 58), 116, 12);
		/* poster */
		var po = cv(50, 46), q = cx(po);
		rect(q, 0, 0, 50, 46, P.red); rect(q, 2, 2, 46, 42, P.redDark); rect(q, 3, 3, 44, 40, P.red);
		text(q, 'LEG', 25 - Math.floor(textW('LEG', 2) / 2), 6, P.white, 2);
		text(q, 'DAY', 25 - Math.floor(textW('DAY') / 2), 24, P.yellow);
		rect(q, 12, 36, 26, 2, P.ink); rect(q, 9, 33, 3, 8, P.ink); rect(q, 38, 33, 3, 8, P.ink);
		g.drawImage(outline(po), 242, 14);
		/* clock */
		var ck = cv(15, 15), k = cx(ck);
		disc(k, 7, 7, 7, P.white); rect(k, 7, 3, 1, 5, P.ink); rect(k, 7, 7, 3, 1, P.ink); px(k, 7, 1, P.grey); px(k, 13, 7, P.grey); px(k, 7, 13, P.grey); px(k, 1, 7, P.grey);
		g.drawImage(outline(ck), 88, 16);
		/* vending machine */
		var vm = cv(40, 92), v = cx(vm), cols = [P.purple, P.orange, P.teal, P.pink];
		rect(v, 0, 0, 40, 92, P.machine); rect(v, 0, 0, 40, 2, shade(P.machine, -0.0));
		rect(v, 3, 2, 34, 8, P.cream); text(v, 'SNACKS', 3, 3, P.redDark);
		rect(v, 3, 12, 26, 54, P.glassDark);
		for (var row = 0; row < 4; row++) {
			rect(v, 4, 23 + row * 12, 24, 1, P.greyDark);
			for (var col = 0; col < 4; col++) { rect(v, 5 + col * 6, 19 + row * 12, 5, 4, cols[(row + col) % 4]); px(v, 5 + col * 6, 19 + row * 12, P.greyLight); }
		}
		px(v, 5, 13, '#5a6a8a'); rect(v, 26, 13, 1, 20, '#3a4560');
		rect(v, 31, 12, 6, 22, P.greyLight); for (var bb = 0; bb < 4; bb++) rect(v, 32, 14 + bb * 4, 4, 2, P.greyDark);
		rect(v, 32, 38, 4, 1, P.ink);
		rect(v, 5, 72, 26, 10, '#11151f'); rect(v, 5, 72, 26, 1, P.ink);
		rect(v, 2, 88, 4, 4, P.ink); rect(v, 34, 88, 4, 4, P.ink);
		g.drawImage(outline(vm), 33, 60);
		/* dumbbell rack */
		var rk = cv(64, 40), d = cx(rk);
		rect(d, 2, 6, 3, 34, P.greyDark); rect(d, 59, 6, 3, 34, P.greyDark);
		rect(d, 0, 6, 64, 3, P.grey); rect(d, 0, 24, 64, 3, P.grey);
		[[6, 0], [20, 0], [34, 0], [48, 0], [8, 18], [24, 18], [40, 18]].forEach(function (db) {
			rect(d, db[0] + 2, db[1] + 3, 7, 2, P.greyLight); rect(d, db[0], db[1], 3, 6, P.ink); rect(d, db[0] + 8, db[1], 3, 6, P.ink);
		});
		g.drawImage(outline(rk), 252, 112);
		return c;
	}
	/* The pop-up stand: a folding table with a yellow skirt that carries the name and the price (drawn in front of the seller). */
	function gymTable() {
		var c = cv(70, 38), g = cx(c);
		rect(g, 0, 12, 70, 3, P.greyLight);
		rect(g, 2, 15, 66, 20, P.yellow); rect(g, 2, 33, 66, 2, P.yellowShade);
		text(g, 'BANANAS', 35 - Math.floor(textW('BANANAS') / 2), 17, P.redDark);
		text(g, '0,60€', 35 - Math.floor(textW('0,60€') / 2), 26, P.ink);
		rect(g, 6, 35, 2, 3, P.greyDark); rect(g, 62, 35, 2, 3, P.greyDark);
		return outline(c);
	}
	function proteinBar() { var c = cv(8, 3), g = cx(c); rect(g, 0, 0, 8, 3, P.purple); rect(g, 0, 0, 1, 3, P.greyLight); rect(g, 7, 0, 1, 3, P.greyLight); px(g, 3, 1, P.yellow); return outline(c); }

	/* ---------- Overlays ---------- */
	var bigBanana = single(40, 8, 8, BAN[0], 3);
	function drawTitle(g, t) {
		var b = Math.round(Math.abs(Math.sin(t * 3)) * 5);
		textBold(g, 'SELL THIS', center('SELL THIS', 3), 12, 3, P.white);
		textBold(g, 'BANANA!', center('BANANA!', 4), 40, 4, P.yellow);
		g.drawImage(bigBanana, 250, 14 - b);
	}
	/* Over a busy background (the gym) titles get a dark band behind them. */
	function band(g, y, h) { g.fillStyle = 'rgba(29, 33, 66, 0.78)'; g.fillRect(0, y, W, h); }
	function drawEnd(g, n, skipped, dark) {
		if (dark) band(g, 6, 70);
		textBold(g, 'LEVEL ' + n, center('LEVEL ' + n, 2), 12, 2, P.white);
		var w = skipped ? 'SKIPPED' : 'CLEAR!';
		textBold(g, w, center(w, 4), 32, 4, P.yellow);
	}
	function drawBanner(g, s, dark) { if (dark) band(g, 6, 34); textBold(g, s, center(s, 3), 14, 3, P.yellow); }

	/* ---------- Icons for the HUD and the cards (as data URLs) ---------- */
	var HEART = ['.HH...HH.', 'HhHH.HHHH', 'HhHHHHHHH', 'HHHHHHHHH', '.HHHHHHH.', '..HHHHH..', '...HHH...', '....H....'];
	function url(c) { try { return c.toDataURL('image/png'); } catch (e) { return ''; } }

	/* ---------- Build everything ---------- */
	var vendor = person(PEOPLE.vendor, 1, 'smile');
	var palmImg = palm();
	var kiosk = kioskLayers();
	var people = {};
	['seller', 'surfer', 'jogger', 'parent', 'member'].forEach(function (k) { people[k] = pack(person, PEOPLE[k], { x: 10, y: 19 }); });
	people.kid1 = pack(kid, KIDS.kid1, { x: 8, y: 13 });
	people.kid2 = pack(kid, KIDS.kid2, { x: 8, y: 13 });
	var board = surfboard();
	var items = { banana: single(6, 2, 1, BAN[0]), coconut: coconutItem(), bar: proteinBar() };
	var itemsL = { banana: flip(items.banana), coconut: flip(items.coconut), bar: flip(items.bar) };
	var bubbles = {}; Object.keys(EMO).forEach(function (k) { bubbles[k] = bubble(k); });

	window.STBArt = {
		W: W, H: H, P: P,
		beach: beach(palmImg),
		office: office(),
		gym: gym(), gymTable: gymTable(),
		kioskBack: kiosk.back, kioskFront: kiosk.front,
		coconutStand: coconutStand(vendor),
		bunch: [bunch(0), bunch(1), bunch(2), bunch(3)],
		people: people, board: board, boardL: flip(board),
		items: items, itemsL: itemsL, bubbles: bubbles,
		icons: {
			banana: [0, 1, 2, 3].map(function (s) { return url(single(12, 3, 2, BAN[s], 7)); }),
			ratingOn: url(single(20, 5, 4, BAN[0])),
			ratingOff: url(single(20, 5, 4, GREY)),
			heartOn: url(outline(grid(HEART, { H: P.red, h: '#ffb3ad' }))),
			heartOff: url(outline(grid(HEART, { H: '#4a4f7d', h: '#5d6290' }), '#151833'))
		},
		drawWaves: drawWaves, drawTitle: drawTitle, drawEnd: drawEnd, drawBanner: drawBanner
	};
})();
