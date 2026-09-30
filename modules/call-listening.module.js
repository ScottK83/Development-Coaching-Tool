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
- Do NOT use em dashes, or hyphens with spaces around them${momentRule}${transcriptRules}
- The QA read is background for you, not content for the associate. Do not paste the checklist or the words "opportunity" and "cannot tell" into the email; turn what matters into normal coaching language
- Where the language read shows a scored phrase, be concrete: name the phrase they said and give them the phrase that would have scored instead. "You said 'unfortunately' twice, and 'what I can do is' lands the same news without costing you" is coaching. "Use more positive language" is not
- Do not mention phrase lists, scoring, or the words positive and negative as categories. The associate should read it as advice about talking to customers, not as a report on a keyword count
- Pick at most two language points, the ones that came up most. A list of every phrase is not usable
- Return ONLY the final email body text.`;
    }

    /* ── What both Copilot prompts carry ── */

    function analysisFor(entry) {
        const analyzer = window.DevCoachModules?.callTranscript;
        if (!entry?.transcript || !analyzer?.analyzeTranscript) return null;
        const analysis = analyzer.analyzeTranscript(entry.transcript, { associateName: entry.employeeName });
        return analysis?.ok ? analysis : null;
    }

    /**
     * Tips from Scott's library for the points being coached.
     *
     * Only the points still in his notes, so a point he deleted does not come
     * back as a tip. If he rewrote the notes entirely nothing matches, and the
     * call's own points are still the best guide to what fits.
     */
    function tipsForEntry(entry, analysis) {
        const bridge = window.DevCoachModules?.callCoachingBridge;
        if (!bridge?.tipsForCall || !analysis) return [];
        const notes = String(entry?.improvementAreas || '');
        // Never for a red flag. A confirmed one carries its own record and
        // its rule, and the library's "verify" tips are mostly about other
        // things: on the first real run, "Verify contact info at end of call"
        // came back beside account details given to the wrong caller, where
        // it reads as if it were the fix.
        let points = (analysis.allImprovements || []).filter(item => item.severity !== 'red');
        const kept = points.filter(item => item.text && notes.includes(item.text));
        if (kept.length) points = kept;
        return bridge.tipsForCall(points, { max: 5, perFinding: 2 });
    }

    // The rule each kind of red flag broke. The verification standard is
    // APS's, as Scott confirmed it on 2026-09-30, and is taken from
    // call-verification so the two can never state it differently.
    function redFlagRules() {
        const standard = window.DevCoachModules?.callVerification?.STANDARD
            || 'the last four of the social, the driver\'s license or the password on the account';
        return {
            identity: `Verify the caller before anything on the account is shared: their name, and ${standard}. The name alone is enough only when the call comes in authorized.`,
            authority: 'When the caller is not on the account, nothing on it is shared unless they are authorized on it.',
            safety: 'A safety hazard is handled first: get the customer clear of it and report it as an emergency.'
        };
    }

    /**
     * The red flags on a call, written out in full for documenting: what
     * happened, in order, with the time to listen at and what was said, and
     * the rule it broke.
     *
     * Scott: "if there are major red flags, like didn't authenticate or
     * verify ... Flag me to actually listen to the call and in the email
     * summary, if it's valid, it needs to be heavily documented."
     */
    function redFlagRecord(analysis) {
        if (!analysis) return null;
        const verifier = window.DevCoachModules?.callVerification;
        const RULES = redFlagRules();
        const items = [];

        const read = analysis.verification;
        if (read?.ok && read.status === 'breach' && typeof verifier?.describe === 'function') {
            const said = verifier.describe(read);
            const types = read.breach?.types || [];
            const rules = [];
            if (types.some(type => ['unverified', 'nameOnly', 'late', 'failed'].includes(type))) rules.push(RULES.identity);
            if (types.some(type => ['unauthorized', 'denied'].includes(type))) rules.push(RULES.authority);
            items.push({
                key: 'verification',
                headline: said.headline,
                detail: said.detail,
                time: read.breach?.time || '',
                timeline: (verifier.buildTimeline?.(read) || [])
                    .map(row => ({ time: row.time || '', text: row.text || '', quote: row.quote || '' })),
                rule: rules.join(' ')
            });
        }

        (analysis.redFlags?.flags || []).filter(flag => flag.level === 'red').forEach(flag => {
            items.push({
                key: flag.key,
                headline: flag.title,
                detail: flag.detail || '',
                time: flag.time || '',
                timeline: flag.quote ? [{ time: flag.time || '', text: 'What the customer said', quote: flag.quote }] : [],
                rule: flag.key === 'safety' ? RULES.safety : ''
            });
        });

        return items.length ? { items, labeled: Boolean(analysis.stats?.labeled) } : null;
    }

    function redFlagLines(record) {
        const lines = [];
        (record?.items || []).forEach((item) => {
            lines.push(`${item.headline}${item.time ? ` (at ${item.time})` : ''}.`);
            if (item.detail) lines.push(item.detail);
            item.timeline.forEach(row => {
                lines.push(`- ${row.time ? `${row.time} ` : ''}${row.text}${row.quote ? ` ("${row.quote}")` : ''}`);
            });
            if (item.rule) lines.push(`The rule: ${item.rule}`);
        });
        return lines;
    }

    // The pieces each prompt adds on top of the notes: the red flag when
    // Scott has confirmed it, the tips, and the Oscar steps.
    function promptExtras(entry) {
        const analysis = analysisFor(entry);
        const mask = window.DevCoachModules?.callTranscript?.maskIdentifiers || ((value) => String(value || ''));
        const record = entry?.redFlagReview === 'valid' ? redFlagRecord(analysis) : null;
        return {
            redFlag: record ? redFlagLines(record).map(line => mask(line)) : [],
            tips: tipsForEntry(entry, analysis).map(tip => tip.text),
            oscarSteps: String(entry?.relevantInfo || '').trim(),
            oscarUrl: String(entry?.oscarUrl || '').trim()
        };
    }

    /**
     * The prompt behind "Copilot: Write The Summary".
     *
     * Scott's flow is paste, sort the good from the bad, have Copilot write it
     * up, and put it in Verint. So this asks for a coaching summary shaped for
     * the Verint log rather than an email: a line on what the call was, then
     * what went well and what to work on, from his notes.
     *
     * Where the customer got lost on something, the moment goes over with it
     * and Copilot is asked for one plainer way to explain it. That is the part
     * of this a rules engine cannot do well and Copilot can.
     *
     * Same framing as the email prompt, because it is what does not get
     * refused: the review is done, only the wording is wanted, and the
     * associate is never named. The customer's numbers are masked first, since
     * none of them are needed to summarise a call.
     */
    function buildCoachingSummaryPrompt(entry) {
        if (!entry) return '';
        const transcriptModule = window.DevCoachModules?.callTranscript;
        const correct = transcriptModule?.correctMishearings || ((value) => String(value || ''));
        const mask = transcriptModule?.maskIdentifiers || ((value) => String(value || ''));
        const prepare = transcriptModule?.prepareForPrompt || ((value) => String(value || '').trim());

        // Masked a line at a time. Run over the whole text, the digit pattern
        // reaches across a line break, so "is 2" above "01:03" became one
        // [number] and the timestamp went with it, and the whitespace tidy
        // pulled the next timestamp up onto the customer's line.
        const transcript = entry.transcript
            ? prepare(entry.transcript).split('\n').map((line) => mask(line)).join('\n')
            : '';
        const meta = entry.transcript ? transcriptModule?.extractMetadata?.(entry.transcript) : null;
        const moment = describeCallMoment(entry);

        const summarizer = window.DevCoachModules?.callSummary;
        const recap = summarizer?.summarizeCall && entry.transcript
            ? summarizer.buildSummaryText(summarizer.summarizeCall(entry.transcript, {
                associateName: entry.employeeName,
                callDate: entry.listenedOn,
                callTime: entry.callTime
            }), { voice: 'supervisor' })
            : '';

        const explainer = window.DevCoachModules?.callExplanation;
        const explained = entry.transcript ? explainer?.readExplanationsFromText?.(entry.transcript) : null;
        const lost = explained?.ok ? explained.lost : [];

        const lines = [];
        lines.push('I supervise a call center for APS, an electric utility in Arizona. I have already listened to this call and written my notes, so the review is done. I am not asking you to assess anybody or rate the call. I need the wording: turn my notes into a short coaching summary I can paste into our coaching log in Verint.');
        lines.push('');

        const details = [];
        if (moment) details.push(`- Call taken: ${moment}`);
        if (meta?.durationLabel) details.push(`- Call length: ${meta.durationLabel}`);
        if (recap) details.push(`- My recap of the call: ${recap}`);
        if (details.length) {
            lines.push('Call details:', ...details, '');
        }

        if (transcript) {
            lines.push('Call transcript. It is speech to text, so some words are misheard, and numbers the customer read out have been replaced with [number]:');
            lines.push('"""', transcript, '"""', '');
        }

        const extras = promptExtras(entry);
        if (extras.redFlag.length) {
            lines.push('The most serious thing on this call. I listened to it myself and it is confirmed:');
            lines.push(...extras.redFlag, '');
        }

        lines.push('My notes on what went well:', correct(entry.whatWentWell) || '- None', '');
        lines.push('My notes on what to work on:', correct(entry.improvementAreas) || '- None', '');

        if (lost.length) {
            const first = lost[0];
            const subject = first.topicKey === 'general' ? 'what was being explained' : first.topicLabel;
            lines.push(`Where the customer got lost: ${subject}${first.time ? ` at ${first.time}` : ''}. `
                + (first.beforeQuote ? `After the associate said "${mask(first.beforeQuote)}", ` : '')
                + `the customer said "${mask(first.customerQuote)}". Include one plainer way to explain ${subject} that the associate could use next time, in under 40 words, in everyday words. Leave any amount or date as a placeholder in square brackets, and do not state APS policy you cannot see in the transcript.`);
            lines.push('');
        }

        if (extras.tips.length) {
            lines.push('Tips from our own coaching library that fit this call. Use the ones that fit, reworded to fit the call:');
            extras.tips.forEach(tip => lines.push(`- ${tip}`));
            lines.push('');
        }

        if (extras.oscarSteps) {
            lines.push('The Oscar steps for this, from our knowledge base:', '"""', extras.oscarSteps, '"""');
            if (extras.oscarUrl) lines.push(`Link to the Oscar article: ${extras.oscarUrl}`);
            lines.push('');
        }

        lines.push('Write the coaching summary.');
        lines.push('');
        lines.push('Requirements:');
        lines.push('- Plain text only, ready to paste into Verint. No markdown, no bold, no symbols in front of headings');
        if (extras.redFlag.length) {
            lines.push('- Put the confirmed issue first, under "Most important:", and document it in full: what happened, in order, with the times; the rule it broke; and what has to happen on every call from now on. State it plainly and respectfully. Do not soften it into a tip or put it after the praise');
        }
        lines.push('- Open with one or two sentences on what the call was about and how it ended');
        lines.push('- Then "What went well:" with two to four short bullets, and "What to work on:" with two or three bullets, each saying exactly what to do differently');
        lines.push('- Then "Tips to try:" with three to five practical tips or tricks, each with an example of what to say or do on the next call. Draw them from my notes and the tips above');
        if (extras.oscarSteps) {
            lines.push('- Then "Oscar steps:" with the steps that apply, short and in order, saying which step to focus on next time. Use the steps as given and do not add to them');
        }
        lines.push('- Use only my notes, the tips above and the transcript. Do not add findings of your own, and do not rate or score the call');
        lines.push('- Write to the associate as "you" and do not use their name. Do not use the words "red flag"');
        lines.push('- Our company is APS. If the transcript names another company in the greeting, that is the speech to text mishearing APS');
        lines.push('- Quote the call only where a short phrase makes a point clearer');
        lines.push(`- Keep it under ${extras.redFlag.length ? 400 : 300} words. Do not use em dashes, or hyphens with spaces around them`);

        return lines.join('\n');
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
            message: options.message || '📋 Call listening prompt copied. Paste into Copilot with Ctrl+V',
            openWindow: options.openWindow
        });

        return { ok: true, handoff };
    }

    /**
     * The prompt behind "Copilot: Write The Email".
     *
     * Scott's flow (2026-09-30): Copilot writes the coaching summary, he
     * pastes it back into the app, and Copilot turns that summary into the
     * email to the associate. The summary is the source because it is the
     * version he has already read and agreed with, so the transcript does not
     * go over a second time and nothing new can creep in.
     *
     * With no summary pasted, the good and bad notes stand in for it, so the
     * button never dead ends.
     *
     * The associate is named, because an email has to say hello to somebody,
     * and the prompt says the review is done and only wording is wanted, which
     * is the framing that is not refused.
     */
    function buildEmailFromSummaryPrompt(entry, preferredName) {
        if (!entry) return '';
        const correct = window.DevCoachModules?.callTranscript?.correctMishearings || ((value) => String(value || ''));
        const summary = correct(String(entry.copilotSummary || '').trim());
        const name = String(preferredName || '').trim() || 'the associate';
        const moment = describeCallMoment(entry);

        const lines = [];
        lines.push(`I supervise a call center for APS, an electric utility in Arizona. I have already reviewed a call ${name} took and written up my coaching. I am not asking you to assess ${name} or rate the call. I need the wording: turn my write-up into a short email to ${name} that I can send.`);
        lines.push('');
        if (moment) lines.push(`The call: ${moment}.`, '');

        const extras = promptExtras(entry);
        if (extras.redFlag.length) {
            lines.push('The most serious thing on this call. I listened to it myself and it is confirmed:');
            lines.push(...extras.redFlag, '');
        }

        if (summary) {
            lines.push('My coaching write-up:', '"""', summary, '"""', '');
        } else {
            lines.push('What went well:', correct(entry.whatWentWell) || '- None', '');
            lines.push('What to work on:', correct(entry.improvementAreas) || '- None', '');
        }

        if (extras.tips.length) {
            lines.push('Tips from our own coaching library that fit this call:');
            extras.tips.forEach(tip => lines.push(`- ${tip}`));
            lines.push('');
        }

        if (extras.oscarSteps) {
            lines.push('The Oscar steps for this, from our knowledge base:', '"""', extras.oscarSteps, '"""');
            if (extras.oscarUrl) lines.push(`Link to the Oscar article: ${extras.oscarUrl}`);
            lines.push('');
        }

        lines.push('Write the email.');
        lines.push('');
        lines.push('Requirements:');
        lines.push(`- From me to ${name}, in my voice: warm, direct and supportive, the way a supervisor who works with them every day would write`);
        lines.push(moment ? `- Say which call it is about in the opening line: ${moment}` : '- Say which call it is about in the opening line');
        if (extras.redFlag.length) {
            lines.push('- Straight after the opening line, set out the confirmed issue in full: what happened, in order, with the times; why it matters, which is protecting the customer and their account; and exactly what has to happen on every call from now on. Plain and respectful, but not softened, not turned into a tip, and not put after the praise. Do not use the words "red flag"');
        }
        lines.push('- Say what went well, specifically, and why it mattered to the customer');
        lines.push('- Then what to do better: for each point, say exactly what to do differently and give the words or the steps to use');
        lines.push('- Then a short list headed "A few things to try:" with three to five practical tips or tricks, each with an example of what to say or do. Draw them from my write-up and the tips above');
        if (extras.oscarSteps) {
            lines.push(`- Then the Oscar steps as a short numbered list, so they have the process in front of them. Use the steps as given and do not add to them${extras.oscarUrl ? ', and include the link' : ''}`);
        }
        lines.push('- Use only my write-up, the tips and the steps above. Do not add findings of your own, and do not rate or score the call');
        lines.push(`- Keep it under ${extras.redFlag.length ? 400 : 300} words, with a one line close`);
        lines.push('- Plain text: no subject line, no bold. Do not use em dashes, or hyphens with spaces around them');
        lines.push('- Our company is APS. If another company name appears, that is speech to text mishearing APS');
        lines.push('- Return only the email body');

        return lines.join('\n');
    }

    /**
     * The saved entry this draft is the same call as, if there is one.
     *
     * The page has no Save button any more: a call is kept when it goes
     * somewhere, to Copilot, to Verint or to the associate. Saving on the way
     * past once appended a fresh entry every time, which is how one call was
     * stored twice under two dates and counted as two calls. So a save finds
     * the call it belongs to and updates it in place.
     *
     * The same call is the same conversation: the transcript fingerprint,
     * which ignores the Verint header and the storage header. With no
     * transcript there is nothing to fingerprint, so the date, time and
     * reference have to agree instead.
     */
    function findSameCall(entries, draft, fingerprint) {
        const list = Array.isArray(entries) ? entries : [];
        if (!draft) return null;
        const print = typeof fingerprint === 'function' ? fingerprint : null;
        const key = draft.transcript && print ? print(draft.transcript) : '';

        if (key) {
            return list.find((entry) => entry && entry.transcript && print(entry.transcript) === key) || null;
        }
        return list.find((entry) => entry
            && !entry.transcript
            && (entry.listenedOn || '') === (draft.listenedOn || '')
            && (entry.callTime || '') === (draft.callTime || '')
            && (entry.callReference || '') === (draft.callReference || '')) || null;
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

    /**
     * Ends a line the way a person would, without doubling the stop.
     *
     * A point that closes on a quote from the call, `...everybody. ("okay can
     * i have the last four")`, already ended its sentence before the quote, so
     * a full stop after the bracket is one too many.
     */
    function sentence(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return '';
        return /[.!?:]$|["'”]\)$/.test(trimmed) ? trimmed : `${trimmed}.`;
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
    function toneFor(wellCount, workCount, serious) {
        if (!workCount && wellCount) return 'clean';
        if (!wellCount && workCount) return 'work';
        // Four strengths and one verification miss is not "nothing here is a
        // concern". The count cannot see which point it is, so the notes are
        // asked directly.
        if (wellCount > workCount) return serious ? 'even' : 'strong';
        if (workCount > wellCount) return 'mixed';
        return 'even';
    }

    // A point about verifying or authorizing the caller, as Analyze writes it
    // or as a supervisor would type it.
    const ACCOUNT_SECURITY_NOTE = /\bverif(?:y|ied|ying|ication)\b|\bauthori[sz]ed\b/i;
    // The other points that are never "nothing here is a concern": a safety
    // hazard the call did not turn to, a line that blamed the customer, and a
    // promise about an outcome, in the words call-red-flags writes them.
    const SERIOUS_NOTE = /\breported as an emergency\b|\blands as blame\b|\bpromise about how\b|\bguarantee(?:d|ing)?\b/i;

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

        const workText = record.improvementAreas || '';
        const tone = toneFor(wellCount, workCount, ACCOUNT_SECURITY_NOTE.test(workText) || SERIOUS_NOTE.test(workText));
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
    /**
     * Whether a saved call gave account details to somebody not shown to be
     * entitled to them.
     *
     * Read fresh from the transcript every time and never stored, so a fix to
     * the reader reaches every call already saved without a migration, and a
     * list of somebody's calls answers "is she verifying" at a glance.
     */
    function hasVerificationRedFlag(entry) {
        if (!entry?.transcript) return false;
        // Listened to and set aside: not a flag on this call any more.
        if (entry.redFlagReview === 'dismissed') return false;
        const read = window.DevCoachModules?.callVerification?.readVerificationFromText?.(entry.transcript, {
            associateName: entry.employeeName
        });
        return Boolean(read?.redFlag);
    }

    const RED_FLAG_TAG = '🚩 account details shared before verifying';

    function buildHistoryItemHtml(entry, escapeHtml) {
        const safeEscapeHtml = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
        const flagged = hasVerificationRedFlag(entry);
        const transcriptTag = (entry.transcript ? ' • transcript saved' : ' • no transcript')
            + (flagged ? ` • ${RED_FLAG_TAG}` : '');
        const moment = describeCallMoment(entry) || entry.listenedOn || '';
        return `<li class="call-history-item">
            <button type="button" class="call-history-open" data-call-action="load" data-entry-id="${safeEscapeHtml(entry.id)}" title="Load this call into the form">
                <span class="call-history-title">${flagged ? '🚩 ' : ''}${safeEscapeHtml(moment)}${entry.callReference ? ` • Ref: ${safeEscapeHtml(entry.callReference)}` : ''}</span>
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
        buildCoachingSummaryPrompt,
        buildEmailFromSummaryPrompt,
        redFlagRecord,
        redFlagLines,
        tipsForEntry,
        findSameCall,
        copyPromptAndOpenCopilot,
        buildOutlookSubject,
        generateOutlookDraft,
        buildCallFeedbackMessage,
        describeCallFeedbackMessage,
        splitNote,
        buildHistorySummaryText,
        buildHistoryItemHtml,
        hasVerificationRedFlag,
        RED_FLAG_TAG
    };
})();