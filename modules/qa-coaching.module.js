/**
 * QA Coaching (People > Follow Up > QA Coaching)
 *
 * Scott, 2026-10-27: QA sends him coaching sessions in Verint ("Manage
 * Coaching Session", Process Accuracy QA). He wants to paste one in, or type
 * the associate, reason and QA notes, and get the email to the associate, a
 * Copilot prompt, and the Meeting Summary to paste back into Verint. He also
 * wants to know whether they read it, so every email sent is kept in the
 * follow-up history as Sent until he marks it Read.
 *
 * The QA score is read by nobody: Scott asked for it to stay out of the email
 * (10/27), and Verint already holds it.
 */
(function () {
    'use strict';

    window.DevCoachModules = window.DevCoachModules || {};

    // The reasons QA has sent so far, in the order they are tried. "Wrong
    // plan" goes before "not reviewed" because a note about the wrong plan
    // usually mentions reviewing it too. The steps are what the associate is
    // asked to do next time, in plain words.
    const REASONS = [
        {
            key: 'rate-plan-wrong',
            label: 'Wrong rate plan selected',
            subject: 'Confirming the rate plan',
            match: /\b(incorrect|wrong)\b[^.]*\brate plan|\brate plan\b[^.]*\b(incorrect|wrong)\b|selected instead/i,
            note: 'The rate plan on the order was not the one the customer asked for.',
            steps: [
                'Before you submit a start service order, confirm the rate plan the customer chose.',
                'Read the rate confirmation script in your recap on every start service order, so the customer hears their plan one more time.'
            ]
        },
        {
            key: 'rate-plan-review',
            label: 'Rate plan not reviewed with the customer',
            subject: 'Reviewing rate plans',
            match: /\brate plans?\b/i,
            note: 'The rate plans were not reviewed with the customer before one was selected.',
            steps: [
                'On every start service order, give the customer a quick overview of the rate plans and let them choose. We never pick a plan for them.',
                'Read the rate confirmation script in your recap so the customer confirms the plan they chose.'
            ]
        },
        {
            key: 'fcr-payment-arrangement',
            label: 'Missed first call resolution on a payment arrangement',
            subject: 'Payment arrangements on the first call',
            match: /(\bFCR\b|first call resol)[\s\S]*(\bPA\b|payment arrangement)|(\bPA\b|payment arrangement)[\s\S]*(\bFCR\b|first call resol)/i,
            note: 'There was a chance to fix the payment arrangement on this call.',
            steps: [
                'When a customer says they cannot pay by the arrangement date, check whether the current arrangement will break.',
                'If it will, cancel it and set up a new arrangement on what is due now.',
                'Let the customer know when their next bill will generate, so it does not catch them off guard.'
            ]
        },
        {
            key: 'fcr',
            label: 'Missed first call resolution',
            subject: 'Resolving it on the first call',
            match: /\bFCR\b|first call resol/i,
            note: 'There was a chance to fully resolve what the customer needed on this call.',
            steps: [
                'Before you wrap up, think about what would bring this customer back, and take care of it now if you can.',
                'Recap what you did and what happens next, so the customer leaves the call with everything they need.'
            ]
        },
        {
            key: 'other',
            label: 'Something else',
            subject: 'QA feedback on a recent call',
            match: null,
            note: '',
            steps: []
        }
    ];

    const DEFAULT_PRAISE = 'Thank you for the care you put into your calls.';
    const REPLY_ASK = 'Please reply with a quick "Got it" once you have read this, so I know it reached you.';
    const CLOSER = 'Come find me if you want to talk any of it through. I am here to help.';

    // The labels on Verint's "Manage Coaching Session" page. A line that
    // starts with one of these ends the value above it.
    const LABELS = [
        'Session ID', 'Employee(s)', 'Organization Name', 'Creation Date', 'Assigned By', 'Topic',
        'Reason', 'Coaching Session Type', 'Coach', 'Status', 'Due Date', 'Select Date',
        'Follow-up Date', 'Result', 'Completion Date', 'Schedule Details', 'Date and Time',
        'Duration (minutes)', 'Location', 'Schedule in WFM', 'Attachments', 'Evaluation',
        'Meeting Summary', 'Employee Feedback'
    ];

    const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function escapeRegex(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const LABEL_PATTERNS = LABELS.map(label => ({
        label,
        re: new RegExp('^' + escapeRegex(label) + '(?=\\s|$)', 'i')
    }));

    function labelOf(line) {
        const trimmed = String(line || '').trim();
        const hit = LABEL_PATTERNS.find(entry => entry.re.test(trimmed));
        return hit ? hit.label : '';
    }

    // "10/09/2026" to "2026-10-09". Anything else is left empty rather than
    // guessed at.
    function toIsoDate(text) {
        const match = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(text || ''));
        if (!match) return '';
        return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    }

    function shortDate(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!match) return '';
        return `${SHORT_MONTHS[parseInt(match[2], 10) - 1]} ${parseInt(match[3], 10)}`;
    }

    function todayIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Verint writes "Ingram, Oceane"; the app's pickers hold "Oceane Ingram".
    function toDisplayName(name) {
        const clean = String(name || '').replace(/\s+/g, ' ').trim();
        if (!clean.includes(',')) return clean;
        const [last, first] = clean.split(',').map(part => part.trim());
        return [first, last].filter(Boolean).join(' ');
    }

    // Same idea as callTranscript.matchAssociateOption: the name's words,
    // sorted, so either spelling finds the other.
    function nameKey(name) {
        return String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    }

    function matchAssociate(options, name) {
        const target = nameKey(name);
        if (!target) return '';
        return (options || []).find(option => nameKey(option) === target) || '';
    }

    // Verint's category in front of the reason, "Process Accuracy - ". Only
    // capitalised words count, so a sentence that happens to contain a dash
    // ("There was an opportunity for FCR - customer said") keeps its start.
    const CATEGORY_PREFIX = /^\s*((?:[A-Z][a-z]+|[A-Z]{2,})(?: (?:[A-Z][a-z]+|[A-Z]{2,}|&|and)){0,4})\s+[-–—]\s+/;
    const SPACED_DASH = /\s+[-–—―]+\s+/g;
    const LONG_DASH = /[–—―]/g;

    /**
     * QA's note as the associate should read it: Verint's category prefix
     * comes off, dashes become commas, and "w/" is spelled out. QA's own
     * words are otherwise kept.
     */
    function cleanQaNote(text) {
        let note = String(text || '').replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const prefix = CATEGORY_PREFIX.exec(note);
        if (prefix) note = note.slice(prefix[0].length);
        note = note
            .replace(SPACED_DASH, ', ')
            .replace(LONG_DASH, ', ')
            .replace(/\bw\/\s*/gi, 'with ')
            .replace(/,\s*([,.!?;:])/g, '$1')
            .trim();
        return note ? note.charAt(0).toUpperCase() + note.slice(1) : '';
    }

    function categoryOf(text) {
        const match = CATEGORY_PREFIX.exec(String(text || ''));
        return match ? match[1].trim() : '';
    }

    function reasonFor(key) {
        return REASONS.find(reason => reason.key === key) || REASONS[REASONS.length - 1];
    }

    function classifyReason(text) {
        const value = String(text || '');
        const hit = REASONS.find(reason => reason.match && reason.match.test(value));
        return hit ? hit.key : 'other';
    }

    /**
     * Reads one or several pasted "Manage Coaching Session" pages.
     *
     * Each value sits after its label, either on the same line after a tab or
     * on the lines below it, up to the next label. A session with two
     * associates in it comes back as one session each.
     */
    function parseSessions(raw) {
        const text = String(raw || '').replace(/\r\n?/g, '\n');
        if (!text.trim()) return [];

        const chunks = /Manage Coaching Session/i.test(text)
            ? text.split(/Manage Coaching Session:?/i)
            : [text];

        const sessions = [];
        chunks.forEach(chunk => {
            const lines = chunk.split('\n');

            function valueLines(label) {
                const re = LABEL_PATTERNS.find(entry => entry.label === label).re;
                const at = lines.findIndex(line => re.test(line.trim()));
                if (at < 0) return [];
                const sameLine = lines[at].trim().slice(label.length).trim();
                if (sameLine) return [sameLine];
                const out = [];
                for (let i = at + 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (labelOf(line)) break;
                    if (line) out.push(line);
                }
                return out;
            }

            function lineValue(prefix) {
                const re = new RegExp('^\\s*' + escapeRegex(prefix) + '\\s*:?\\s*(.+)$', 'im');
                const match = re.exec(chunk);
                return match ? match[1].replace(/\t.*$/, '').trim() : '';
            }

            const employees = valueLines('Employee(s)').filter(line => /[A-Za-z]/.test(line));
            const sessionId = (valueLines('Session ID')[0] || '').replace(/[^\d]/g, '');
            if (!employees.length && !sessionId) return;

            const reasonText = valueLines('Reason').join(' ');
            // The evaluation's own "Date: 10/09/2026", which sits mid-line
            // after "Evaluation", then the day the session was created.
            const evalDate = toIsoDate((/\bDate:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(chunk) || [])[1])
                || toIsoDate(valueLines('Creation Date')[0]);
            const base = {
                sessionId,
                sessionType: valueLines('Coaching Session Type')[0] || '',
                assignedBy: valueLines('Assigned By')[0] || '',
                createdOn: toIsoDate(valueLines('Creation Date')[0]),
                dueDate: toIsoDate(valueLines('Due Date').find(line => /\d+\/\d+\/\d{4}/.test(line))),
                evalDate,
                evaluator: lineValue('Evaluator Name'),
                formName: lineValue('Form Name'),
                category: categoryOf(reasonText),
                reasonText,
                qaNote: cleanQaNote(reasonText),
                reasonKey: classifyReason(reasonText)
            };

            (employees.length ? employees : ['']).forEach(employee => {
                sessions.push(Object.assign({}, base, {
                    verintName: employee,
                    associateName: toDisplayName(employee)
                }));
            });
        });

        return sessions;
    }

    function sentence(text) {
        const value = String(text || '').trim();
        if (!value) return '';
        return /[.!?:"')]$/.test(value) ? value : `${value}.`;
    }

    // One step per line, whatever bullet it was typed with.
    function stepLines(steps) {
        const list = Array.isArray(steps) ? steps : String(steps || '').split('\n');
        return list
            .map(step => String(step || '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
            .filter(Boolean)
            .map(sentence);
    }

    function tidy(text) {
        const out = String(text || '')
            .split('\n')
            .map(line => line
                .replace(/\s+[–—―]\s+/g, ', ')
                .replace(LONG_DASH, ', ')
                .replace(/,\s*([,.!?;:])/g, '$1')
                .replace(/[ \t]+$/, ''))
            .join('\n')
            .trim();
        const limit = window.DevCoachModules?.messageVoice?.limitEmojis;
        return typeof limit === 'function' ? limit(out, 2) : out;
    }

    function firstNameOf(input) {
        const given = String(input.greetingName || '').trim();
        if (given) return given;
        const full = toDisplayName(input.associateName);
        return full.split(' ')[0] || '';
    }

    /**
     * The email to the associate. Praise first, then what QA saw and what to
     * do next time, then the ask to reply once read. No score.
     *
     * input: { associateName, greetingName, reasonKey, qaNote, steps, praise, evalDate }
     */
    function buildEmail(input) {
        const data = input || {};
        const reason = reasonFor(data.reasonKey);
        const name = firstNameOf(data);
        const note = sentence(data.qaNote);
        const steps = stepLines(data.steps);
        const when = shortDate(data.evalDate);

        const lines = [name ? `Hey ${name},` : 'Hey,', ''];
        lines.push(sentence(data.praise) || DEFAULT_PRAISE);
        lines.push('');
        lines.push(when
            ? `QA reviewed one of your calls on ${when}, and I wanted to share their feedback with you.`
            : 'QA reviewed one of your recent calls, and I wanted to share their feedback with you.');
        if (note) {
            lines.push('', 'What QA noticed:', note);
        }
        if (steps.length) {
            lines.push('', 'For next time:');
            steps.forEach(step => lines.push(`- ${step}`));
        }
        lines.push('', REPLY_ASK, '', CLOSER);

        return {
            subject: `QA feedback: ${reason.subject}`,
            body: tidy(lines.join('\n'))
        };
    }

    /**
     * The prompt behind "Copilot Prompt". It hands Copilot the praise itself,
     * not an instruction to find some, and the same rules the app's own email
     * keeps.
     */
    function buildCopilotPrompt(input) {
        const data = input || {};
        const full = toDisplayName(data.associateName) || 'the associate';
        const name = firstNameOf(data);
        const when = shortDate(data.evalDate);
        const steps = stepLines(data.steps);
        const praise = sentence(data.praise) || DEFAULT_PRAISE;

        const lines = [
            `Write a short coaching email from me, a call center supervisor at APS, to ${full} about a QA review of one of their calls${when ? ` on ${when}` : ''}.`,
            '',
            'Open with this praise, in a sentence or two:',
            praise,
            '',
            'What QA noticed:',
            sentence(data.qaNote) || 'See my notes.',
            ''
        ];
        if (steps.length) {
            lines.push('What I want them to do next time:');
            steps.forEach(step => lines.push(`- ${step}`));
            lines.push('');
        }
        lines.push(
            'Rules:',
            `- Start with "Hey ${name || full},".`,
            '- Warm, plain and encouraging. It should read like a supervisor who wants them to do well, not a write-up.',
            '- Keep it short: the praise, what QA noticed, what to do next time, and an offer to talk it through.',
            '- Do not include the QA score.',
            '- No em dashes or en dashes. At most 2 emojis.',
            '- End by asking them to reply with a quick "Got it" once they have read it.',
            '- No signature. Outlook adds mine.'
        );
        return lines.join('\n');
    }

    /**
     * The Meeting Summary to paste back into the Verint session. Verint is
     * supervisor-only, so it says plainly what was coached and when, and
     * whether the associate has confirmed reading it.
     *
     * record: the history entry for this coaching, when there is one.
     */
    function buildVerintSummary(input, record) {
        const data = input || {};
        const full = toDisplayName(data.associateName);
        const name = firstNameOf(data);
        const steps = stepLines(data.steps);
        const praise = sentence(data.praise);
        const evalBits = [
            data.sessionId ? `Session ${data.sessionId}` : '',
            data.formName || '',
            shortDate(data.evalDate) ? `from ${shortDate(data.evalDate)}` : ''
        ].filter(Boolean);

        const lines = [`QA coaching: ${full}`];
        if (evalBits.length) lines.push(evalBits.join(', ').replace(', from', ' from'));
        lines.push('', `Opportunity: ${sentence(data.qaNote) || reasonFor(data.reasonKey).label + '.'}`);
        if (praise) lines.push(`Strength: ${praise}`);
        if (steps.length) {
            lines.push('', 'Coached on:');
            steps.forEach(step => lines.push(`- ${step}`));
        }
        const sent = record && shortDate(record.emailedAt);
        const read = record && record.status === 'resolved' && shortDate(record.readAt);
        if (sent || read) lines.push('');
        if (sent) lines.push(`Sent to ${name || full} by email on ${sent}, with a request to reply once read.`);
        if (read) lines.push(`Read: confirmed on ${read}.`);
        return tidy(lines.join('\n'));
    }

    // ------------------------------------------------------------------
    // The record: one per coaching, in the follow-up history
    // ------------------------------------------------------------------

    function storage() {
        return window.DevCoachModules?.storage;
    }

    function loadHistory() {
        const history = storage()?.loadFollowUpHistory?.() || { entries: [] };
        if (!Array.isArray(history.entries)) history.entries = [];
        return history;
    }

    function saveHistory(history) {
        storage()?.saveFollowUpHistory?.(history);
        if (typeof queueCallListeningRepoSync === 'function') {
            queueCallListeningRepoSync('qa coaching');
        }
    }

    // A Verint session is one coaching however many times its email is
    // opened. A typed one is one per associate, reason and day.
    function dedupeKeyFor(input) {
        const data = input || {};
        if (data.sessionId) return `qa:${data.sessionId}|${nameKey(data.associateName)}`;
        return `qa:${nameKey(data.associateName)}|${data.reasonKey || 'other'}|${todayIso()}`;
    }

    function findRecord(input) {
        const key = dedupeKeyFor(input);
        return loadHistory().entries.find(entry => entry.kind === 'qa' && entry.dedupeKey === key) || null;
    }

    /**
     * Writes the record when the coaching goes out: the email opened or
     * copied, or the summary copied for Verint. Never on a draft.
     *
     * how: 'email' or 'verint'.
     */
    function recordQaCoaching(input, how) {
        const data = input || {};
        const history = loadHistory();
        const key = dedupeKeyFor(data);
        const now = new Date().toISOString();
        const reason = reasonFor(data.reasonKey);

        let entry = history.entries.find(item => item.kind === 'qa' && item.dedupeKey === key);
        if (!entry) {
            entry = {
                id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                kind: 'qa',
                dedupeKey: key,
                todoType: 'qa-coaching',
                todoLabel: 'QA Coaching',
                status: 'pending',
                sentAt: now
            };
            history.entries.unshift(entry);
        }

        Object.assign(entry, {
            associateName: toDisplayName(data.associateName),
            reasonKey: reason.key,
            reasonLabel: reason.label,
            declineReason: sentence(data.qaNote),
            sessionId: data.sessionId || '',
            evalDate: data.evalDate || '',
            dueDate: data.dueDate || ''
        });
        if (how === 'email' && !entry.emailedAt) entry.emailedAt = now;
        if (how === 'verint') entry.verintAt = now;

        saveHistory(history);
        return entry;
    }

    function setRead(entryId, read) {
        const history = loadHistory();
        const entry = history.entries.find(item => item.id === entryId);
        if (!entry) return null;
        entry.status = read ? 'resolved' : 'pending';
        entry.readAt = read ? new Date().toISOString() : '';
        saveHistory(history);
        return entry;
    }

    function qaEntries() {
        return loadHistory().entries.filter(entry => entry.kind === 'qa');
    }

    // Not read yet and past the due date Verint set.
    function isOverdue(entry, today) {
        if (!entry || entry.status === 'resolved' || !entry.dueDate) return false;
        return entry.dueDate < (today || todayIso());
    }

    // ------------------------------------------------------------------
    // The panel
    // ------------------------------------------------------------------

    let parsedSessions = [];
    let currentSession = null;
    let lastAutoSteps = '';
    let lastAutoNote = '';

    function el(id) {
        return document.getElementById(id);
    }

    function escapeHtml(text) {
        const shared = window.DevCoachModules?.sharedUtils?.escapeHtml;
        if (typeof shared === 'function') return shared(text);
        return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function toast(message) {
        if (typeof window.showToast === 'function') window.showToast(message, 3500);
    }

    function knownAssociates() {
        const weeklyData = storage()?.loadWeeklyData?.() || {};
        const names = new Set();
        Object.values(weeklyData).forEach(period => {
            (period?.employees || []).forEach(employee => {
                const name = String(employee?.name || '').trim();
                if (name) names.add(name);
            });
        });
        return Array.from(names);
    }

    function populateAssociates(extraName) {
        const select = el('qaCoachingAssociate');
        if (!select) return '';
        const names = knownAssociates();
        let chosen = extraName ? (matchAssociate(names, extraName) || toDisplayName(extraName)) : '';
        if (chosen && !names.includes(chosen)) names.push(chosen);
        // A name from a Verint paste may have no numbers uploaded yet. It
        // stays in the list while it is picked, so leaving the tab and coming
        // back does not empty the form.
        const kept = select.value || (currentSession && toDisplayName(currentSession.associateName));
        if (kept && !names.includes(kept) && !matchAssociate(names, kept)) names.push(kept);
        window.DevCoachModules.associatePicker?.populateSelect?.(select, names, {
            teamFilter: false,
            preserveSelection: !chosen,
            selected: chosen || undefined
        });
        return chosen;
    }

    function populateReasons() {
        const select = el('qaCoachingReason');
        if (!select || select.options?.length > 1) return;
        select.innerHTML = REASONS.map(reason => `<option value="${reason.key}">${escapeHtml(reason.label)}</option>`).join('');
    }

    function greetingFor(name) {
        if (!name) return '';
        return typeof getEmployeeNickname === 'function' ? getEmployeeNickname(name) : '';
    }

    function readForm() {
        const associateName = el('qaCoachingAssociate')?.value || '';
        const session = currentSession && nameKey(currentSession.associateName) === nameKey(associateName)
            ? currentSession
            : null;
        return {
            associateName,
            greetingName: greetingFor(associateName),
            reasonKey: el('qaCoachingReason')?.value || 'other',
            qaNote: el('qaCoachingNotes')?.value || '',
            steps: el('qaCoachingSteps')?.value || '',
            praise: el('qaCoachingPraise')?.value || '',
            sessionId: session?.sessionId || '',
            evalDate: session?.evalDate || '',
            dueDate: session?.dueDate || '',
            formName: session?.formName || ''
        };
    }

    function refreshPreview() {
        const preview = el('qaCoachingPreview');
        if (!preview) return;
        const input = readForm();
        if (!input.associateName) {
            preview.textContent = 'Pick the associate to see the email.';
            return;
        }
        const email = buildEmail(input);
        const to = window.DevCoachModules?.sharedUtils?.resolveAssociateEmail?.(input.associateName) || '';
        preview.textContent = `To: ${to}\nSubject: ${email.subject}\n\n${email.body}`;
    }

    // Fills the steps (and the note, when it is empty) from the reason,
    // unless Scott has typed over them.
    function applyReason(force) {
        const reason = reasonFor(el('qaCoachingReason')?.value);
        const stepsBox = el('qaCoachingSteps');
        const notesBox = el('qaCoachingNotes');
        const autoSteps = reason.steps.join('\n');
        if (stepsBox && (force || !stepsBox.value.trim() || stepsBox.value === lastAutoSteps)) {
            stepsBox.value = autoSteps;
            lastAutoSteps = autoSteps;
        }
        if (notesBox && (!notesBox.value.trim() || notesBox.value === lastAutoNote)) {
            notesBox.value = reason.note;
            lastAutoNote = reason.note;
        }
    }

    function loadSession(index) {
        const session = parsedSessions[index];
        if (!session) return;
        currentSession = session;
        populateAssociates(session.verintName || session.associateName);
        const reasonSelect = el('qaCoachingReason');
        if (reasonSelect) reasonSelect.value = session.reasonKey;
        const notesBox = el('qaCoachingNotes');
        if (notesBox) {
            notesBox.value = session.qaNote;
            lastAutoNote = '';
        }
        applyReason(true);
        renderSessionList(index);
        refreshPreview();
    }

    function renderSessionList(activeIndex) {
        const list = el('qaCoachingSessions');
        if (!list) return;
        if (parsedSessions.length < 2) {
            list.innerHTML = '';
            list.style.display = 'none';
            return;
        }
        list.style.display = 'flex';
        list.innerHTML = parsedSessions.map((session, index) => {
            const record = findRecord(session);
            const status = record ? (record.status === 'resolved' ? 'Read' : 'Sent') : '';
            const label = [toDisplayName(session.associateName), shortDate(session.evalDate), reasonFor(session.reasonKey).label]
                .filter(Boolean).join(' · ');
            return `<button type="button" class="btn-secondary btn-sm${index === activeIndex ? ' is-active' : ''}" data-qa-session="${index}">${escapeHtml(label)}${status ? ` <span class="pill ${status === 'Read' ? 'pill-good' : 'pill-warn'}">${status}</span>` : ''}</button>`;
        }).join('');
    }

    function handlePaste() {
        const raw = el('qaCoachingPaste')?.value || '';
        parsedSessions = parseSessions(raw);
        const status = el('qaCoachingPasteStatus');

        if (parsedSessions.length) {
            if (status) {
                status.textContent = parsedSessions.length === 1
                    ? 'Read 1 coaching session.'
                    : `Read ${parsedSessions.length} coaching sessions. Pick one below.`;
            }
            loadSession(0);
            return;
        }

        // Not a Verint page: the paste is QA's notes, so it goes in the notes
        // box and picks its own reason.
        currentSession = null;
        renderSessionList(-1);
        if (!raw.trim()) {
            if (status) status.textContent = '';
            return;
        }
        if (status) status.textContent = 'No Verint session found, so the paste went in as the QA notes.';
        const notesBox = el('qaCoachingNotes');
        if (notesBox) {
            notesBox.value = cleanQaNote(raw);
            lastAutoNote = '';
        }
        const reasonSelect = el('qaCoachingReason');
        if (reasonSelect) reasonSelect.value = classifyReason(raw);
        applyReason(true);
        refreshPreview();
    }

    function readyToSend(input) {
        if (!input.associateName) {
            toast('Pick the associate first.');
            return false;
        }
        if (!input.qaNote.trim() && !stepLines(input.steps).length) {
            toast('Add the QA notes first.');
            return false;
        }
        return true;
    }

    function afterRecord() {
        renderHistory();
        renderSessionList(parsedSessions.indexOf(currentSession));
    }

    function openEmailDraft() {
        const input = readForm();
        if (!readyToSend(input)) return;
        const email = buildEmail(input);
        const to = window.DevCoachModules?.sharedUtils?.resolveAssociateEmail?.(input.associateName) || '';
        window.DevCoachModules?.sharedUtils?.openMailtoDraft?.(email.subject, email.body, { to });
        recordQaCoaching(input, 'email');
        afterRecord();
        toast('Draft opened in Outlook. Saved as Sent; mark it Read when they reply.');
    }

    function copyEmail() {
        const input = readForm();
        if (!readyToSend(input)) return;
        const email = buildEmail(input);
        const copy = typeof window.copyToClipboard === 'function' ? window.copyToClipboard : null;
        if (!copy) return;
        Promise.resolve(copy(`Subject: ${email.subject}\n\n${email.body}`, {
            button: el('qaCoachingCopyEmailBtn'),
            message: '📋 Email copied. Saved as Sent; mark it Read when they reply.'
        })).then(ok => {
            if (!ok) return;
            recordQaCoaching(input, 'email');
            afterRecord();
        });
    }

    function copyCopilotPrompt() {
        const input = readForm();
        if (!readyToSend(input)) return;
        window.DevCoachModules?.sharedUtils?.copyPromptAndOpenCopilot?.(buildCopilotPrompt(input), {
            button: el('qaCoachingCopilotBtn'),
            message: '📋 Prompt copied, opening Copilot'
        });
    }

    function copyForVerint() {
        const input = readForm();
        if (!readyToSend(input)) return;
        const record = recordQaCoaching(input, 'verint');
        afterRecord();
        const copy = typeof window.copyToClipboard === 'function' ? window.copyToClipboard : null;
        if (!copy) return;
        copy(buildVerintSummary(input, record), {
            button: el('qaCoachingVerintBtn'),
            message: '📋 Copied. Paste it into the session\'s Meeting Summary in Verint.'
        });
    }

    function clearForm() {
        ['qaCoachingPaste', 'qaCoachingNotes', 'qaCoachingSteps', 'qaCoachingPraise'].forEach(id => {
            const box = el(id);
            if (box) box.value = '';
        });
        const associate = el('qaCoachingAssociate');
        if (associate) associate.value = '';
        const reason = el('qaCoachingReason');
        if (reason) reason.value = REASONS[0].key;
        const status = el('qaCoachingPasteStatus');
        if (status) status.textContent = '';
        parsedSessions = [];
        currentSession = null;
        lastAutoSteps = '';
        lastAutoNote = '';
        renderSessionList(-1);
        applyReason(true);
        refreshPreview();
    }

    function renderHistory() {
        const list = el('qaCoachingHistoryList');
        const count = el('qaCoachingHistoryCount');
        if (!list) return;
        const entries = qaEntries();
        const today = todayIso();
        const unread = entries.filter(entry => entry.status !== 'resolved').length;
        if (count) count.textContent = entries.length ? `(${unread} not read yet, ${entries.length - unread} read)` : '';

        if (!entries.length) {
            list.innerHTML = '<p class="text-faint">Nothing sent yet. Each email you open or copy shows here until you mark it Read.</p>';
            return;
        }

        list.innerHTML = entries.map(entry => {
            const read = entry.status === 'resolved';
            const overdue = isOverdue(entry, today);
            const pill = read ? 'pill pill-good' : (overdue ? 'pill pill-bad' : 'pill pill-warn');
            const label = read ? `Read ${shortDate(entry.readAt)}`.trim() : (overdue ? 'Not read, past due' : 'Not read yet');
            const when = [
                entry.emailedAt ? `Sent ${shortDate(entry.emailedAt)}` : (entry.verintAt ? `Logged in Verint ${shortDate(entry.verintAt)}` : ''),
                entry.dueDate ? `due ${shortDate(entry.dueDate)}` : '',
                entry.sessionId ? `session ${entry.sessionId}` : ''
            ].filter(Boolean).join(', ');
            return `<div class="qa-history-row" style="display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border);">
                <div>
                    <div class="text-primary" style="font-weight: 600;">${escapeHtml(entry.associateName)}. ${escapeHtml(entry.reasonLabel || 'QA Coaching')}</div>
                    <div class="text-faint" style="font-size: 0.85em;">${escapeHtml(when)}</div>
                </div>
                <button type="button" class="${pill}" data-qa-read="${escapeHtml(entry.id)}" title="Click when their reply or read receipt comes in" style="min-height: 0; padding: 4px 12px; font-size: 0.8em; cursor: pointer;">${escapeHtml(label)}</button>
            </div>`;
        }).join('');
    }

    function onHistoryClick(event) {
        const button = event.target?.closest?.('[data-qa-read]');
        if (!button) return;
        const id = button.getAttribute('data-qa-read');
        const entry = qaEntries().find(item => item.id === id);
        if (!entry) return;
        setRead(id, entry.status !== 'resolved');
        afterRecord();
    }

    function onSessionClick(event) {
        const button = event.target?.closest?.('[data-qa-session]');
        if (!button) return;
        loadSession(parseInt(button.getAttribute('data-qa-session'), 10));
    }

    let bound = false;

    function init() {
        if (bound || !el('qaCoachingPanel')) return;
        bound = true;
        populateReasons();
        populateAssociates();
        el('qaCoachingPaste')?.addEventListener('input', handlePaste);
        el('qaCoachingSessions')?.addEventListener('click', onSessionClick);
        el('qaCoachingReason')?.addEventListener('change', () => { applyReason(true); refreshPreview(); });
        el('qaCoachingAssociate')?.addEventListener('change', refreshPreview);
        ['qaCoachingNotes', 'qaCoachingSteps', 'qaCoachingPraise'].forEach(id => el(id)?.addEventListener('input', refreshPreview));
        el('qaCoachingEmailBtn')?.addEventListener('click', openEmailDraft);
        el('qaCoachingCopyEmailBtn')?.addEventListener('click', copyEmail);
        el('qaCoachingCopilotBtn')?.addEventListener('click', copyCopilotPrompt);
        el('qaCoachingVerintBtn')?.addEventListener('click', copyForVerint);
        el('qaCoachingClearBtn')?.addEventListener('click', clearForm);
        el('qaCoachingHistoryList')?.addEventListener('click', onHistoryClick);
        applyReason(true);
        refreshPreview();
        renderHistory();
    }

    // Called each time the tab opens, so the associate list and the history
    // are current.
    function show() {
        init();
        populateAssociates();
        refreshPreview();
        renderHistory();
    }

    window.DevCoachModules.qaCoaching = {
        REASONS,
        parseSessions,
        classifyReason,
        cleanQaNote,
        toDisplayName,
        matchAssociate,
        buildEmail,
        buildCopilotPrompt,
        buildVerintSummary,
        recordQaCoaching,
        findRecord,
        setRead,
        qaEntries,
        isOverdue,
        init,
        show
    };
})();
