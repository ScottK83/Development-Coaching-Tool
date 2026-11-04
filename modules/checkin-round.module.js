/* ========================================
   MENTAL HEALTH CHECK-IN ROUND
   Scott, 2026-11-04: "Can I do a Mental Health check in where I create a
   message where I copy and paste to each of them?"

   One message, written once, then handed over one associate at a time with
   their own first name in it. No numbers go in it on purpose: a check-in on
   how someone is doing is not a scorecard, and the private round already
   carries the numbers.

   The words are saved (and synced) so the same message can be finished on
   another computer. The ticks use the outreach send log under their own plan
   id, keyed by the round, so starting a new round starts the list over
   without wiping the last one's record.
   ======================================== */

(function () {
    'use strict';

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const STORAGE_KEY = PREFIX + 'checkinRound';
    const PLAN_ID = 'checkinround';

    // Starting points, not scripts. Each is plain, warm, has no numbers, no
    // promise the app can't keep (no "this stays between us", no time off),
    // and at most one emoji.
    const STARTERS = [
        {
            id: 'checkingIn',
            label: 'Just checking in',
            text: "Hi {first}, no numbers today. I just wanted to check in on you as a person. How are you doing, really? Work, home, all of it. If anything is weighing on you, I'm glad to listen. 💙"
        },
        {
            id: 'roughStretch',
            label: 'After a rough stretch',
            text: 'Hi {first}, the phones have been a lot lately, and I know some of those calls stay with you after you hang up. How are you holding up? If you want to talk it through, vent, or just chat for a few minutes, my door is open.'
        },
        {
            id: 'oneToFive',
            label: 'Quick 1 to 5',
            text: "Hi {first}, quick check-in from me. On a scale of 1 to 5, how are you feeling this week? No wrong answers, and you don't have to explain unless you want to. I just want to know how my people are doing."
        },
        {
            id: 'thanksFirst',
            label: 'Thank you first',
            text: "Hi {first}, I don't say it enough: thank you for everything you bring to this team. I also want to make sure you're doing okay outside of work. How are things going for you? If there's anything I can do to make your days a little easier, tell me. 🙂"
        }
    ];

    // {first} and {name} both mean the first name. Nobody writes a check-in
    // to "Dimes, Alyssa".
    const PLACEHOLDER = /\{\s*(first|first name|firstname|name)\s*\}/gi;

    function mods() { return window.DevCoachModules || {}; }

    function escapeHtml(value) {
        const shared = mods().sharedUtils?.escapeHtml;
        if (typeof shared === 'function') return shared(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * The name the message uses. A preferred name set in Settings wins, the
     * same as every other message the app writes. "Last, First" from an
     * export is turned the right way round.
     */
    function firstNameFor(fullName) {
        const name = String(fullName || '').trim();
        if (!name) return '';
        if (typeof window.getEmployeeNickname === 'function') {
            const nick = String(window.getEmployeeNickname(name) || '').trim();
            // getEmployeeNickname splits on a space, so "Dimes, Alyssa"
            // comes back as "Dimes,". Only trust it when it is a clean word.
            if (nick && nick.indexOf(',') === -1) return nick;
        }
        if (name.indexOf(',') !== -1) {
            const after = name.split(',')[1].trim().split(/\s+/)[0];
            if (after) return after;
        }
        return name.split(/\s+/)[0];
    }

    function personalize(text, fullName) {
        const first = firstNameFor(fullName) || 'there';
        return String(text || '').replace(PLACEHOLDER, first);
    }

    function todayIso() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // --- Saved state: { text, roundId, startedAt, updatedAt } ---

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed === 'object') {
                return {
                    text: typeof parsed.text === 'string' ? parsed.text : '',
                    roundId: typeof parsed.roundId === 'string' ? parsed.roundId : '',
                    startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
                    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
                };
            }
        } catch (e) { /* corrupt or blocked: start clean */ }
        return { text: '', roundId: '', startedAt: '', updatedAt: '' };
    }

    function saveState(next) {
        const state = { ...loadState(), ...(next || {}), updatedAt: new Date().toISOString() };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { /* storage full or blocked: the round still works this session */ }
        return state;
    }

    /**
     * The round being worked. The first time it is opened there isn't one
     * yet, so one is started on today's date with the first starter in the
     * box, rather than an empty box and no idea what goes in it.
     */
    function currentRound() {
        const state = loadState();
        if (state.roundId) return state;
        return saveState({
            text: state.text || STARTERS[0].text,
            roundId: todayIso(),
            startedAt: todayIso()
        });
    }

    /**
     * A fresh list. The old round's ticks stay in the send log under the old
     * round id, so they are not lost, they just stop counting here. The words
     * stay, since the usual reason to start over is to send the same thing
     * again a month later.
     */
    function startNewRound() {
        const stamp = new Date().toISOString();
        return saveState({ roundId: stamp, startedAt: todayIso() });
    }

    function sentState(roundId) {
        const outreach = mods().dailyOutreach;
        if (!outreach || !roundId) {
            return { isSent: () => false, sentAt: () => '', mark: () => {}, clear: () => {}, available: false };
        }
        return {
            available: true,
            isSent: (name) => Boolean(outreach.getSentEntry(outreach.loadSentLog(), PLAN_ID, roundId, name)),
            sentAt: (name) => outreach.getSentEntry(outreach.loadSentLog(), PLAN_ID, roundId, name)?.at || '',
            mark: (name) => outreach.markSent(PLAN_ID, roundId, name, new Date().toISOString()),
            clear: (name) => outreach.clearSent(PLAN_ID, roundId, name)
        };
    }

    /**
     * One row per person on the roster, alphabetical by first name since that
     * is how the Teams chat list reads. Pure apart from the send log.
     */
    function buildRound(text, roster, sent) {
        const ticks = sent || { isSent: () => false };
        return (roster || [])
            .map(name => String(name || '').trim())
            .filter(Boolean)
            .filter((name, idx, all) => all.indexOf(name) === idx)
            .map(name => ({
                name: name,
                first: firstNameFor(name),
                message: personalize(text, name),
                sent: Boolean(ticks.isSent(name)),
                edited: false
            }))
            .sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name));
    }

    function hasPlaceholder(text) {
        PLACEHOLDER.lastIndex = 0;
        const found = PLACEHOLDER.test(String(text || ''));
        PLACEHOLDER.lastIndex = 0;
        return found;
    }

    // --- Screen ---

    function copyClass(sent) {
        return 'cir-copy ' + (sent ? 'btn-ghost tone-good' : 'btn-secondary');
    }

    function formatStarted(iso) {
        const date = new Date(String(iso || '').slice(0, 10) + 'T12:00:00');
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function render(slot, options) {
        if (!slot) return;
        const opts = options || {};
        const roster = typeof opts.getRoster === 'function'
            ? (opts.getRoster() || [])
            : (mods().teamScope?.getMyTeamRoster?.() || []);

        if (!roster.length) {
            slot.innerHTML = `<div class="card text-secondary" style="padding:20px;">There is nobody on your roster yet. Add your team under Settings first.</div>`;
            return;
        }

        const state = currentRound();
        const sent = sentState(state.roundId);
        const rows = buildRound(state.text, roster, sent);
        const started = formatStarted(state.startedAt);

        const starterButtons = STARTERS.map(s =>
            `<button type="button" class="cir-starter btn-ghost" data-starter="${escapeHtml(s.id)}" style="padding:6px 12px; font-size:0.85em;">${escapeHtml(s.label)}</button>`
        ).join('');

        const rowHtml = rows.map((row, idx) =>
            `<div class="cir-row" data-idx="${idx}" style="border:1px solid ${row.sent ? 'var(--green)' : 'var(--border)'}; border-radius:10px; padding:12px 14px; background:var(--bg-surface); margin-bottom:10px; opacity:${row.sent ? '0.72' : '1'};">` +
                `<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">` +
                    `<strong style="color:var(--text-primary);">${escapeHtml(row.name)}</strong>` +
                    `<span class="cir-edited text-secondary" data-idx="${idx}" style="display:none; font-size:0.8em;">edited for them</span>` +
                    `<button type="button" class="${copyClass(row.sent)}" data-idx="${idx}" style="margin-left:auto; padding:8px 18px;">${row.sent ? '✓ Sent' : 'Copy'}</button>` +
                    `<button type="button" class="cir-undo btn-ghost" data-idx="${idx}" title="Mark as not sent" style="display:${row.sent ? 'inline-block' : 'none'}; padding:8px 12px;">↩</button>` +
                `</div>` +
                `<textarea class="cir-text" data-idx="${idx}" style="width:100%; min-height:96px; padding:10px; border:1px solid var(--border); border-radius:8px; font-size:0.9em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(row.message)}</textarea>` +
            `</div>`
        ).join('');

        slot.innerHTML = `<div class="card" style="padding:14px;">` +
            `<div style="display:flex; align-items:baseline; gap:10px; margin-bottom:6px; flex-wrap:wrap;">` +
                `<div class="card-title" style="margin:0;">Mental health check-in</div>` +
                `<div id="checkinRoundProgress" style="font-size:0.85em; color:var(--text-tertiary);"></div>` +
                `<button type="button" id="checkinRoundNew" class="btn-ghost" style="margin-left:auto; padding:6px 14px; font-size:0.85em;">Start a new round</button>` +
            `</div>` +
            `<div class="text-secondary" style="font-size:0.86em; margin-bottom:10px;">` +
                `Write it once. <strong>{first}</strong> becomes each person's first name. No numbers go in this one. ` +
                `Copy a message, paste it into their Teams chat, and it is ticked off. The ticks and the words are saved, so you can stop halfway and pick it up later.` +
            `</div>` +
            `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:8px;">` +
                `<span class="text-secondary" style="font-size:0.85em;">Start from:</span>${starterButtons}` +
            `</div>` +
            `<textarea id="checkinRoundText" style="width:100%; min-height:110px; padding:10px; border:1px solid var(--border); border-radius:8px; font-size:0.92em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(state.text)}</textarea>` +
            `<div id="checkinRoundHint" class="tone-warn" style="display:none; font-size:0.84em; margin:6px 0 0;">There is no {first} in it, so every copy reads the same. That is fine for a general note.</div>` +
            `<div style="margin-top:14px;">${rowHtml}</div>` +
        `</div>`;

        const textBox = slot.querySelector('#checkinRoundText');
        const hint = slot.querySelector('#checkinRoundHint');
        const progressEl = slot.querySelector('#checkinRoundProgress');

        const refreshProgress = () => {
            const done = rows.filter(r => r.sent).length;
            const since = started ? ` since ${started}` : '';
            if (progressEl) progressEl.textContent = `${done} of ${rows.length} sent${since}`;
        };
        const refreshHint = () => {
            if (hint) hint.style.display = textBox.value.trim() && !hasPlaceholder(textBox.value) ? 'block' : 'none';
        };

        const paintRow = (idx) => {
            const row = rows[idx];
            const card = slot.querySelector('.cir-row[data-idx="' + idx + '"]');
            const copyBtn = slot.querySelector('.cir-copy[data-idx="' + idx + '"]');
            const undoBtn = slot.querySelector('.cir-undo[data-idx="' + idx + '"]');
            if (card) {
                card.style.border = '1px solid ' + (row.sent ? 'var(--green)' : 'var(--border)');
                card.style.opacity = row.sent ? '0.72' : '1';
            }
            if (copyBtn) {
                copyBtn.textContent = row.sent ? '✓ Sent' : 'Copy';
                copyBtn.className = copyClass(row.sent);
            }
            if (undoBtn) undoBtn.style.display = row.sent ? 'inline-block' : 'none';
            refreshProgress();
        };

        // A message already sent keeps the words that went out, and one
        // edited for a single person keeps that edit.
        const applyText = (text) => {
            rows.forEach((row, idx) => {
                if (row.sent || row.edited) return;
                row.message = personalize(text, row.name);
                const box = slot.querySelector('.cir-text[data-idx="' + idx + '"]');
                if (box) box.value = row.message;
            });
        };

        let saveTimer = null;
        textBox.addEventListener('input', () => {
            applyText(textBox.value);
            refreshHint();
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => saveState({ text: textBox.value }), 400);
        });
        textBox.addEventListener('blur', () => {
            clearTimeout(saveTimer);
            saveState({ text: textBox.value });
        });

        slot.querySelectorAll('.cir-starter').forEach(btn => {
            btn.addEventListener('click', () => {
                const starter = STARTERS.find(s => s.id === btn.dataset.starter);
                if (!starter) return;
                textBox.value = starter.text;
                saveState({ text: starter.text });
                applyText(starter.text);
                refreshHint();
            });
        });

        slot.querySelectorAll('.cir-text').forEach(box => {
            box.addEventListener('input', () => {
                const idx = Number(box.dataset.idx);
                rows[idx].edited = true;
                rows[idx].message = box.value;
                const tag = slot.querySelector('.cir-edited[data-idx="' + idx + '"]');
                if (tag) tag.style.display = 'inline';
            });
        });

        slot.querySelectorAll('.cir-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.idx);
                const box = slot.querySelector('.cir-text[data-idx="' + idx + '"]');
                const value = box ? box.value : rows[idx].message;
                if (typeof window.copyToClipboard === 'function') {
                    window.copyToClipboard(value, { message: `Copied for ${rows[idx].first || rows[idx].name}` });
                }
                // Copying is the send, same as the high five round: nothing
                // else happens between the clipboard and the chat window.
                rows[idx].sent = true;
                sent.mark(rows[idx].name);
                paintRow(idx);
            });
        });

        slot.querySelectorAll('.cir-undo').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.idx);
                rows[idx].sent = false;
                sent.clear(rows[idx].name);
                paintRow(idx);
            });
        });

        slot.querySelector('#checkinRoundNew')?.addEventListener('click', () => {
            saveState({ text: textBox.value });
            startNewRound();
            render(slot, options);
        });

        refreshProgress();
        refreshHint();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.checkinRound = {
        STORAGE_KEY,
        PLAN_ID,
        STARTERS,
        firstNameFor,
        personalize,
        hasPlaceholder,
        loadState,
        saveState,
        currentRound,
        startNewRound,
        sentState,
        buildRound,
        render
    };
})();
