/*
	ARTEX explainer: shared script for maliciousagents.html (EN) and maliciousagents-de.html (DE).
	Every text the widgets show comes from the page's own JSON block, <script type="application/json" id="ma-strings">,
	so a content change goes into that block on both pages. This file only holds the logic.
	Templates use {placeholders}; keys ending in _one / _other are the singular and plural forms.
*/
(function () {
	"use strict";
	var root = document.getElementById('ma-module');
	var data = document.getElementById('ma-strings');
	if (!root || !data) return;
	var S;
	try { S = JSON.parse(data.textContent); } catch (e) { return; }
	var announcer = document.getElementById('ma-announce');
	function announce(x) { if (announcer) { announcer.textContent = ''; announcer.textContent = x; } }
	function byId(id) { return document.getElementById(id); }
	function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	// Fill {placeholders} in a template.
	function t(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && Object.prototype.hasOwnProperty.call(v, k) ? v[k] : m; }); }
	// Pick base_one or base_other by n, then fill it (n is always available as {n}).
	function pl(obj, base, n, v) { var o = { n: n }; for (var k in v) o[k] = v[k]; return t(obj[base + (n === 1 ? '_one' : '_other')], o); }

	/* ========== Widget A: the agent loop ========== */
	(function () {
		var wrap = byId('ma-loop'); if (!wrap || !S.loop) return;
		var L = S.loop;
		var STEPS = L.steps;
		// Engines: a model refuses a request once the break-in signal it can see reaches its threshold.
		// A is strict, B is in between, C is permissive and never refuses. Display names come from L.models.
		var MODELS = { A: 1, B: 2, C: Infinity };
		// Agent team mode: the agents run the loop by themselves. The goal line is yours, so it isn't counted as one of its steps.
		// ask = the one small step the model is shown (none for notebook lines: that's the framework, not the model).
		// sig = how much of a break-in the model can see in that one step. Only the garage push looks rough on its own.
		var LINES = L.lines;
		// Chatbot mode: it only plans. You do the legwork (Act, Check, Note) and report back each time.
		// Every message carries the whole chat, so each "it opens" you report adds to the break-in signal.
		var OPENINGS = L.openings;
		var PHASE_STEP = { act: 2, check: 3, note: 4 };
		var NEXT_PHASE = { act: 'check', check: 'note', note: 'report' };
		var stepBtns = wrap.querySelectorAll('.ma-step');
		var modelBtns = wrap.querySelectorAll('.ma-model');
		var engineSeg = modelBtns[0].parentNode;
		var bChat = byId('ma-loop-chatbot'), bAgent = byId('ma-loop-agent');
		var socket = byId('ma-loop-socket'), sees = byId('ma-loop-sees'), crew = byId('ma-loop-crew'), log = byId('ma-loop-log'), hint = byId('ma-loop-hint');
		var cAuto = byId('ma-loop-auto'), cMine = byId('ma-loop-mine'), cAsked = byId('ma-loop-asked'), cRefused = byId('ma-loop-refused');
		var bRun = byId('ma-loop-run'), bStep = byId('ma-loop-step'), bReset = byId('ma-loop-reset');
		var st = {
			mode: 'chatbot', model: 'A', idx: 0, auto: 0, mine: 0, asked: 0, refusals: 0, timer: null,
			phase: 'ask', opening: 0, after: 'act', pending: false, chat: 0, ways: 0, reported: 0, refused: false, resume: false
		};

		function name() { return L.models[st.model]; }
		function tag(who) { return L.tags[who] || who; }
		function refuses(sig) { return sig >= MODELS[st.model]; }
		function highlight(s) {
			for (var i = 0; i < stepBtns.length; i++) stepBtns[i].classList.toggle('is-active', i === s);
		}
		// Ring the chip (0–4), the main button ('run') or the engine picker ('engine') the reader needs next; null clears it.
		function cue(target) {
			for (var i = 0; i < stepBtns.length; i++) stepBtns[i].classList.toggle('is-next', i === target);
			bRun.classList.toggle('is-next', target === 'run');
			engineSeg.classList.toggle('is-next', target === 'engine');
		}
		function addLine(who, text, cls) {
			var li = document.createElement('li');
			if (cls) li.className = cls;
			if (who) { var el = document.createElement('span'); el.className = 'ma-tag'; el.textContent = '[' + who + ']'; li.appendChild(el); }
			li.appendChild(document.createTextNode(text));
			log.appendChild(li); log.scrollTop = log.scrollHeight;
		}
		function clearWait() { var w = log.querySelector('.ma-wait'); if (w) w.parentNode.removeChild(w); }
		function wait(text) { clearWait(); addLine('', '⏸ ' + text, 'ma-wait'); }
		function say(text) { crew.textContent = text; }
		function setCounts() { cAuto.textContent = st.auto; cMine.textContent = st.mine; cAsked.textContent = st.asked; cRefused.textContent = st.refusals; }
		function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }
		function startTimer() { st.timer = setInterval(function () { if (!agentStep(true)) { stopTimer(); syncButtons(); } }, 700); }
		function finished() { return st.mode === 'agent' ? st.idx >= LINES.length : st.phase === 'done'; }
		function started() { return st.mode === 'agent' ? st.idx > 0 && !finished() : st.phase !== 'ask' && st.phase !== 'write' && st.phase !== 'done'; }
		function refusalsText(n) { return n === 1 ? L.refusals_one : (n === 2 ? L.refusals_two : t(L.refusals_other, { n: n })); }

		// "What the model sees": the whole chat in chatbot mode, one labelled step in agent team mode.
		function seesIdle() { sees.textContent = t(L.sees.idle, { model: name() }); }
		function seesChat() {
			sees.textContent = t(L.sees.chat, { model: name(), messages: pl(L.sees, 'messages', st.chat), ways: st.ways });
		}
		function seesStep(i) {
			var ln = LINES[i];
			if (!ln.ask) { sees.textContent = t(L.sees.notebook, { model: name() }); return; }
			sees.textContent = t(L.sees.step, { model: name(), ask: ln.ask, pos: ln.done ? L.sees.finalStep : t(L.sees.stepOf, { i: i + 1, n: LINES.length - 1 }) });
		}

		function syncButtons() {
			if (st.mode === 'chatbot') {
				bRun.textContent = st.phase === 'ask' ? L.btn.ask : (st.phase === 'done' ? L.btn.done : (st.phase === 'retell' ? L.btn.retell : (st.phase === 'write' ? L.btn.write : L.btn.report)));
				bRun.disabled = !(st.phase === 'ask' || st.phase === 'report' || st.phase === 'retell' || st.phase === 'write');
				bStep.hidden = true;
			} else {
				bRun.textContent = st.timer ? L.btn.pause : (finished() ? L.btn.runAgain : L.btn.run);
				bRun.disabled = st.refused;
				bStep.hidden = false;
				bStep.disabled = finished() || !!st.timer || st.refused;
			}
		}

		function reset() {
			stopTimer();
			st.idx = 0; st.auto = 0; st.mine = 0; st.asked = 0; st.refusals = 0; st.phase = 'ask'; st.opening = 0; st.after = 'act';
			st.pending = false; st.chat = 0; st.ways = 0; st.reported = 0; st.refused = false; st.resume = false;
			setModel('A', true);
			log.innerHTML = ''; setCounts(); highlight(-1); cue(null);
			if (st.mode === 'agent') {
				addLine(tag('you'), L.goal, 'is-goal');
				hint.textContent = L.hint.agentStart;
				say(L.crew.agentStart);
			} else {
				hint.textContent = L.hint.chatStart;
				say(L.crew.chatStart);
				cue('run');
			}
			syncButtons();
		}

		/* ---- Agent mode ---- */
		function agentDoneHint() {
			var s = t(L.agentDone.lead, { n: st.auto });
			if (!st.refusals) return s + t(L.agentDone.none, { model: name() });
			return s + t(L.agentDone.refused, { refusals: refusalsText(st.refusals) });
		}
		function agentStep(quiet) {
			if (st.mode !== 'agent' || finished() || st.refused) return false;
			var i = st.idx, ln = LINES[i];
			highlight(ln.s); seesStep(i);
			if (ln.ask && refuses(ln.sig || 0)) {
				st.resume = !!st.timer; stopTimer();
				st.refused = true; st.refusals += 1; st.asked += 1;
				addLine(name(), ln.refuse, 'is-refused');
				wait(t(L.wait.agentRefused, { model: name() }));
				cue('engine'); setCounts();
				say(L.crew.agentRefused);
				hint.textContent = st.resume ? L.hint.agentRefusedRun : L.hint.agentRefusedStep;
				syncButtons();
				announce(t(L.announce.agentRefused, { model: name(), refuse: ln.refuse }));
				return false;
			}
			st.idx += 1;
			addLine(tag(ln.who), ln.t, ln.done ? 'is-goal' : '');
			if (ln.done) st.asked += 1; else st.auto += 1;
			setCounts();
			if (!quiet) announce(t(L.announce.line, { who: tag(ln.who), text: ln.t }));
			if (finished()) {
				stopTimer();
				hint.textContent = agentDoneHint();
				announce(t(L.announce.agentDone, { n: st.auto }));
			}
			syncButtons();
			return !finished();
		}

		/* ---- Chatbot mode ---- */
		function nextMoveText() {
			if (st.phase === 'report') return L.next.report;
			if (st.phase === 'refused') return L.next.refused;
			if (st.phase === 'retell') return L.next.retell;
			if (st.phase === 'write') return L.next.write;
			return t(L.next.step, { step: STEPS[PHASE_STEP[st.phase]].name });
		}
		function yourMove() {
			if (st.phase === 'refused') {
				wait(t(L.wait.chatRefused, { model: name() }));
				cue('engine');
				say(t(L.crew.chatRefused, { model: name() }));
				hint.textContent = L.hint.chatRefused;
			} else if (st.phase === 'retell') {
				wait(t(L.wait.retell, { model: name() }));
				cue('run');
				say(t(L.crew.retell, { model: name() }));
				hint.textContent = L.hint.retell;
			} else if (st.phase === 'report') {
				wait(L.wait.report);
				cue('run');
				say(t(L.crew.report, { opening: OPENINGS[st.opening].name }));
				hint.textContent = L.hint.report;
			} else if (st.phase === 'write') {
				wait(L.wait.write);
				cue('run');
				say(L.crew.write);
				hint.textContent = L.hint.write;
			} else {
				var n = PHASE_STEP[st.phase];
				wait(t(L.wait.step, { step: STEPS[n].name }));
				cue(n);
				say(t(L.crew.step, { step: STEPS[n].name }));
			}
		}
		function chatDoneHint() {
			var s = t(L.chatDone.lead, { mine: st.mine, asked: st.asked });
			if (st.refusals === 1) s += L.chatDone.one;
			else if (st.refusals) s += t(L.chatDone.many, { refusals: refusalsText(st.refusals) });
			else s += t(L.chatDone.none, { model: name() });
			return s + L.chatDone.end;
		}
		// You've just sent a message: the model reads the whole chat and either refuses or answers.
		function chatRefuse() {
			var text = L.refuse[st.model];
			highlight(1); addLine(name(), text, 'is-refused');
			st.chat += 1; st.refusals += 1; st.phase = 'refused';
			setCounts(); yourMove(); syncButtons();
			announce(t(L.announce.chatRefused, { model: name(), text: text }));
		}
		function chatAnswer(bot, advance) {
			highlight(1); addLine(tag('chatbot'), bot); st.chat += 1;
			if (advance) st.opening += 1;
			if (st.opening >= OPENINGS.length) {
				st.phase = 'write'; yourMove();
			} else {
				st.phase = advance ? 'act' : st.after; yourMove();
				if (st.phase === 'act') hint.textContent = t(L.hint.sameRoutine, { opening: OPENINGS[st.opening].name });
			}
			setCounts(); syncButtons();
			announce(t(L.announce.chatbot, { text: bot }) + (st.phase === 'write' ? ' ' + L.announce.writeCue : ''));
		}
		// The last job the chatbot hands back: writing up the report. (In agent team mode, the lead hands you a finished one.)
		function chatWrite() {
			if (st.mode !== 'chatbot' || st.phase !== 'write') return;
			var text = L.writeReport;
			clearWait(); highlight(0);
			addLine(tag('you'), text, 'is-you');
			st.mine += 1; st.phase = 'done'; cue(null);
			say(L.crew.done);
			hint.textContent = chatDoneHint();
			setCounts(); syncButtons();
			announce(t(L.announce.youDone, { text: text }));
		}
		function chatAsk() {
			if (st.mode !== 'chatbot' || st.phase !== 'ask') return;
			clearWait();
			addLine(tag('you'), L.ask, 'is-you');
			st.asked += 1; st.chat = 1; st.opening = 0; seesChat();
			highlight(1); addLine(tag('chatbot'), L.botFirst); st.chat += 1;
			st.phase = 'act';
			setCounts(); yourMove();
			hint.textContent = L.hint.legwork;
			syncButtons();
			announce(t(L.announce.asked, { text: L.botFirst }));
		}
		function nudge(text) { say(text); announce(text); }
		function chatDo(n) {
			if (st.phase === 'ask') {
				if (n === 0) { chatAsk(); return; }
				nudge(L.nudge.firstGoal); return;
			}
			if (st.phase === 'done') { nudge(L.nudge.allDone); return; }
			if (st.phase === 'refused') { nudge(t(L.nudge.refusedFirst, { model: name() })); return; }
			if (st.phase === 'retell') { nudge(L.nudge.retellFirst); return; }
			if (st.phase === 'write') { nudge(L.nudge.writeFirst); return; }
			if (n === 0) { nudge(t(L.nudge.goalGiven, { next: nextMoveText() })); return; }
			if (n === 1) { nudge(t(L.nudge.planPart, { next: nextMoveText() })); return; }
			if (st.phase === 'report') { nudge(t(L.nudge.reportFirst, { opening: OPENINGS[st.opening].name })); return; }
			var want = PHASE_STEP[st.phase];
			if (n !== want) { nudge(t(L.nudge.notYet, { step: STEPS[want].name })); return; }
			var text = OPENINGS[st.opening][st.phase];
			clearWait(); highlight(n);
			addLine(tag('you'), text, 'is-you');
			st.mine += 1; st.phase = NEXT_PHASE[st.phase];
			setCounts(); yourMove(); syncButtons();
			announce(t(L.announce.you, { text: text, next: nextMoveText() }));
		}
		function chatReport() {
			if (st.mode !== 'chatbot' || st.phase !== 'report') return;
			var op = OPENINGS[st.opening];
			clearWait();
			addLine(tag('you'), op.report, 'is-you');
			st.asked += 1; st.chat += 1; st.reported = st.opening + 1;
			if (op.opens) st.ways += 1;
			seesChat();
			if (refuses(st.ways)) { st.pending = true; chatRefuse(); return; }
			chatAnswer(L.botAfter[st.opening], true);
		}
		// After a swap: a new chat, so you tell the new model the whole story again.
		function chatRetell() {
			if (st.mode !== 'chatbot' || st.phase !== 'retell') return;
			var found = [];
			for (var i = 0; i < st.reported; i++) found.push(OPENINGS[i].found);
			var list = found.join(', ');
			// German capitalises a full sentence after a colon; English doesn't.
			if (L.capFound && list) list = list.charAt(0).toUpperCase() + list.slice(1);
			var text = found.length ? t(L.retellSoFar, { found: list }) : L.retellFresh;
			clearWait();
			addLine(tag('you'), text, 'is-you');
			st.asked += 1; st.chat = 1; seesChat();
			if (refuses(st.ways)) { chatRefuse(); return; }
			if (st.pending) { st.pending = false; chatAnswer(L.botAfter[st.opening], true); return; }
			chatAnswer(t(L.botCarryOn, { opening: OPENINGS[st.opening].name }), false);
		}

		function setMode(m, silent) {
			st.mode = m;
			bChat.setAttribute('aria-pressed', m === 'chatbot');
			bAgent.setAttribute('aria-pressed', m === 'agent');
			reset();
			if (!silent) announce(m === 'chatbot' ? L.announce.modeChat : L.announce.modeAgent);
		}
		function setModel(m, silent) {
			if (!silent && m === st.model) return;
			st.model = m; socket.textContent = t(L.socket, { model: name() });
			for (var i = 0; i < modelBtns.length; i++) modelBtns[i].setAttribute('aria-pressed', modelBtns[i].getAttribute('data-m') === m);
			if (silent) { seesIdle(); return; }
			if (!started()) {
				seesIdle();
				if (log.children.length) addLine('', t(L.swap.idle, { model: name() }), 'is-dim');
				announce(t(L.announce.swappedIdle, { model: name() }));
				return;
			}
			// Mid-job, swapping is a step you take yourself.
			st.mine += 1; clearWait(); cue(null);
			if (st.mode === 'agent') {
				var was = st.refused;
				st.refused = false;
				addLine('', t(was ? L.swap.afterRefusal : L.swap.midRun, { model: name() }), 'is-dim');
				setCounts();
				if (was) {
					say(L.crew.swapped);
					hint.textContent = st.resume ? L.hint.resumeRun : L.hint.resumeStep;
					if (st.resume) startTimer();
					st.resume = false;
				}
				syncButtons();
				announce(t(L.announce.swappedAgent, { model: name() }));
				return;
			}
			if (st.phase !== 'refused' && st.phase !== 'retell') st.after = st.phase;
			st.phase = 'retell'; st.chat = 0; seesIdle();
			addLine('', t(L.swap.newChat, { model: name() }), 'is-dim');
			setCounts(); yourMove(); syncButtons();
			announce(t(L.announce.newChat, { model: name() }));
		}

		for (var i = 0; i < stepBtns.length; i++) {
			(function (n) {
				stepBtns[n].addEventListener('click', function () {
					if (st.mode === 'chatbot') { chatDo(n); return; }
					highlight(n); say(t(L.stepCrew, { name: STEPS[n].name, crew: STEPS[n].crew })); announce(STEPS[n].crew);
				});
			})(i);
		}
		for (var j = 0; j < modelBtns.length; j++) {
			(function (b) { b.addEventListener('click', function () { setModel(b.getAttribute('data-m')); }); })(modelBtns[j]);
		}
		bChat.addEventListener('click', function () { setMode('chatbot'); });
		bAgent.addEventListener('click', function () { setMode('agent'); });
		bStep.addEventListener('click', function () { agentStep(false); });
		bReset.addEventListener('click', function () { reset(); });
		bRun.addEventListener('click', function () {
			if (st.mode === 'chatbot') {
				if (st.phase === 'ask') chatAsk(); else if (st.phase === 'retell') chatRetell(); else if (st.phase === 'write') chatWrite(); else chatReport();
				return;
			}
			if (st.refused) return;
			if (st.timer) { stopTimer(); syncButtons(); return; }
			if (finished()) reset();
			announce(L.announce.running);
			startTimer();
			syncButtons();
		});
		setMode('chatbot', true);
	})();

	/* ========== Widget C: the slider ========== */
	(function () {
		var wrap = byId('ma-drive'); if (!wrap || !S.drive) return;
		var D = S.drive;
		var STOPS = D.stops;
		var range = byId('ma-drive-range'), nameEl = byId('ma-drive-name'), note = byId('ma-drive-note');
		function setBar(id, pct) { byId(id).style.width = Math.max(0, Math.min(100, pct)) + '%'; }
		function render(i) {
			var s = STOPS[i];
			nameEl.innerHTML = esc(s.name) + (s.here ? ' <span class="ma-here">' + esc(D.here) + '</span>' : '');
			byId('ma-drive-speed-v').textContent = s.speed[0]; setBar('ma-drive-speed-f', s.speed[1]);
			byId('ma-drive-targets-v').textContent = s.targets[0]; setBar('ma-drive-targets-f', s.targets[1]);
			byId('ma-drive-skill-v').textContent = s.skill[0]; setBar('ma-drive-skill-f', s.skill[1]);
			byId('ma-drive-noise-v').textContent = s.noise[0]; setBar('ma-drive-noise-f', s.noise[1]);
			// The notes are authored HTML (a footnote span), written by the page, not by readers.
			note.innerHTML = i === STOPS.length - 1 ? D.noteEnd : D.noteStart;
			announce(t(D.announce, { stop: s.name, speed: s.speed[0], targets: s.targets[0], skill: s.skill[0], noise: s.noise[0] }));
		}
		range.addEventListener('input', function () { render(+range.value); });
		render(0);
	})();

	/* ========== Widget D: worth it or theatre ========== */
	(function () {
		var wrap = byId('ma-sort'); if (!wrap || !S.sort) return;
		var R = S.sort;
		// Built on CERT-EU's ARTEX advice: five of its actions in plain words, and five near-misses whose feedback names CERT-EU's fix.
		// when = CERT-EU's own time frame (Immediate / Short-term / Continuously). Order is mixed, and no near-miss sits next to its own fix.
		var CARDS = R.cards;
		var cardsEl = byId('ma-sort-cards'), scoreEl = byId('ma-sort-score'), resetBtn = byId('ma-sort-reset');
		var answered = 0, right = 0;
		function build() {
			answered = 0; right = 0; cardsEl.innerHTML = ''; scoreEl.hidden = true; resetBtn.hidden = true;
			CARDS.forEach(function (c) {
				var card = document.createElement('div'); card.className = 'ma-card';
				card.innerHTML = '<p class="ma-card-text">' + esc(c.t) + '</p>' +
					'<div class="ma-card-actions" role="group" aria-label="' + esc(c.t) + '">' +
					'<button type="button" class="ma-pick" data-v="1">' + esc(R.yes) + '</button>' +
					'<button type="button" class="ma-pick" data-v="0">' + esc(R.no) + '</button>' +
					'</div>';
				var btns = card.querySelectorAll('.ma-pick');
				Array.prototype.forEach.call(btns, function (b) {
					b.addEventListener('click', function () {
						var said = b.getAttribute('data-v') === '1';
						var ok = said === c.helps;
						Array.prototype.forEach.call(btns, function (x) { x.disabled = true; });
						card.classList.add(ok ? 'is-correct' : 'is-wrong');
						var why = document.createElement('p'); why.className = 'ma-why';
						why.innerHTML = '<span class="ma-verdict">' + esc(ok ? R.right : R.wrong) + ' </span>' +
							esc(c.helps ? R.helps : R.fallsShort) + ' ' + esc(c.why) +
							' <span class="ma-when">' + esc(t(c.helps ? R.whenHelps : R.whenFix, { when: c.when })) + '</span>';
						card.appendChild(why);
						answered += 1; if (ok) right += 1;
						announce((ok ? R.announceRight : R.wrong) + ' ' + c.why);
						if (answered === CARDS.length) {
							scoreEl.textContent = t(R.score, { r: right, n: CARDS.length });
							scoreEl.hidden = false; resetBtn.hidden = false;
						}
					});
				});
				cardsEl.appendChild(card);
			});
		}
		resetBtn.addEventListener('click', function () { build(); });
		build();
	})();

	/* ========== Widget E: quick check ========== */
	(function () {
		var wrap = byId('ma-quiz'); if (!wrap || !S.quiz) return;
		var QUIZ = S.quiz.items;
		var scoreEl = byId('ma-quiz-score');
		var answered = 0, right = 0;
		QUIZ.forEach(function (item, qi) {
			var box = document.createElement('div'); box.className = 'ma-q';
			box.innerHTML = '<p class="ma-q-title" id="ma-q' + qi + '">' + (qi + 1) + '. ' + esc(item.q) + '</p>' +
				'<div class="ma-options" role="group" aria-labelledby="ma-q' + qi + '"></div><div class="ma-feedback" hidden></div>';
			var opts = box.querySelector('.ma-options'), fb = box.querySelector('.ma-feedback');
			item.options.forEach(function (o) {
				var b = document.createElement('button');
				b.type = 'button'; b.className = 'ma-option'; b.textContent = o[1];
				b.addEventListener('click', function () {
					var ok = o[0] === item.correct;
					Array.prototype.forEach.call(opts.children, function (x, k) {
						x.disabled = true;
						if (item.options[k][0] === item.correct) x.classList.add('is-correct');
					});
					if (!ok) b.classList.add('is-wrong');
					fb.className = 'ma-feedback ' + (ok ? 'is-correct' : 'is-wrong');
					fb.innerHTML = esc(item.fb[o[0]]) + (ok ? '' : ' <a href="' + esc(item.back) + '">' + esc(S.quiz.back) + '</a>');
					fb.hidden = false;
					announce(item.fb[o[0]]);
					answered += 1; if (ok) right += 1;
					if (answered === QUIZ.length) { scoreEl.textContent = t(S.quiz.score, { r: right, n: QUIZ.length }); scoreEl.hidden = false; }
				});
				opts.appendChild(b);
			});
			wrap.appendChild(box);
		});
	})();

})();
