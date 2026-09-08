(function() {
    'use strict';

    function buildTranscriptSection(entry) {
        const prepare = window.DevCoachModules?.callTranscript?.prepareForPrompt
            || ((value) => String(value || '').trim());
        const transcript = prepare(entry.transcript);
        if (!transcript) return '';

        return `Call transcript (verbatim, use this as the source of truth):
"""
${transcript}
"""

`;
    }

    /**
     * When the call was, in words the associate can place.
     *
     * Reads the stored fields rather than the transcript, because a saved entry
     * has had its Verint header rewritten and no longer carries the time.
     */
    function describeCallMoment(entry) {
        const format = window.DevCoachModules?.callTranscript?.formatCallMoment;
        if (typeof format !== 'function') return String(entry?.listenedOn || '');
        return format(entry?.listenedOn, entry?.callTime);
    }

    function buildCallDetailLines(entry) {
        const context = window.DevCoachModules?.callTranscript?.buildCallContextLines;
        const extra = typeof context === 'function' ? context(entry.transcript) : [];
        const moment = describeCallMoment(entry);
        const summarizer = window.DevCoachModules?.callSummary;
        const recap = summarizer?.summarizeCall && entry.transcript
            ? summarizer.buildSummaryText(
                summarizer.summarizeCall(entry.transcript, {
                    associateName: entry.employeeName,
                    callDate: entry.listenedOn,
                    callTime: entry.callTime
                }),
                { voice: 'supervisor' }
            )
            : '';

        return [
            moment ? `- Call taken: ${moment}` : `- Call date: ${entry.listenedOn}`,
            `- Call reference: ${entry.callReference || 'Not provided'}`,
            ...extra,
            // Handed over as my own recap, so the message can open with which
            // call this is without the model reconstructing it from 108 turns.
            ...(recap ? ['', `My recap of the call: ${recap}`] : [])
        ].join('\n');
    }

    // The QA read is context for tone and content, not something to paste into
    // the associate's email, so the prompt is explicit about that.
    function buildQaSection(entry) {
        const scorer = window.DevCoachModules?.callQa;
        if (!scorer?.scoreCall || !entry.transcript) return '';

        const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(entry.transcript, {
            associateName: entry.employeeName
        });
        const text = scorer.buildQaText(scorer.scoreCall(entry.transcript, {
            associateName: entry.employeeName,
            context: { silenceGaps: analysis?.silenceGaps || [] }
        }));

        return text ? `${text}\n\n` : '';
    }

    // The scored phrase lists are the one part of this the associate is
    // literally graded on, so the wording matters more than usual: name the
    // phrase they said, and offer the phrase that would have scored instead.
    function buildWordChoiceSection(entry) {
        const scanner = window.DevCoachModules?.callWordChoice;
        if (!scanner?.scanTranscript || !entry.transcript) return '';

        const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(entry.transcript, {
            associateName: entry.employeeName
        });
        const scan = scanner.scanTranscript(entry.transcript, {
            associateName: entry.employeeName,
            analysis
        });
        const text = scanner.buildWordChoiceText(scan);

        return text ? `${text}\n\n` : '';
    }

    function buildPrompt(entry, preferredName) {
        const transcriptSection = buildTranscriptSection(entry);
        const transcriptRules = transcriptSection
            ? `\n- Ground every point in the transcript. Where it helps, quote a short phrase the associate actually said\n- Do not invent details that are not in the transcript or my notes`
            : '';

        // The associate takes dozens of calls a week. Feedback that does not say
        // which one is feedback they cannot check, so naming the call is a
        // requirement rather than something to mention if it fits.
        const moment = describeCallMoment(entry);
        const momentRule = moment
            ? `\n- Say which call this is about in the opening line, by day and time: ${moment}. Word it naturally, as "the call you took on ${moment}" or similar`
            : '';

        // Says plainly that the review is already done and only the wording is
        // outstanding. Without this the prompt reads as a request to assess a
        // named employee's performance, which gets refused: the supervisor did
        // the listening, the notes below are theirs, and nothing here is asking
        // a model to form a judgement about anybody.
        return `I have already listened to this call and written my notes. I am not asking you to assess ${preferredName}, rate the call, or decide what she should improve. I have done that part. What I need is the wording: turn my notes into a message in my voice.

Call details:
${buildCallDetailLines(entry)}

${transcriptSection}${buildQaSection(entry)}${buildWordChoiceSection(entry)}Feedback notes:
What went well:
${entry.whatWentWell || '- None provided'}

What to work on next time:
${entry.improvementAreas || '- None provided'}

Oscar / Knowledge Base URL:
${entry.oscarUrl || '- Not provided'}

Relevant guidance to include:
${entry.relevantInfo || '- Not provided'}

Manager context:
${entry.managerNotes || '- Not provided'}

Write the message.

Requirements:
- Use only my notes above. Do not add observations of your own, do not rate the call, and do not introduce anything I have not said
- Professional, supportive, and specific
- Open with genuine, specific recognition. Where the notes show the call went well, say so plainly and warmly rather than rushing past it to the coaching. Praise the behaviour and why it mattered to the customer, not just "good job"
- Match the tone to the call: if the strengths clearly outweigh the coaching points, this should read as a well earned pat on the back with a couple of refinements, not a correction
- Include clear improvement actions with practical next steps
- If Oscar URL or relevant guidance is provided, naturally reference it as a resource
- Keep concise: 1 short intro paragraph + 3-5 bullet points + 1 closing line
- Do NOT use em dashes (, )${momentRule}${transcriptRules}
- The QA read is background for you, not content for the associate. Do not paste the checklist or the words "opportunity" and "cannot tell" into the email; turn what matters into normal coaching language
- Where the language read shows a scored phrase, be concrete: name the phrase they said and give them the phrase that would have scored instead. "You said 'unfortunately' twice, and 'what I can do is' lands the same news without costing you" is coaching. "Use more positive language" is not
- Do not mention phrase lists, scoring, or the words positive and negative as categories. The associate should read it as advice about talking to customers, not as a report on a keyword count
- Pick at most two language points, the ones that came up most. A list of every phrase is not usable
- Return ONLY the final email body text.`;
    }

    /**
     * Start the Copilot handoff for this call.
     *
     * The returned ok means "there was a prompt and the handoff began", which
     * is what the caller uses it for: deciding whether to reveal the Outlook
     * panel. It is deliberately synchronous, because that decision cannot wait
     * on the clipboard.
     *
     * What is no longer synchronous is the claim of success. This used to flash
     * "Copied + Opening Copilot" on the button before the copy ran and then
     * discard the copy's result entirely, so a blocked clipboard looked exactly
     * like a successful one. The label is the same; it now appears only once the
     * copy has actually landed, and says "Copy failed" when it has not.
     */
    function copyPromptAndOpenCopilot(options = {}) {
        const prompt = String(options.prompt || '');
        if (!prompt.trim()) {
            return { ok: false, reason: 'missing-prompt' };
        }

        const handoff = window.DevCoachModules.sharedUtils.copyPromptAndOpenCopilot(prompt, {
            button: options.button,
            successLabel: '✅ Copied + Opening Copilot',
            message: '📋 Call listening prompt copied. Paste into Copilot with Ctrl+V',
            openWindow: options.openWindow
        });

        return { ok: true, handoff };
    }

    function buildOutlookSubject(employeeName, callDate, getEmployeeNickname) {
        const preferredName = employeeName ? (typeof getEmployeeNickname === 'function' ? (getEmployeeNickname(employeeName) || employeeName) : employeeName) : 'Associate';
        return `Call Listening Feedback - ${preferredName}${callDate ? ` - ${callDate}` : ''}`;
    }

    // ============================================
    // WRITING THE EMAIL HERE
    // ============================================
    //
    // The five feedback fields had exactly one consumer, the Copilot prompt
    // above. So emailing an associate meant generating a prompt, copying it,
    // leaving the app, pasting, waiting, copying the answer, coming back and
    // pasting again. Four clipboard operations and an app switch to send words
    // that were already typed into the form.
    //
    // Nothing in that round trip needed a model. The supervisor did the
    // listening and wrote the notes. What was outstanding was an opening line,
    // an order and a close, and those are decidable from the entry.
    //
    // It adds no findings of its own. Every point in the message came out of
    // the two note fields, which is the same rule the prompt gives Copilot and
    // the reason this can be sent without being reread against the call.
    //
    // Manager notes are deliberately not in it. That field asks for "tone and
    // context notes for how you want this communicated", which is guidance to
    // whoever writes the message rather than something the associate should
    // read. Pasting it in would put "go easy on her, she has had a rough week"
    // in front of her. The caller is told it was left out rather than finding
    // out by reading the draft.

    const NOTE_BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;

    /**
     * A note field split into the line that opens it and the points under it.
     *
     * Analyze writes these fields as a headline followed by "- " bullets, and
     * a supervisor typing over the top writes whatever they like, so both
     * shapes have to come out the same way. A wrapped line under a bullet
     * belongs to that bullet rather than starting a new one.
     */
    function splitNote(text) {
        const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const lead = [];
        const bullets = [];

        lines.forEach((line) => {
            if (NOTE_BULLET.test(line)) {
                bullets.push(line.replace(NOTE_BULLET, '').trim());
                return;
            }
            if (bullets.length) {
                bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`.trim();
                return;
            }
            lead.push(line);
        });

        // Notes with no bullets at all are still points. One paragraph of
        // prose is one thing said, and dropping it because it had no dash in
        // front of it would lose the whole note.
        if (!bullets.length && lead.length > 1) {
            return { lead: lead[0], bullets: lead.slice(1) };
        }
        return { lead: lead.join(' '), bullets };
    }

    function noteCount(note) {
        return note.bullets.length || (note.lead ? 1 : 0);
    }

    /** Ends a line the way a person would, without doubling the stop. */
    function sentence(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return '';
        return /[.!?:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    }

    function lowerFirst(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return '';
        // Only a plain capital. Lowering "APS" or "Oscar" would be wrong.
        if (/^[A-Z][a-z]/.test(trimmed)) return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
        return trimmed;
    }

    /**
     * How the message should carry, from the balance of the notes.
     *
     * A call where the strengths outnumber the coaching points has to read as
     * a well earned pat on the back with a couple of refinements, not as a
     * correction with some praise stapled to the front. Getting this backwards
     * is the difference between a message that lands and one that stings.
     */
    function toneFor(wellCount, workCount) {
        if (!workCount && wellCount) return 'clean';
        if (!wellCount && workCount) return 'work';
        if (wellCount > workCount) return 'strong';
        if (workCount > wellCount) return 'mixed';
        return 'even';
    }

    const OPENERS = {
        clean: 'It was a good listen and there is nothing I need you to change.',
        strong: 'It was a strong call, and there are a couple of things worth tightening.',
        even: 'There was a lot in it I liked, and a couple of things I want to go through with you.',
        mixed: 'There are things in there that worked, and a few I want to go through with you.',
        work: 'There are a few things I want to go through with you.'
    };

    const CLOSERS = {
        clean: 'Keep doing what you did on this one.',
        strong: 'Nothing here is a concern. Keep going.',
        even: 'Have a think about those and come and find me if you want to talk any of it through.',
        mixed: 'Have a think about those and come and find me if you want to talk any of it through.',
        work: 'Come and find me if you want to talk any of it through.'
    };

    /**
     * The email, written from what is already on the form.
     *
     * Pure: entry in, text out, so it can be shown before it is sent and
     * tested without a browser.
     */
    function buildCallFeedbackMessage(entry, options = {}) {
        const record = entry || {};
        const well = splitNote(record.whatWentWell);
        const work = splitNote(record.improvementAreas);

        const wellCount = noteCount(well);
        const workCount = noteCount(work);
        if (!wellCount && !workCount) return '';

        const nickname = typeof options.getEmployeeNickname === 'function'
            ? options.getEmployeeNickname(record.employeeName)
            : '';
        const fullName = String(record.employeeName || '').trim();
        const name = String(nickname || '').trim() || fullName.split(/\s+/)[0] || '';

        const tone = toneFor(wellCount, workCount);
        const moment = describeCallMoment(record);
        const lines = [];

        lines.push(name ? `Hi ${name},` : 'Hi,');
        lines.push('');

        // Which call, in the opening line. She takes dozens a week, so
        // feedback that does not say which one is feedback she cannot check.
        const opening = moment
            ? `I listened back to the call you took on ${moment}.`
            : 'I listened back to one of your recent calls.';
        lines.push(`${opening} ${OPENERS[tone]}`);

        if (wellCount) {
            lines.push('');
            lines.push(well.lead
                ? sentence(well.lead)
                : 'Here is what stood out:');
            if (well.bullets.length) {
                lines.push('');
                well.bullets.forEach((point) => lines.push(`- ${sentence(point)}`));
            }
        }

        if (workCount) {
            lines.push('');
            // Framed forward. The same point reads as a verdict in the past
            // tense and as something to try in the future tense, and only one
            // of those is worth sending.
            lines.push(work.lead
                ? sentence(work.lead)
                : (wellCount
                    ? 'For next time:'
                    : 'Here is what I want you to work on:'));
            if (work.bullets.length) {
                lines.push('');
                work.bullets.forEach((point) => lines.push(`- ${sentence(point)}`));
            }
        }

        // Anything the supervisor wanted included, in their own words.
        const relevant = String(record.relevantInfo || '').trim();
        if (relevant) {
            lines.push('');
            lines.push(sentence(relevant));
        }

        const oscar = String(record.oscarUrl || '').trim();
        if (oscar) {
            lines.push('');
            lines.push(`There is more on this here if you want it: ${oscar}`);
        }

        lines.push('');
        lines.push(CLOSERS[tone]);

        return lines.join('\n');
    }

    /**
     * What the caller should say about a draft it just wrote.
     *
     * The counts are worth saying out loud: a supervisor who typed four points
     * and got three back should be able to see that immediately rather than
     * by counting the draft.
     */
    function describeCallFeedbackMessage(entry) {
        const record = entry || {};
        const wellCount = noteCount(splitNote(record.whatWentWell));
        const workCount = noteCount(splitNote(record.improvementAreas));
        const parts = [];

        if (wellCount) parts.push(`${wellCount} thing${wellCount === 1 ? '' : 's'} that went well`);
        if (workCount) parts.push(`${workCount} to work on`);

        let text = parts.length
            ? `Written from your notes: ${parts.join(' and ')}.`
            : 'Nothing in the notes to write from yet.';

        if (String(record.managerNotes || '').trim()) {
            text += ' Your manager notes are guidance for the wording, so they are not in the draft.';
        }
        return text;
    }

    function generateOutlookDraft(options = {}) {
        const employeeName = String(options.employeeName || '').trim();
        const callDate = String(options.callDate || '').trim();
        const bodyText = String(options.bodyText || '').trim();
        const showToast = typeof options.showToast === 'function' ? options.showToast : () => {};

        if (!bodyText) {
            showToast('⚠️ Write the email from your notes first, or paste one in.', 3000);
            return { ok: false, reason: 'missing-body' };
        }

        const subject = buildOutlookSubject(employeeName, callDate, options.getEmployeeNickname);
        const to = String(options.to || '').trim();

        try {
            const openDraft = window.DevCoachModules?.sharedUtils?.openMailtoDraft;
            if (typeof openDraft !== 'function') {
                throw new Error('Shared mailto utility unavailable');
            }
            openDraft(subject, bodyText, { to });
            // An address typed over the resolved one is remembered for that
            // associate, so a pattern that is wrong for somebody is wrong once.
            if (to && employeeName) {
                window.DevCoachModules?.sharedUtils?.setAssociateEmailOverride?.(employeeName, to);
            }
            showToast(to ? `📧 Outlook draft opened for ${to}` : '📧 Outlook draft opened', 2500);
            return { ok: true, subject, to };
        } catch (error) {
            if (typeof options.onError === 'function') {
                options.onError(error);
            }
            showToast('⚠️ Could not open Outlook draft.', 3000);
            return { ok: false, reason: 'open-failed', error };
        }
    }

    function buildHistorySummaryText(employeeName, entryCount) {
        return `${entryCount} saved call listening log${entryCount === 1 ? '' : 's'} for ${employeeName}.`;
    }

    /**
     * One row, and clicking it loads the call.
     *
     * There used to be a Load button here as well as a clickable row in the
     * memory panel below, so Scott clicked a call, watched it not carry
     * everything over, and pressed a button to try again. Two mechanisms for
     * one intention. The row is the control in both places now; Copy Verint
     * and Delete stay, because those are different intentions.
     */
    function buildHistoryItemHtml(entry, escapeHtml) {
        const safeEscapeHtml = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
        const transcriptTag = entry.transcript ? ' • transcript saved' : ' • no transcript';
        const moment = describeCallMoment(entry) || entry.listenedOn || '';
        return `<li class="call-history-item">
            <button type="button" class="call-history-open" data-call-action="load" data-entry-id="${safeEscapeHtml(entry.id)}" title="Load this call into the form">
                <span class="call-history-title">${safeEscapeHtml(moment)}${entry.callReference ? ` • Ref: ${safeEscapeHtml(entry.callReference)}` : ''}</span>
                <span style="display: block; margin-top: 4px;"><strong>✅ Went well:</strong> ${safeEscapeHtml(entry.whatWentWell || 'N/A')}</span>
                <span style="display: block; margin-top: 2px;"><strong>⚠️ Improve:</strong> ${safeEscapeHtml(entry.improvementAreas || 'N/A')}</span>
                <span class="call-history-meta" style="display: block;">Saved: ${safeEscapeHtml(createdAt)}${transcriptTag}</span>
            </button>
            <div class="flex-row" style="margin-top: 8px;">
                <button type="button" data-call-action="copy-verint" data-entry-id="${safeEscapeHtml(entry.id)}">📝 Copy Verint</button>
                <button type="button" data-call-action="delete" data-entry-id="${safeEscapeHtml(entry.id)}">✕ Delete</button>
            </div>
        </li>`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callListening = {
        describeCallMoment,
        buildPrompt,
        copyPromptAndOpenCopilot,
        buildOutlookSubject,
        generateOutlookDraft,
        buildCallFeedbackMessage,
        describeCallFeedbackMessage,
        splitNote,
        buildHistorySummaryText,
        buildHistoryItemHtml
    };
})();