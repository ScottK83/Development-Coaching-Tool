(function() {
    'use strict';

    /**
     * Turns a raw call transcript into draft coaching bullets.
     *
     * This is deliberately a rules engine, not a model: the app has no backend
     * and no API key, so the analysis has to run in the browser. It reads the
     * transcript for behaviours a supervisor would listen for, quotes the line
     * that triggered each call, and hands back editable drafts. The supervisor
     * is still the author; this just removes the blank-page problem.
     */

    const MAX_STORED_TRANSCRIPT_CHARS = 8000;
    const MAX_PROMPT_TRANSCRIPT_CHARS = 12000;
    const MAX_QUOTE_CHARS = 110;
    const MAX_BULLETS = 5;

    const AGENT_LABEL = /\b(agent|advisor|associate|rep|representative|csr|tsr|employee|specialist|operator)\b/i;
    const CUSTOMER_LABEL = /\b(customer|caller|client|member|cust|subscriber|guest|patient)\b/i;

    // "Agent: text", "[00:14] Jane Doe: text", "CUSTOMER - text" all land here.
    const SPEAKER_LINE = /^\s*(?:[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap]\.?[Mm]\.?)?[\])]?\s*)?([A-Za-z][A-Za-z0-9 .'\-]{0,34}?)\s*[:\-]\s+(.+)$/;

    const GREETING_HINT = /thank(?:s| you) for calling|my name is|this is \w+ speaking|how (?:can|may) i help/i;

    /* ── Text helpers ── */

    function collapse(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clipQuote(value) {
        const text = collapse(value).replace(/^["']+|["']+$/g, '');
        if (text.length <= MAX_QUOTE_CHARS) return text;
        const cut = text.slice(0, MAX_QUOTE_CHARS);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function countMatches(text, pattern) {
        const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        const matches = String(text || '').match(global);
        return matches ? matches.length : 0;
    }

    function wordCount(text) {
        const trimmed = collapse(text);
        return trimmed ? trimmed.split(' ').length : 0;
    }

    /* ── Parsing ── */

    function isPlausibleSpeaker(label) {
        const clean = collapse(label);
        if (!clean || clean.length > 34) return false;
        return clean.split(' ').length <= 4;
    }

    function classifyLabel(label, associateName) {
        if (AGENT_LABEL.test(label)) return 'agent';
        if (CUSTOMER_LABEL.test(label)) return 'customer';

        const nameTokens = String(associateName || '')
            .toLowerCase()
            .split(/[\s,]+/)
            .filter(token => token.length > 2);
        const lowerLabel = label.toLowerCase();
        if (nameTokens.some(token => lowerLabel.includes(token))) return 'agent';

        return 'unknown';
    }

    /**
     * Splits a transcript into speaker turns and works out which side is the
     * associate. Falls back to "everything is the associate" for pasted notes
     * with no speaker labels, so the behaviour rules still have something to
     * read.
     */
    function parseTranscript(rawText, options = {}) {
        const text = String(rawText || '');
        const rawLines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const turns = [];
        const labelOrder = [];
        const labelText = {};

        rawLines.forEach(line => {
            const match = line.match(SPEAKER_LINE);
            if (match && isPlausibleSpeaker(match[1])) {
                const label = collapse(match[1]);
                if (!labelText[label]) {
                    labelText[label] = '';
                    labelOrder.push(label);
                }
                labelText[label] += ` ${match[2]}`;
                turns.push({ label, text: collapse(match[2]) });
            } else if (turns.length) {
                // Wrapped continuation of the previous speaker's turn.
                const previous = turns[turns.length - 1];
                previous.text = collapse(`${previous.text} ${line}`);
                labelText[previous.label] += ` ${line}`;
            } else {
                turns.push({ label: '', text: collapse(line) });
            }
        });

        if (!labelOrder.length) {
            return {
                labeled: false,
                turns: turns.map(turn => ({ ...turn, role: 'agent' })),
                agentText: turns.map(turn => turn.text).join('\n'),
                customerText: '',
                agentWords: wordCount(turns.map(turn => turn.text).join(' ')),
                customerWords: 0
            };
        }

        const roles = {};
        labelOrder.forEach(label => {
            roles[label] = classifyLabel(label, options.associateName);
        });

        const unresolved = labelOrder.filter(label => roles[label] === 'unknown');
        if (unresolved.length) {
            const greeter = unresolved.find(label => GREETING_HINT.test(labelText[label]));
            if (greeter) {
                roles[greeter] = 'agent';
            }
            const hasAgent = labelOrder.some(label => roles[label] === 'agent');
            if (labelOrder.length === 2) {
                // Two speakers: whoever is not the associate is the customer.
                labelOrder.forEach((label, index) => {
                    if (roles[label] !== 'unknown') return;
                    const other = labelOrder[1 - index];
                    roles[label] = roles[other] === 'agent' ? 'customer' : 'agent';
                });
            } else if (!hasAgent) {
                roles[labelOrder[0]] = 'agent';
                labelOrder.slice(1).forEach(label => {
                    if (roles[label] === 'unknown') roles[label] = 'customer';
                });
            } else {
                labelOrder.forEach(label => {
                    if (roles[label] === 'unknown') roles[label] = 'customer';
                });
            }
        }

        const resolved = turns.map(turn => ({ ...turn, role: roles[turn.label] || 'agent' }));
        const agentTurns = resolved.filter(turn => turn.role === 'agent');
        const customerTurns = resolved.filter(turn => turn.role === 'customer');

        return {
            labeled: true,
            turns: resolved,
            agentText: agentTurns.map(turn => turn.text).join('\n'),
            customerText: customerTurns.map(turn => turn.text).join('\n'),
            agentWords: wordCount(agentTurns.map(turn => turn.text).join(' ')),
            customerWords: wordCount(customerTurns.map(turn => turn.text).join(' '))
        };
    }

    /* ── Behaviour rules ── */

    // Present in the associate's speech = a strength worth naming. `missing`
    // (when set) is the coaching line to use when the behaviour never shows up.
    const STRENGTH_RULES = [
        {
            key: 'greeting',
            pattern: /thank(?:s| you) for calling|my name is|this is \w+ (?:speaking|how)|how (?:can|may) i help you/i,
            made: 'Opened the call properly with a branded greeting and your name.',
            missing: 'Opening: lead with the branded greeting and your name so the customer knows exactly who they are working with.',
            missingWeight: 4
        },
        {
            key: 'empathy',
            pattern: /i (?:completely |totally |really |absolutely )?understand|i (?:can )?(?:hear|see) (?:why|how|that)|i(?:'?m| am) (?:so |really |very )?sorry|i apologi[sz]e|that (?:sounds|must be) (?:frustrating|stressful|difficult|annoying)|i can imagine/i,
            made: 'Acknowledged how the customer felt before moving into the fix.',
            missing: 'Empathy: acknowledge the customer\'s situation in your own words before jumping into troubleshooting.',
            missingWeight: 9
        },
        {
            key: 'ownership',
            pattern: /i(?:'?ll| will) take care of|let me take care of|i(?:'?ll| will) make sure|let me handle|i(?:'?ll| will) get (?:this|that) (?:sorted|fixed|taken care of)|leave (?:it|that) with me|i(?:'?ll| will) (?:own|personally)/i,
            made: 'Took personal ownership of the outcome instead of handing the problem back.'
        },
        {
            key: 'verification',
            pattern: /verif(?:y|ication|ying)|confirm(?:ing)? your (?:name|address|account|identity)|date of birth|last four|security question|account number/i,
            made: 'Verified the account before discussing details.',
            missing: 'Verification: confirm identity up front before you discuss anything on the account.',
            missingWeight: 8
        },
        {
            key: 'holdEtiquette',
            pattern: /(?:may|can|could|would it be ok(?:ay)? if) i (?:please )?(?:place|put) you on(?: a (?:brief|short|quick))? hold|do you mind (?:if i|holding)|thank(?:s| you) for holding|appreciate (?:you|your) (?:holding|patience)/i,
            made: 'Handled the hold the right way: asked first and thanked the customer on the way back.'
        },
        {
            key: 'education',
            pattern: /you can also|for future reference|next time you can|on the (?:app|website|portal)|online you can|self.?serv/i,
            made: 'Pointed the customer to a faster self service option for next time.'
        },
        {
            key: 'checkUnderstanding',
            pattern: /does that make sense|did (?:that|i) answer|any questions (?:about|on) that|how does that sound|are you (?:following|with me)/i,
            made: 'Checked for understanding instead of assuming the explanation landed.'
        },
        {
            key: 'recap',
            pattern: /to recap|just to recap|to summari[sz]e|to sum (?:up|it up)|so to confirm|let me confirm what|(?:here'?s|what) we (?:did|covered) today/i,
            made: 'Recapped the resolution so the customer left with a clear picture.',
            missing: 'Recap: close by restating what you did and what it means for the customer.',
            missingWeight: 5
        },
        {
            key: 'nextSteps',
            pattern: /next step|you (?:will|'ll) (?:receive|see|get|be)|within (?:\d+|twenty.four|forty.eight) (?:hours|business days|days)|i'?ll follow up|follow up with you|in \d+ (?:to \d+ )?(?:business )?days|by (?:monday|tuesday|wednesday|thursday|friday|the end of)/i,
            made: 'Set a clear expectation for what happens after the call and when.',
            missing: 'Next steps: tell the customer exactly what happens next and by when, even when the answer is not what they wanted.',
            missingWeight: 7
        },
        {
            key: 'courtesyClose',
            pattern: /anything else (?:i can (?:help|do|assist)|you need)|is there anything else|before (?:i let you go|we (?:hang up|wrap up|finish))/i,
            made: 'Offered further help before closing the call.',
            missing: 'Close: ask if there is anything else before you wrap up.',
            missingWeight: 3
        }
    ];

    // Present in the associate's speech = something to coach.
    const ISSUE_RULES = [
        {
            key: 'deflection',
            weight: 10,
            pattern: /there(?:'?s| is) nothing i can do|i (?:can'?t|cannot) do anything|that(?:'?s| is) (?:just )?(?:our|the) policy|that(?:'?s| is) policy|you(?:'?ll| will) have to (?:call|contact|go)|you need to call|not my department|i don'?t handle (?:that|those)/i,
            text: 'Dead end language: this landed as "no" with nowhere to go. Say what you can do and why, then offer the next best option.'
        },
        {
            key: 'repeatCustomer',
            weight: 8,
            side: 'customer',
            pattern: /like i (?:said|told you|mentioned)|as i (?:said|mentioned|explained)|i already (?:said|told|explained)|i just (?:said|told)/i,
            text: 'Active listening: the customer had to repeat themselves. Recap what you heard before you ask the next question.'
        },
        {
            key: 'supervisorRequest',
            weight: 8,
            side: 'customer',
            pattern: /(?:speak|talk) (?:to|with) (?:a|your) (?:supervisor|manager)|get me a (?:supervisor|manager)|escalate this/i,
            text: 'Escalation request: acknowledge it directly, make one clear ownership attempt, then follow the escalation path without making the customer ask twice.'
        },
        {
            key: 'deadAir',
            weight: 6,
            pattern: /\[(?:silence|pause|dead air|no response)[^\]]*\]/i,
            text: 'Dead air: narrate what you are doing while systems load so the silence does not stack up.'
        },
        {
            key: 'stalling',
            weight: 6,
            threshold: 3,
            pattern: /one moment|just a (?:moment|second|sec)|bear with me|give me (?:one|a) (?:second|moment)|still (?:there|checking|loading)/i,
            text: 'Silence fillers came up repeatedly. Tell the customer what you are checking rather than asking them to keep waiting.'
        },
        {
            key: 'uncertainty',
            weight: 6,
            threshold: 3,
            pattern: /\bi think\b|\bi(?:'?m| am) not (?:really )?sure\b|\bi guess\b|\bhopefully\b|\bit should\b/i,
            text: 'Confidence: hedging language showed up several times. Verify it, then state the answer plainly so the customer trusts it.'
        },
        {
            key: 'apologyLoop',
            weight: 4,
            threshold: 5,
            pattern: /i(?:'?m| am) (?:so |very |really )?sorry|i apologi[sz]e/i,
            text: 'Over apologising: after the first genuine apology, move to what you are doing about it.'
        },
        {
            key: 'filler',
            weight: 3,
            threshold: 6,
            pattern: /\b(?:um+|uh+|erm|er)\b/i,
            text: 'Filler words: a short pause reads as more confident than "um" while you think.'
        }
    ];

    const FRUSTRATION = /frustrat|ridiculous|unacceptable|this is the (?:second|third|fourth|\d+)(?:st|nd|rd|th)? time|fed up|angry|upset|furious|waste of my time|sick of/i;
    const APPRECIATION = /thank you so much|you'?ve been (?:so |really |very )?(?:helpful|great|wonderful|amazing)|i (?:really )?appreciate (?:you|your|it|that)|you'?re the best|that'?s (?:great|perfect)/i;
    const HOLD_MENTION = /\bhold\b|hold on|one moment|bear with me/i;
    const TRANSFER = /transfer(?:ring)? you|i(?:'?m| am) going to transfer|let me transfer|get you (?:over )?to (?:the|another)/i;
    const WARM_TRANSFER = /stay on the line|i(?:'?ll| will) (?:stay|introduce|walk them through)|let me (?:explain|brief|fill) (?:them|the)|warm transfer|i(?:'?ll| will) give them the (?:details|background)/i;

    function strengthPattern(key) {
        const rule = STRENGTH_RULES.find(item => item.key === key);
        return rule ? rule.pattern : /$^/;
    }

    function findQuote(turns, pattern, side) {
        const match = turns.find(turn => turn.role === (side || 'agent') && pattern.test(turn.text));
        return match ? clipQuote(match.text) : '';
    }

    function bullet(text, quote) {
        return quote ? `- ${text} ("${quote}")` : `- ${text}`;
    }

    /**
     * Reads a transcript and returns draft strengths and coaching points,
     * each one anchored to the line that triggered it.
     */
    function analyzeTranscript(rawText, options = {}) {
        const transcript = String(rawText || '').trim();
        if (!transcript) {
            return { ok: false, reason: 'empty', strengths: [], improvements: [], stats: null };
        }

        const parsed = parseTranscript(transcript, options);
        const { agentText, customerText, turns } = parsed;
        const strengths = [];
        const improvements = [];

        STRENGTH_RULES.forEach(rule => {
            if (rule.pattern.test(agentText)) {
                strengths.push({ key: rule.key, text: rule.made, quote: findQuote(turns, rule.pattern) });
            } else if (rule.missing) {
                improvements.push({ key: rule.key, weight: rule.missingWeight || 5, text: rule.missing, quote: '' });
            }
        });

        ISSUE_RULES.forEach(rule => {
            const haystack = rule.side === 'customer' ? customerText : agentText;
            const hits = countMatches(haystack, rule.pattern);
            if (hits >= (rule.threshold || 1)) {
                improvements.push({
                    key: rule.key,
                    weight: rule.weight,
                    text: rule.text,
                    quote: findQuote(turns, rule.pattern, rule.side)
                });
            }
        });

        const frustrated = FRUSTRATION.test(customerText);
        if (frustrated) {
            const empathyGap = improvements.find(item => item.key === 'empathy');
            if (empathyGap) {
                empathyGap.weight = 12;
                empathyGap.text = 'Empathy: the customer signalled real frustration and it went unacknowledged. Name what they are dealing with before you move to the fix.';
                empathyGap.quote = findQuote(turns, FRUSTRATION, 'customer');
            }
        }

        if (APPRECIATION.test(customerText)) {
            strengths.push({
                key: 'customerReaction',
                text: 'The customer voiced appreciation on the call, which is the clearest signal it landed.',
                quote: findQuote(turns, APPRECIATION, 'customer')
            });
        }

        if (HOLD_MENTION.test(agentText) && !strengthPattern('holdEtiquette').test(agentText)) {
            improvements.push({
                key: 'holdProcess',
                weight: 7,
                text: 'Hold process: ask permission before the hold, give a time frame, and thank the customer when you come back.',
                quote: findQuote(turns, HOLD_MENTION)
            });
        }

        if (TRANSFER.test(agentText) && !WARM_TRANSFER.test(agentText)) {
            improvements.push({
                key: 'coldTransfer',
                weight: 7,
                text: 'Transfers: brief the receiving team while the customer is still with you so they do not start over.',
                quote: findQuote(turns, TRANSFER)
            });
        }

        const totalWords = parsed.agentWords + parsed.customerWords;
        const agentShare = totalWords >= 120 ? parsed.agentWords / totalWords : null;
        if (parsed.labeled && agentShare !== null && agentShare >= 0.8) {
            improvements.push({
                key: 'airtime',
                weight: 4,
                text: `Airtime: you carried about ${Math.round(agentShare * 100)}% of the talk time. Ask an open question and let the customer fill in the gaps.`,
                quote: ''
            });
        } else if (parsed.labeled && agentShare !== null && agentShare <= 0.3) {
            improvements.push({
                key: 'callControl',
                weight: 4,
                text: `Call control: the customer drove about ${Math.round((1 - agentShare) * 100)}% of the conversation. Set the agenda early and steer with focused questions.`,
                quote: ''
            });
        }

        improvements.sort((a, b) => b.weight - a.weight);

        return {
            ok: true,
            // The drafts are capped so the email stays focused; the full lists
            // stay on the result so nothing is dropped without a trace.
            strengths: strengths.slice(0, MAX_BULLETS),
            improvements: improvements.slice(0, MAX_BULLETS),
            allStrengths: strengths,
            allImprovements: improvements,
            stats: {
                labeled: parsed.labeled,
                turns: parsed.turns.length,
                agentWords: parsed.agentWords,
                customerWords: parsed.customerWords,
                agentTalkShare: agentShare,
                customerFrustrated: frustrated,
                strengthsFound: strengths.length,
                improvementsFound: improvements.length
            }
        };
    }

    function toBulletText(items, emptyFallback) {
        if (!Array.isArray(items) || !items.length) {
            return emptyFallback || '';
        }
        return items.map(item => bullet(item.text, item.quote)).join('\n');
    }

    function buildStrengthsDraft(analysis) {
        return toBulletText(
            analysis?.strengths,
            '- Nothing stood out clearly in the transcript. Add the one thing you would want repeated on the next call.'
        );
    }

    function buildImprovementsDraft(analysis) {
        return toBulletText(
            analysis?.improvements,
            '- No coaching flags surfaced. Reinforce what worked and set one stretch goal for the next call.'
        );
    }

    function buildAnalysisSummary(analysis) {
        if (!analysis?.ok) return 'Paste a transcript first.';
        const stats = analysis.stats || {};
        const trimmed = Math.max(0, (stats.strengthsFound || 0) - analysis.strengths.length)
            + Math.max(0, (stats.improvementsFound || 0) - analysis.improvements.length);
        const parts = [
            `${stats.turns || 0} turn${stats.turns === 1 ? '' : 's'} read`,
            `${analysis.strengths.length} strength${analysis.strengths.length === 1 ? '' : 's'}`,
            `${analysis.improvements.length} coaching point${analysis.improvements.length === 1 ? '' : 's'}`
        ];
        if (trimmed > 0) {
            parts.push(`${trimmed} lower priority item${trimmed === 1 ? '' : 's'} held back to keep the email focused`);
        }
        if (!stats.labeled) {
            parts.push('no speaker labels found, so everything was read as the associate');
        } else if (typeof stats.agentTalkShare === 'number') {
            parts.push(`associate talk share ${Math.round(stats.agentTalkShare * 100)}%`);
        }
        return `${parts.join(' • ')}. Drafts are editable, review before you send.`;
    }

    function clampForStorage(rawText) {
        const text = String(rawText || '').trim();
        if (text.length <= MAX_STORED_TRANSCRIPT_CHARS) return text;
        return `${text.slice(0, MAX_STORED_TRANSCRIPT_CHARS)}\n[transcript truncated for storage]`;
    }

    function clampForPrompt(rawText) {
        const text = String(rawText || '').trim();
        if (text.length <= MAX_PROMPT_TRANSCRIPT_CHARS) return text;
        return `${text.slice(0, MAX_PROMPT_TRANSCRIPT_CHARS)}\n[transcript truncated]`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callTranscript = {
        parseTranscript,
        analyzeTranscript,
        buildStrengthsDraft,
        buildImprovementsDraft,
        buildAnalysisSummary,
        clampForStorage,
        clampForPrompt,
        MAX_STORED_TRANSCRIPT_CHARS,
        MAX_PROMPT_TRANSCRIPT_CHARS
    };
})();
