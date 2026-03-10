/**
 * Sentiment & Language Summary Engine Module
 * Handles sentiment analysis, phrase databases, file parsing, and summary generation.
 */
(function() {
    'use strict';

    const DEFAULT_SENTIMENT_PHRASE_DATABASE = {
        positive: {
            A: [
                'have wonderful', 'anything else', 'I can help', 'anything else help', 'happy to', 'anything else you',
                'of course', 'happy help', 'absolutely', 'what can', 'how help', 'do for you', 'taken care',
                'what I can do', 'anything else do', 'work you', 'enjoy', 'what we can do', 'you got it',
                'take time', 'no problem', 'can definitely', 'here help', "let's get", 'perfectly',
                "don't worry", 'glad to', 'take care for you', "let's make sure", 'wish best',
                'answered questions', 'lovely', 'being customer', 'you bet', 'thank you part', 'took care',
                'happy assist', 'my pleasure', 'a pleasure', 'appreciate business', 'congratulations', 'certainly',
                'thank you being', 'questions or concerns'
            ],
            C: [
                'really appreciate', "you've been", 'very helpful'
            ]
        },
        negative: {
            A: [
                'not sure', 'an error', "we can't", 'no way', 'yes but', 'unfortunately', "I can't give",
                'trying help', 'sorry but', 'I understand but', "we don't have", 'not my problem', 'any notes',
                "can't provide", "I can't do", "I can't see", 'you need to go', 'no notes', "I can't find",
                'sorry feel', 'our policy', 'nothing do', "I can't tell", "don't do that", 'unable help',
                'like I said'
            ],
            C: [
                'you understand', "i don't care", 'not helping', 'not helping', "you don't care", 'let finish',
                'not listening'
            ]
        },
        emotions: {
            C: [
                'frustrated',
                'your company',
                'frustrating',
                'ridiculous',
                'really upset',
                'you people',
                'what NEAR hell',
                'fuck you',
                'not my fault',
                'horrible',
                'wasting NEAR "my time"',
                'this NEAR "B\'S"',
                'screwed',
                "you don't care",
                'our fault',
                'stupid',
                'complaint',
                'totally unacceptable',
                "can't NEAR believe",
                'very unhappy',
                'your fault NOTIN "not your fault"',
                'not NEAR "good enough"',
                'cannot NEAR believe',
                'not happy',
                'seriously',
                'pissed off',
                'unacceptable',
                'fucking',
                'kill myself',
                'Monopoly',
                'bull shit',
                "i'm NEAR angry"
            ]
        }
    };

    function normalizePhraseList(textValue) {
        if (!textValue) return [];
        const unique = new Set();

        const parseManualPhraseLine = (line) => {
            if (!line) return '';
            let cleaned = String(line).trim();

            if (!/[a-z0-9]/i.test(cleaned)) {
                return '';
            }

            const taggedInParens = cleaned.match(/^[+\-#]?\s*\(([AC]):\s*(.+)\)$/i);
            if (taggedInParens) {
                cleaned = taggedInParens[2].trim();
            } else {
                const taggedDirect = cleaned.match(/^[+\-#]?\s*([AC]):\s*(.+)$/i);
                if (taggedDirect) {
                    cleaned = taggedDirect[2].trim();
                } else {
                    cleaned = cleaned.replace(/^[+\-#]+\s*/, '').trim();
                }
            }

            cleaned = cleaned.replace(/^"|"$/g, '').trim();

            if (!/[a-z0-9]/i.test(cleaned)) {
                return '';
            }

            return cleaned;
        };

        textValue
            .split('\n')
            .map(parseManualPhraseLine)
            .filter(Boolean)
            .forEach(item => unique.add(item));
        return Array.from(unique);
    }

    function normalizePhraseForMatch(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatKeywordPhraseForDisplay(value) {
        let phrase = String(value || '').trim();
        if (!phrase) return '';

        phrase = phrase
            .replace(/\bNOTIN\b\s*"[^"]*"/gi, '')
            .replace(/\bNOTIN\b\s*'[^']*'/gi, '')
            .replace(/\bNOTIN\b\s*[^\s]+/gi, '')
            .replace(/\bNEAR\b/gi, ' ... ')
            .replace(/\s+/g, ' ')
            .trim();

        return phrase;
    }

    function normalizeDateStringForStorage(dateString) {
        if (!dateString) return '';

        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return dateString;
        }

        const slashMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (slashMatch) {
            const month = slashMatch[1].padStart(2, '0');
            const day = slashMatch[2].padStart(2, '0');
            let year = slashMatch[3];
            if (year.length === 2) {
                year = year >= '70' ? `19${year}` : `20${year}`;
            }
            return `${year}-${month}-${day}`;
        }

        const parsed = new Date(dateString);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }

        return '';
    }

    function parseDateForComparison(dateString) {
        const normalized = normalizeDateStringForStorage(dateString);
        if (!normalized) return null;
        const parsed = new Date(`${normalized}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function ensureSentimentPhraseDatabaseDefaults() {
        if (!sentimentPhraseDatabase || typeof sentimentPhraseDatabase !== 'object') {
            sentimentPhraseDatabase = JSON.parse(JSON.stringify(DEFAULT_SENTIMENT_PHRASE_DATABASE));
            saveSentimentPhraseDatabase();
            return;
        }

        sentimentPhraseDatabase.positive = sentimentPhraseDatabase.positive || { A: [], C: [] };
        sentimentPhraseDatabase.negative = sentimentPhraseDatabase.negative || { A: [], C: [] };
        sentimentPhraseDatabase.emotions = sentimentPhraseDatabase.emotions || { C: [] };
        sentimentPhraseDatabase.positive.A = Array.isArray(sentimentPhraseDatabase.positive.A) ? sentimentPhraseDatabase.positive.A : [];
        sentimentPhraseDatabase.positive.C = Array.isArray(sentimentPhraseDatabase.positive.C) ? sentimentPhraseDatabase.positive.C : [];
        sentimentPhraseDatabase.negative.A = Array.isArray(sentimentPhraseDatabase.negative.A) ? sentimentPhraseDatabase.negative.A : [];
        sentimentPhraseDatabase.negative.C = Array.isArray(sentimentPhraseDatabase.negative.C) ? sentimentPhraseDatabase.negative.C : [];
        sentimentPhraseDatabase.emotions.C = Array.isArray(sentimentPhraseDatabase.emotions.C) ? sentimentPhraseDatabase.emotions.C : [];
    }

    function renderSentimentDatabasePanel() {
        ensureSentimentPhraseDatabaseDefaults();

        const positiveA = document.getElementById('phraseDbPositiveA');
        const positiveC = document.getElementById('phraseDbPositiveC');
        const negativeA = document.getElementById('phraseDbNegativeA');
        const negativeC = document.getElementById('phraseDbNegativeC');
        const emotionsC = document.getElementById('phraseDbEmotionsC');
        const status = document.getElementById('phraseDbStatus');
        const snapshotStatus = document.getElementById('associateSnapshotStatus');

        if (!positiveA || !positiveC || !negativeA || !negativeC || !emotionsC) {
            return;
        }

        positiveA.value = (sentimentPhraseDatabase.positive?.A || []).join('\n');
        positiveC.value = (sentimentPhraseDatabase.positive?.C || []).join('\n');
        negativeA.value = (sentimentPhraseDatabase.negative?.A || []).join('\n');
        negativeC.value = (sentimentPhraseDatabase.negative?.C || []).join('\n');
        emotionsC.value = (sentimentPhraseDatabase.emotions?.C || []).join('\n');

        const totalCount =
            (sentimentPhraseDatabase.positive?.A?.length || 0) +
            (sentimentPhraseDatabase.positive?.C?.length || 0) +
            (sentimentPhraseDatabase.negative?.A?.length || 0) +
            (sentimentPhraseDatabase.negative?.C?.length || 0) +
            (sentimentPhraseDatabase.emotions?.C?.length || 0);

        if (status) {
            status.textContent = `Saved phrase database: ${totalCount} phrases total.`;
        }

        if (snapshotStatus) {
            const totalSnapshots = Object.values(associateSentimentSnapshots || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
            snapshotStatus.textContent = totalSnapshots > 0
                ? `Saved associate snapshots: ${totalSnapshots}`
                : 'No associate snapshot saved yet.';
        }
    }

    function saveSentimentPhraseDatabaseFromForm() {
        const positiveA = document.getElementById('phraseDbPositiveA');
        const positiveC = document.getElementById('phraseDbPositiveC');
        const negativeA = document.getElementById('phraseDbNegativeA');
        const negativeC = document.getElementById('phraseDbNegativeC');
        const emotionsC = document.getElementById('phraseDbEmotionsC');

        if (!positiveA || !positiveC || !negativeA || !negativeC || !emotionsC) {
            return;
        }

        sentimentPhraseDatabase = {
            positive: {
                A: normalizePhraseList(positiveA.value),
                C: normalizePhraseList(positiveC.value)
            },
            negative: {
                A: normalizePhraseList(negativeA.value),
                C: normalizePhraseList(negativeC.value)
            },
            emotions: {
                C: normalizePhraseList(emotionsC.value)
            },
            updatedAt: new Date().toISOString()
        };

        saveSentimentPhraseDatabase();
        renderSentimentDatabasePanel();
        showToast('✅ Sentiment phrase database saved', 2500);
    }

    function syncSentimentSnapshotDateInputsFromReports() {
        const startInput = document.getElementById('sentimentSnapshotStart');
        const endInput = document.getElementById('sentimentSnapshotEnd');
        if (!startInput || !endInput) return;

        const positive = sentimentReports.positive;
        if (!positive) return;

        const start = normalizeDateStringForStorage(positive.startDate);
        const end = normalizeDateStringForStorage(positive.endDate);

        if (start && !startInput.value) startInput.value = start;
        if (end && !endInput.value) endInput.value = end;
    }

    function saveAssociateSentimentSnapshotFromCurrentReports() {
        const { positive, negative, emotions } = sentimentReports;
        if (!positive || !negative || !emotions) {
            showToast('⚠️ Upload all 3 sentiment reports before saving a snapshot', 4000);
            return;
        }

        ensureSentimentPhraseDatabaseDefaults();

        const associateName = (positive.associateName || negative.associateName || emotions.associateName || '').trim();
        if (!associateName) {
            showToast('⚠️ Associate name not found in uploaded reports', 4000);
            return;
        }

        const startInput = document.getElementById('sentimentSnapshotStart');
        const endInput = document.getElementById('sentimentSnapshotEnd');
        const startDate = normalizeDateStringForStorage(startInput?.value || positive.startDate || negative.startDate || emotions.startDate);
        const endDate = normalizeDateStringForStorage(endInput?.value || positive.endDate || negative.endDate || emotions.endDate);

        if (!startDate || !endDate) {
            showToast('⚠️ Timeframe start and end are required', 4000);
            return;
        }

        const sortByValue = (a, b) => b.value - a.value;
        const toTopRows = (items) => items.slice(0, 5).map(item => ({
            phrase: item.phrase,
            value: item.value,
            speaker: item.speaker || 'A'
        }));

        const positiveUsed = positive.phrases.filter(p => p.value > 0 && (p.speaker || 'A') === 'A').sort(sortByValue);
        const negativeUsedA = negative.phrases.filter(p => p.value > 0 && p.speaker === 'A').sort(sortByValue);
        const negativeUsedC = negative.phrases.filter(p => p.value > 0 && p.speaker === 'C').sort(sortByValue);
        const emotionsUsed = emotions.phrases.filter(p => p.value > 0).sort(sortByValue);

        const usedPositiveSet = new Set(positiveUsed.map(p => normalizePhraseForMatch(p.phrase)));
        const positiveUnusedFromDb = (sentimentPhraseDatabase.positive?.A || [])
            .filter(phrase => !usedPositiveSet.has(normalizePhraseForMatch(phrase)))
            .slice(0, 8);

        const snapshot = {
            associateName,
            timeframeStart: startDate,
            timeframeEnd: endDate,
            savedAt: new Date().toISOString(),
            topPhrases: {
                positiveA: toTopRows(positiveUsed),
                negativeA: toTopRows(negativeUsedA),
                negativeC: toTopRows(negativeUsedC),
                emotions: toTopRows(emotionsUsed)
            },
            suggestions: {
                positiveAdditions: positiveUnusedFromDb,
                negativeAlternatives: (sentimentPhraseDatabase.positive?.A || []).slice(0, 8),
                emotionCustomerCues: (sentimentPhraseDatabase.emotions?.C || []).slice(0, 8)
            }
        };

        if (!associateSentimentSnapshots[associateName]) {
            associateSentimentSnapshots[associateName] = [];
        }

        const existingIndex = associateSentimentSnapshots[associateName].findIndex(entry =>
            entry.timeframeStart === startDate && entry.timeframeEnd === endDate
        );

        if (existingIndex >= 0) {
            associateSentimentSnapshots[associateName][existingIndex] = snapshot;
        } else {
            associateSentimentSnapshots[associateName].push(snapshot);
        }

        associateSentimentSnapshots[associateName] = associateSentimentSnapshots[associateName]
            .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
            .slice(0, 200);

        console.log('💾 Saving sentiment snapshot:', { associateName, startDate, endDate, snapshot });
        console.log('📦 All snapshots after save:', associateSentimentSnapshots);

        saveAssociateSentimentSnapshots();
        populateDeleteSentimentDropdown();
        renderSentimentDatabasePanel();
        showToast(`✅ Saved sentiment snapshot for ${associateName} (${startDate} to ${endDate})`, 3000);
    }

    function formatSentimentSnapshotForPrompt(snapshotData, startDate, endDate) {
        /**
         * Convert sentiment snapshot data to prompt-compatible format.
         * Supports phrases-only uploads (no percentages/calls) and legacy data.
         */
        if (!snapshotData) return null;

        const existingScores = snapshotData.scores || null;
        const fallbackScores = {
            positiveWord: snapshotData.positive?.percentage || 0,
            negativeWord: snapshotData.negative?.percentage || 0,
            managingEmotions: snapshotData.emotions?.percentage || 0
        };

        const formatted = {
            timeframeStart: startDate,
            timeframeEnd: endDate,
            scores: existingScores || fallbackScores,
            calls: snapshotData.calls || {
                positiveTotal: snapshotData.positive?.totalCalls || 0,
                positiveDetected: snapshotData.positive?.callsDetected || 0,
                negativeTotal: snapshotData.negative?.totalCalls || 0,
                negativeDetected: snapshotData.negative?.callsDetected || 0,
                emotionsTotal: snapshotData.emotions?.totalCalls || 0,
                emotionsDetected: snapshotData.emotions?.callsDetected || 0
            },
            topPhrases: snapshotData.topPhrases || {
                positiveA: (snapshotData.positive?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'A' })),
                negativeA: (snapshotData.negative?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'A' })),
                negativeC: (snapshotData.negative?.phrases || []).filter(p => p.speaker === 'C').map(p => ({ phrase: p.phrase, value: p.value, speaker: 'C' })),
                emotions: (snapshotData.emotions?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'C' }))
            },
            suggestions: snapshotData.suggestions || {
                negativeAlternatives: ['solution-focused language', 'collaborative phrasing', 'positive ownership'],
                positiveAdditions: ['I appreciate', 'happy to help', 'glad to assist']
            }
        };

        return formatted;
    }

    function buildSentimentFocusAreasForPrompt(snapshot, weeklyMetrics = null) {
        if (!snapshot) return '';

        const negativeTarget = METRICS_REGISTRY.negativeWord?.target?.value || 83;
        const positiveTarget = METRICS_REGISTRY.positiveWord?.target?.value || 86;
        const emotionsTarget = METRICS_REGISTRY.managingEmotions?.target?.value || 95;

        const hasScoreData = snapshot.scores && Object.values(snapshot.scores).some(value => Number(value) > 0);
        const scoreSource = weeklyMetrics || (hasScoreData ? snapshot.scores : null);

        const focusLines = [];

        if (!scoreSource) {
            const topPos = (snapshot.topPhrases?.positiveA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ');
            const topNeg = (snapshot.topPhrases?.negativeA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ');
            const cues = (snapshot.topPhrases?.emotions || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ');

            if (topPos) focusLines.push(`Positive keywords used: ${topPos}.`);
            if (topNeg) focusLines.push(`Negative keywords used: ${topNeg}.`);
            if (cues) focusLines.push(`Customer emotion cues heard: ${cues}.`);

            return focusLines.length > 0
                ? focusLines.join('\n')
                : 'Sentiment keyword report available, but no frequent phrases were captured.';
        }

        const negScore = Number(scoreSource.negativeWord || 0);
        const posScore = Number(scoreSource.positiveWord || 0);
        const emoScore = Number(scoreSource.managingEmotions || 0);

        if (negScore < negativeTarget) {
            const usingNegative = 100 - negScore;
            const usingNegativeTarget = 100 - negativeTarget;
            const topNeg = (snapshot.topPhrases?.negativeA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ') || 'none listed';
            const replacements = (snapshot.suggestions?.negativeAlternatives || []).slice(0, 3).join(', ') || 'solution-focused alternatives';
            focusLines.push(
                `Focus Area - Avoiding Negative Words: ${negScore}% (Using Negative Words: ${usingNegative}%). Target: ${negativeTarget}% (Using Negative Words: ${usingNegativeTarget}%). ` +
                `Most used phrases: ${topNeg}. Try saying this instead: ${replacements}.`
            );
        }

        if (posScore < positiveTarget) {
            const topPos = (snapshot.topPhrases?.positiveA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ') || 'none listed';
            const additions = (snapshot.suggestions?.positiveAdditions || []).slice(0, 3).join(', ') || 'positive ownership phrases';
            focusLines.push(
                `Focus Area - Using Positive Words: ${posScore}% (Target: ${positiveTarget}%). ` +
                `Most used phrases: ${topPos}. Add these phrases to every call: ${additions}.`
            );
        }

        if (emoScore < emotionsTarget) {
            const cues = (snapshot.topPhrases?.emotions || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ') || 'no frequent cues captured';
            focusLines.push(
                `Focus Area - Managing emotions is at ${emoScore}%, target is ${emotionsTarget}%. ` +
                `Heightened customer phrases detected: ${cues}. Use de-escalation acknowledgment before solving.`
            );
        }

        if (focusLines.length === 0) {
            return 'In the latest report, sentiment metrics are meeting targets. Reinforce consistency and continue current phrasing habits.';
        }

        return focusLines.join('\n');
    }

    function containsCurseWords(phrase) {
        if (!phrase) return false;
        const lowerPhrase = phrase.toLowerCase();
        return CURSE_WORDS.some(word => lowerPhrase.includes(word));
    }

    function censorCurseWords(phrase) {
        if (!phrase) return phrase;
        let censored = phrase;
        const lowerPhrase = phrase.toLowerCase();
        CURSE_WORDS.forEach(word => {
            const regex = new RegExp(word, 'gi');
            if (lowerPhrase.includes(word)) {
                censored = censored.replace(regex, '[censored]');
            }
        });
        return censored;
    }

    function buildPositiveLanguageSentimentSection(positive, associateName) {
        let section = '';
        section += `═══════════════════════════════════\n`;
        section += `POSITIVE LANGUAGE\n`;
        section += `═══════════════════════════════════\n`;
        section += `Keywords Summary (phrases used)\n\n`;

        const posUsedPhrases = positive.phrases
            .filter(p => p.value > 0 && !containsCurseWords(p.phrase))
            .sort((a, b) => b.value - a.value);
        if (posUsedPhrases.length > 0) {
            section += `✓ DOING WELL - You used these positive words/phrases:\n`;
            posUsedPhrases.slice(0, SENTIMENT_TOP_WINS_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - ${p.value} calls\n`;
            });
            if (posUsedPhrases.length > SENTIMENT_TOP_WINS_COUNT) {
                section += `  [... and ${posUsedPhrases.length - SENTIMENT_TOP_WINS_COUNT} more positive phrases]\n`;
            }
        } else {
            section += `✓ DOING WELL:\n`;
            section += `  • No strong positive phrases detected in this period\n`;
        }
        section += `\n`;

        const posUnusedPhrases = positive.phrases
            .filter(p => p.value === 0 && !containsCurseWords(p.phrase))
            .sort((a, b) => a.value - b.value);
        if (posUnusedPhrases.length > 0) {
            section += `⬆ INCREASE YOUR SCORE - Try using these phrases more often:\n`;
            posUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}"\n`;
            });
        }
        section += `\n`;

        section += `📝 SCRIPTED OPENING (with positive language):\n`;
        section += `  "Hello! Thank you for calling. My name is ${escapeHtml(associateName)}. I'm here to\n`;
        section += `   help you and I appreciate the opportunity to assist you today."\n\n`;

        section += `📝 OWNERSHIP STATEMENT (take responsibility):\n`;
        section += `  "I understand this is important to you. I'm going to take ownership of\n`;
        section += `   this and personally ensure we get this resolved for you."\n\n`;

        section += `📝 SCRIPTED CLOSING (with positive language):\n`;
        section += `  "I truly appreciate you taking the time to work with me on this. We've\n`;
        section += `   accomplished great things together today, and I'm delighted we could help."\n\n`;

        return section;
    }

    function buildNegativeLanguageSentimentSection(negative) {
        let section = '';
        section += `═══════════════════════════════════\n`;
        section += `AVOIDING NEGATIVE LANGUAGE\n`;
        section += `═══════════════════════════════════\n`;
        section += `Keywords Summary (phrases used)\n\n`;

        const assocNegative = negative.phrases.filter(p => p.speaker === 'A' && p.value > 0 && !containsCurseWords(p.phrase));
        const assocNegativeUnused = negative.phrases.filter(p => p.speaker === 'A' && p.value === 0 && !containsCurseWords(p.phrase));
        const custNegative = negative.phrases.filter(p => p.speaker === 'C' && p.value > 0 && !containsCurseWords(p.phrase));

        if (assocNegative.length === 0) {
            section += `✓ EXCELLENT - Minimal negative language in your calls\n`;
            section += `  • You're avoiding negative words effectively\n`;
        } else {
            section += `⚠ PHRASES YOU USED - These came out in your calls, avoid them:\n`;
            assocNegative.sort((a, b) => b.value - a.value).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - used ${p.value} times\n`;
            });
        }
        section += `\n`;

        if (assocNegativeUnused.length > 0) {
            section += `🛡 WATCH OUT - Database phrases you haven't used yet (prevent bad habits):\n`;
            assocNegativeUnused.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - Don't let this slip in\n`;
            });
        }
        section += `\n`;

        const negativeReplacements = {
            'not sure': 'I\'ll find out for you',
            'an error': 'Let me correct that for you',
            'we can\'t': 'Here\'s what we can do',
            'can\'t': 'We can',
            'no way': 'I understand, let\'s work on this',
            'i can\'t': 'I can help you with',
            'no': 'Yes, I can',
            'unable': 'I\'m able to help you',
            'don\'t': 'Do',
            'sorry but': 'I apologize and here\'s how I\'ll fix this',
            'unfortunately': 'Great news - here\'s what we can do'
        };

        section += `✅ POSITIVE ALTERNATIVES - Say these instead:\n`;
        if (assocNegative.length > 0) {
            assocNegative.sort((a, b) => b.value - a.value).slice(0, 3).forEach(p => {
                const phrase = p.phrase.toLowerCase().replace(/[^a-z0-9\s]/g, '');
                const replacement = Object.entries(negativeReplacements).find(([key]) => phrase.includes(key))?.[1];
                if (replacement) {
                    section += `  • Instead of "${censorCurseWords(p.phrase)}" → "${replacement}"\n`;
                }
            });
        } else {
            section += `  • "I understand your concern, here's how I can help"\n`;
            section += `  • "Let me find a solution for you"\n`;
            section += `  • "I appreciate you working with me on this"\n`;
        }
        section += `\n`;

        if (custNegative.length > 0) {
            section += `📌 CUSTOMER CONTEXT - They said (understand their frustration):\n`;
            custNegative.sort((a, b) => b.value - a.value).slice(0, SENTIMENT_CUSTOMER_CONTEXT_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - detected ${p.value} times\n`;
            });
            section += `  → Acknowledge their concern, don't make excuses\n`;
        }
        section += `\n`;

        section += `📝 SCRIPTED RESPONSE (when customer is frustrated):\n`;
        section += `  "I hear your frustration, and I completely understand. I'm committed to\n`;
        section += `   finding a solution for you right now. Let me see what I can do for you."\n\n`;

        return section;
    }

    function buildManagingEmotionsSentimentSection(emotions) {
        let section = '';
        section += `═══════════════════════════════════\n`;
        section += `MANAGING EMOTIONS\n`;
        section += `═══════════════════════════════════\n`;
        section += `Coverage: ${emotions.callsDetected} / ${emotions.totalCalls} calls (${emotions.percentage}%)\n\n`;

        const emotionUsedPhrases = emotions.phrases.filter(p => p.value > 0 && !containsCurseWords(p.phrase));
        const emotionUnusedPhrases = emotions.phrases.filter(p => p.value === 0 && !containsCurseWords(p.phrase));

        if (emotionUsedPhrases.length === 0 || emotions.percentage <= SENTIMENT_EMOTION_LOW_THRESHOLD) {
            section += `✓ STRONG PERFORMANCE - You're managing customer emotions effectively\n`;
            section += `  • Low emotion escalation (${emotions.percentage}%) - Calming presence detected\n`;
        } else {
            section += `📌 EMOTION INDICATORS DETECTED - Customer emotional phrases in calls:\n`;
            emotionUsedPhrases.sort((a, b) => b.value - a.value).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - detected in ${p.value} calls\n`;
            });
        }
        section += `\n`;

        if (emotionUnusedPhrases.length > 0) {
            section += `🛡 WATCH OUT - Emotion phrases to prevent (haven't shown up yet):\n`;
            emotionUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - Avoid letting this develop\n`;
            });
        }
        section += `\n`;

        section += `✅ TECHNIQUES TO MASTER - How to manage emotions:\n`;
        section += `  • Acknowledge their feelings first: "I can hear the frustration in your voice"\n`;
        section += `  • Show you understand: "If I were in your position, I'd feel the same way"\n`;
        section += `  • Don't interrupt or talk over them - let them finish\n`;
        section += `  • Take action, not excuses: "Here's exactly what I'm going to do..."\n`;
        section += `  • Follow up: "I'll personally make sure this gets resolved for you"\n`;
        section += `\n`;

        section += `📝 SCRIPTED RESPONSE (when emotion is high):\n`;
        section += `  "I completely understand your frustration. I'm listening to you, and I want\n`;
        section += `   you to know I'm going to take personal ownership of this. Let me get this\n`;
        section += `   resolved for you right now. Here's what I can do..."\n\n`;

        return section;
    }

    function generateSentimentSummary() {
        const { positive, negative, emotions } = sentimentReports;

        // Validation: ensure all 3 files uploaded
        if (!positive || !negative || !emotions) {
            alert('⚠️ Please upload all 3 files (Positive Language, Avoiding Negative Language, Managing Emotions)');
            return;
        }

        const delegated = window.DevCoachModules?.sentiment?.buildSentimentSummaryText;
        let summary = '';
        if (typeof delegated === 'function') {
            const composed = delegated(
                { positive, negative, emotions },
                {
                    escapeHtml,
                    buildPositiveLanguageSentimentSection,
                    buildNegativeLanguageSentimentSection,
                    buildManagingEmotionsSentimentSection
                }
            );
            summary = composed?.summary || '';
        }

        if (!summary) {
            alert('⚠️ Sentiment module is unavailable or could not build summary. Refresh and try again.');
            return;
        }

        // Display the summary
        document.getElementById('sentimentSummaryText').textContent = summary;
        document.getElementById('sentimentSummaryOutput').style.display = 'block';

        showToast('✅ Summary generated successfully', 2000);
    }

    function parseSentimentReportDate(line, label) {
        if (!line || !line.toLowerCase().includes(`${label} date`)) {
            return '';
        }

        const dateMatch = line.match(new RegExp(`${label}\\s+date[:\\s,]*"?([0-9]{1,2}[/\\-][0-9]{1,2}[/\\-][0-9]{2,4})`, 'i'));
        if (dateMatch) {
            return dateMatch[1].trim();
        }

        console.warn(`⚠️ Found "${label} date" line but couldn't parse: "${line}"`);
        return '';
    }

    function handleSentimentInteractionsMatch(report, inKeywordsSection, allInteractionsMatches, interactionsMatch, line, lineIndex) {
        const callsDetected = parseInt(interactionsMatch[1]);
        const percentage = parseInt(interactionsMatch[2]);
        const totalCalls = parseInt(interactionsMatch[3]);

        console.log(`📊 PARSE DEBUG - FOUND Interactions at line ${lineIndex}: ${percentage}% (inKeywordsSection=${inKeywordsSection})`);
        allInteractionsMatches.push({
            lineIndex,
            lineContent: line,
            callsDetected: callsDetected,
            percentage: percentage,
            totalCalls: totalCalls,
            inKeywordsSection: inKeywordsSection
        });

        if (inKeywordsSection && !report.inKeywordsSection) {
            report.callsDetected = callsDetected;
            report.percentage = percentage;
            report.totalCalls = totalCalls;
            report.inKeywordsSection = true;
            console.log(`✅ SET METRICS (in keywords section): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
        } else if (!inKeywordsSection && !report.inKeywordsSection) {
            report.callsDetected = callsDetected;
            report.percentage = percentage;
            report.totalCalls = totalCalls;
            console.log(`⚠️ TENTATIVE METRICS (no keywords section yet): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
        }
    }

    function appendParsedSentimentPhrase(phrases, rawPhrase, value, fallbackMode = 'none') {
        const extracted = extractSentimentSpeakerAndPhrase(rawPhrase);
        if (extracted) {
            phrases.push({ phrase: extracted.phrase, value, speaker: extracted.speaker });
            return true;
        }

        if (fallbackMode === 'defaultA') {
            const cleanPhrase = String(rawPhrase || '').replace(/^"(.*)"$/, '$1');
            phrases.push({ phrase: cleanPhrase, value, speaker: 'A' });
            return true;
        }

        if (fallbackMode === 'simpleTagged') {
            const simpleMatch = String(rawPhrase || '').match(/[+\-#]\s*\(([AC]):\s*"?([^")]+)"?\)/i);
            if (simpleMatch) {
                const speaker = simpleMatch[1].toUpperCase();
                const cleanPhrase = simpleMatch[2].trim();
                phrases.push({ phrase: cleanPhrase, value, speaker });
                return true;
            }
        }

        return false;
    }

    function parseSentimentKeywordLine(report, line, pendingPhrase) {
        const csvQuotedMatch = line.match(/^"([^"]+(?:""[^"]+)*)",(\d+)/);
        if (csvQuotedMatch) {
            const rawPhrase = csvQuotedMatch[1].replace(/""/g, '"').trim();
            const value = parseInt(csvQuotedMatch[2]);
            appendParsedSentimentPhrase(report.phrases, rawPhrase, value, 'none');
            return { handled: true, pendingPhrase };
        }

        const csvMatch = line.match(/^([^,]+),(\d+)$/);
        if (csvMatch) {
            const rawPhrase = csvMatch[1].trim();
            const value = parseInt(csvMatch[2]);
            appendParsedSentimentPhrase(report.phrases, rawPhrase, value, 'defaultA');
            return { handled: true, pendingPhrase };
        }

        if (line.match(/^[+\-#]/)) {
            return { handled: true, pendingPhrase: line.trim() };
        }

        if (pendingPhrase && line.match(/^\d+$/)) {
            const value = parseInt(line.trim());
            appendParsedSentimentPhrase(report.phrases, pendingPhrase, value, 'simpleTagged');
            return { handled: true, pendingPhrase: null };
        }

        return { handled: false, pendingPhrase };
    }

    function logSentimentParseCompletion(fileType, report, allInteractionsMatches) {
        console.log(`📊 PARSE COMPLETE [fileType=${fileType}] - All Interactions matches found:`, allInteractionsMatches);
        console.log(`📊 PARSE COMPLETE [fileType=${fileType}] - Final report:`, report);
        console.log(`📊 PARSE COMPLETE [fileType=${fileType}] - Percentages: callsDetected=${report.callsDetected}, totalCalls=${report.totalCalls}, percentage=${report.percentage}%, inKeywordsSection=${report.inKeywordsSection}`);

        if (report.percentage === 0) {
            console.error(`⚠️ WARNING: ${fileType} percentage is 0. This might mean:`);
            console.error(`   - No Interactions line was found in the file`);
            console.error(`   - The regex didn't match the email format`);
            console.error(`   - The Keywords section was never detected (inKeywordsSection=${report.inKeywordsSection})`);
            console.error(`   - All ${allInteractionsMatches.length} Interactions matches were before keywords section`);
        }
    }

    function isSentimentKeywordsSectionLine(line) {
        const normalized = String(line || '').toLowerCase();
        return normalized.includes('keywords') || normalized.includes('query result metrics');
    }

    function isSentimentHeaderLine(line) {
        const trimmed = String(line || '').trim();
        return trimmed === 'Name' || trimmed === 'Value' || /^Name,Value/i.test(trimmed);
    }

    function parseSentimentAssociateName(line) {
        if (!line || line.length <= 10) {
            return '';
        }

        const nameMatch = line.match(/^(?:Employee|Agent|Name)[:\s]+(.+)$/i);
        return nameMatch ? nameMatch[1].trim() : '';
    }

    function createEmptySentimentReport() {
        return {
            associateName: '',
            startDate: '',
            endDate: '',
            totalCalls: 0,
            callsDetected: 0,
            percentage: 0,
            phrases: [],
            inKeywordsSection: false
        };
    }

    function parseSentimentFile(fileType, lines) {
        // Parse the "English Speech – Charts Report" format
        console.log(`📊 PARSE START - fileType=${fileType}, total lines=${lines.length}`);
        console.log(`📊 PARSE START - First 10 lines:`, lines.slice(0, 10));

        const report = createEmptySentimentReport();

        let inKeywordsSection = false;
        let pendingPhrase = null; // For handling phrase/value on separate lines
        let allInteractionsMatches = []; // Track ALL Interactions lines found

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (!report.associateName) {
                const associateName = parseSentimentAssociateName(line);
                if (associateName) {
                    report.associateName = associateName;
                }
            }

            if (!report.startDate) {
                const startDate = parseSentimentReportDate(line, 'start');
                if (startDate) {
                    report.startDate = startDate;
                    console.log(`✅ Found start date: ${report.startDate}`);
                }
            }

            if (!report.endDate) {
                const endDate = parseSentimentReportDate(line, 'end');
                if (endDate) {
                    report.endDate = endDate;
                    console.log(`✅ Found end date: ${report.endDate}`);
                }
            }

            // Extract total calls and calls with category detected
            // Format in Excel CSV: "Interactions:,165 (76% out of 218 matching data filter),,"
            console.log(`📊 PARSE DEBUG [fileType=${fileType}] - Line ${i}: "${line}"`);
            const interactionsMatch = line.match(/Interactions:?,?\s*(\d+)\s*\(.*?(\d+)%.*?out\s+of\s+(\d+)/i);
            if (interactionsMatch) {
                handleSentimentInteractionsMatch(report, inKeywordsSection, allInteractionsMatches, interactionsMatch, line, i);
                continue;
            }

            // Detect keywords section
            if (isSentimentKeywordsSectionLine(line)) {
                inKeywordsSection = true;
                console.log(`✅ Found keywords section at line ${i}`);
                continue;
            }

            // Skip "Name" and "Value" header lines
            if (isSentimentHeaderLine(line)) {
                console.log(`Skipping header line: "${line}"`);
                continue;
            }

            // Parse keyword phrases - handling BOTH formats
            if (inKeywordsSection && report.totalCalls > 0) {
                const keywordLineResult = parseSentimentKeywordLine(report, line, pendingPhrase);
                pendingPhrase = keywordLineResult.pendingPhrase;
                if (keywordLineResult.handled) {
                    continue;
                }
            }
        }

        logSentimentParseCompletion(fileType, report, allInteractionsMatches);

        return report;
    }

    function extractSentimentSpeakerAndPhrase(rawPhrase) {
        if (!rawPhrase) return null;
        const compact = String(rawPhrase).trim();
        const tagged = compact.match(/[+\-#]?\s*\(([AC]):\s*(.+)\)$/i);
        if (tagged) {
            return {
                speaker: tagged[1].toUpperCase(),
                phrase: tagged[2].trim().replace(/^"|"$/g, '')
            };
        }

        const direct = compact.match(/^([AC]):\s*(.+)$/i);
        if (direct) {
            return {
                speaker: direct[1].toUpperCase(),
                phrase: direct[2].trim().replace(/^"|"$/g, '')
            };
        }

        return null;
    }

    function openSentimentPasteModal(fileType) {
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 10000;';

        // Create modal dialog
        const modal = document.createElement('div');
        modal.style.cssText = 'background: white; border-radius: 8px; padding: 30px; max-width: 600px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

        modal.innerHTML = `
            <h2 style="margin-top: 0; color: #333;">Paste ${fileType} Sentiment Data</h2>
            <p style="color: #666; margin-bottom: 15px;">Paste your CSV or Excel data below. Format: one entry per line, with columns for Speaker (A/C) and Phrase.</p>
            <textarea id="pasteArea" style="width: 100%; height: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 12px; resize: vertical;" placeholder="Paste data here..."></textarea>
            <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
                <button id="pasteCancelBtn" style="padding: 10px 20px; background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 14px;">Cancel</button>
                <button id="pasteSubmitBtn" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Parse & Import</button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Get button references from the modal
        const textarea = modal.querySelector('#pasteArea');
        const cancelBtn = modal.querySelector('#pasteCancelBtn');
        const submitBtn = modal.querySelector('#pasteSubmitBtn');

        // Focus textarea
        textarea.focus();

        // Cancel button
        cancelBtn.addEventListener('click', () => {
            backdrop.remove();
        });

        // Submit button
        submitBtn.addEventListener('click', () => {
            const pastedText = textarea.value.trim();
            if (!pastedText) {
                alert('Please paste some data');
                return;
            }

            const lines = pastedText.split('\n').filter(line => line.trim());
            const statusDiv = document.getElementById(`sentiment${fileType}Status`);

            statusDiv.textContent = `⏳ Processing pasted ${fileType.toLowerCase()} data...`;
            statusDiv.style.color = '#ff9800';

            try {
                // Parse pasted data using existing parser
                const report = parseSentimentFile(fileType, lines);
                sentimentReports[fileType.toLowerCase()] = report;

                // Update UI
                syncSentimentSnapshotDateInputsFromReports();

                // Show success status
                statusDiv.textContent = `✅ Parsed ${report.phrases.length} sentiment phrase(s) from ${report.speakers.size} speaker(s)`;
                statusDiv.style.color = '#4CAF50';

                // Close modal
                backdrop.remove();
            } catch (error) {
                console.error('Error parsing pasted data:', error);
                statusDiv.textContent = `❌ Error: ${error.message}`;
                statusDiv.style.color = '#f44336';
            }
        });

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
            }
        });
    }

    function handleSentimentFileChange(fileType) {
        const fileInput = document.getElementById(`sentiment${fileType}File`);
        const statusDiv = document.getElementById(`sentiment${fileType}Status`);

        if (!fileInput.files || fileInput.files.length === 0) {
            statusDiv.textContent = 'No file selected';
            statusDiv.style.color = '#666';
            sentimentReports[fileType.toLowerCase()] = null;
            return;
        }

        const file = fileInput.files[0];
        const fileName = file.name.toLowerCase();
        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
        const isEmotions = fileType === 'Emotions';

        statusDiv.textContent = `⏳ Processing ${file.name}...`;
        statusDiv.style.color = '#ff9800';
        showLoadingSpinner(`Processing ${escapeHtml(file.name)}...`);

        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                let lines = [];

                if (isExcel) {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const csvContent = XLSX.utils.sheet_to_csv(firstSheet);
                    lines = csvContent.split('\n').filter(line => line.trim());
                    if (isEmotions) {
                        console.log(`🎭 MANAGING EMOTIONS - Excel file converted to ${lines.length} lines`);
                        console.log('🎭 First 30 lines:', lines.slice(0, 30));
                    }
                } else {
                    const content = e.target.result;
                    lines = content.split('\n').filter(line => line.trim());
                    if (isEmotions) {
                        console.log(`🎭 MANAGING EMOTIONS - Text file has ${lines.length} lines`);
                    }
                }

                // Parse file
                const report = parseSentimentFile(fileType, lines);
                sentimentReports[fileType.toLowerCase()] = report;

                if (isEmotions) {
                    console.log(`🎭 MANAGING EMOTIONS - Parsed result:`, {
                        name: report.associateName,
                        totalCalls: report.totalCalls,
                        detected: report.callsDetected,
                        percentage: report.percentage,
                        phrasesCount: report.phrases.length,
                        allPhrases: report.phrases
                    });
                } else {
                    console.log(`✅ Parsed ${fileType}:`, {
                        name: report.associateName,
                        totalCalls: report.totalCalls,
                        detected: report.callsDetected,
                        percentage: report.percentage,
                        phrasesCount: report.phrases.length
                    });
                }

                statusDiv.textContent = `✅ ${escapeHtml(report.associateName || 'Loaded')} - ${report.totalCalls} calls, ${report.phrases.length} phrases`;
                statusDiv.style.color = '#4caf50';
                syncSentimentSnapshotDateInputsFromReports();
                hideLoadingSpinner();
            } catch (error) {
                statusDiv.textContent = `❌ Error parsing file`;
                statusDiv.style.color = '#f44336';
                console.error('File parsing error:', error);
                if (isEmotions) {
                    console.error('🎭 MANAGING EMOTIONS ERROR:', error);
                }
                hideLoadingSpinner();
                showToast(`❌ Failed to parse ${fileType} file: ${error.message}`, 5000);
            }
        };

        reader.onerror = () => {
            statusDiv.textContent = '❌ Failed to read file';
            statusDiv.style.color = '#f44336';
            hideLoadingSpinner();
            showToast('❌ Failed to read file', 5000);
        };

        if (isExcel) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    }

    function openUploadSentimentModal() {
        const modal = document.getElementById('uploadSentimentModal');
        if (!modal) return;

        // Populate associate dropdown
        populateSentimentAssociateDropdown();

        // Reset form
        document.getElementById('sentimentUploadAssociate').value = '';
        document.getElementById('sentimentUploadPullDate').value = '';
        document.getElementById('sentimentUploadPositiveFile').value = '';
        document.getElementById('sentimentUploadNegativeFile').value = '';
        document.getElementById('sentimentUploadEmotionsFile').value = '';
        const statusDiv = document.getElementById('sentimentUploadStatus');
        if (statusDiv) {
            statusDiv.style.display = 'none';
            statusDiv.textContent = '';
        }

        modal.style.display = 'flex';
    }

    function closeUploadSentimentModal() {
        const modal = document.getElementById('uploadSentimentModal');
        if (modal) modal.style.display = 'none';
    }

    function populateSentimentAssociateDropdown() {
        const select = document.getElementById('sentimentUploadAssociate');
        if (!select) return;

        const allEmployees = new Set();
        const teamFilterContext = getTeamSelectionContext();

        // Collect all unique employee names from weeklyData
        for (const weekKey in weeklyData) {
            const week = weeklyData[weekKey];
            if (week.employees && Array.isArray(week.employees)) {
                week.employees.forEach(emp => {
                    if (emp.name && isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                        allEmployees.add(emp.name);
                    }
                });
            }
        }

        // Sort and populate dropdown
        const sortedEmployees = Array.from(allEmployees).sort();
        select.innerHTML = '<option value="">-- Select an associate --</option>';
        sortedEmployees.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
    }

    function handleSentimentUploadSubmit() {
        const associate = document.getElementById('sentimentUploadAssociate').value;
        const pullDate = document.getElementById('sentimentUploadPullDate').value;
        const positiveFileInput = document.getElementById('sentimentUploadPositiveFile');
        const negativeFileInput = document.getElementById('sentimentUploadNegativeFile');
        const emotionsFileInput = document.getElementById('sentimentUploadEmotionsFile');
        const statusDiv = document.getElementById('sentimentUploadStatus');

        // Validation
        if (!associate) {
            alert('Please select an associate');
            return;
        }
        if (!pullDate) {
            alert('Please enter the pull date');
            return;
        }

        // Check if at least one file is selected
        const hasPositive = positiveFileInput.files && positiveFileInput.files.length > 0;
        const hasNegative = negativeFileInput.files && negativeFileInput.files.length > 0;
        const hasEmotions = emotionsFileInput.files && emotionsFileInput.files.length > 0;

        if (!hasPositive && !hasNegative && !hasEmotions) {
            alert('Please select at least one sentiment file to upload');
            return;
        }

        // Calculate date range (14 days prior to pull date)
        const endDate = pullDate;
        const pullDateObj = new Date(pullDate);
        pullDateObj.setDate(pullDateObj.getDate() - 14);
        const startDate = pullDateObj.toISOString().split('T')[0];

        // Initialize snapshot storage
        if (!associateSentimentSnapshots[associate]) {
            associateSentimentSnapshots[associate] = {};
        }

        const timeframeKey = `${startDate}_${endDate}`;
        if (!associateSentimentSnapshots[associate][timeframeKey]) {
            associateSentimentSnapshots[associate][timeframeKey] = {
                startDate,
                endDate,
                pullDate,
                positive: null,
                negative: null,
                emotions: null
            };
        }

        statusDiv.textContent = '⏳ Processing files...';
        statusDiv.style.color = '#ff9800';
        statusDiv.style.display = 'block';

        // Process files
        const filePromises = [];

        if (hasPositive) {
            filePromises.push(
                processUploadedSentimentFile(positiveFileInput.files[0], 'Positive', associate, timeframeKey)
            );
        }

        if (hasNegative) {
            filePromises.push(
                processUploadedSentimentFile(negativeFileInput.files[0], 'Negative', associate, timeframeKey)
            );
        }

        if (hasEmotions) {
            filePromises.push(
                processUploadedSentimentFile(emotionsFileInput.files[0], 'Emotions', associate, timeframeKey)
            );
        }

        Promise.all(filePromises)
            .then(results => {
                // Save all processed data
                results.forEach(({ type, report }) => {
                    const typeKey = type.toLowerCase();
                    // Only save phrases - percentages come from weekly metrics, not sentiment files
                    associateSentimentSnapshots[associate][timeframeKey][typeKey] = {
                        phrases: report.phrases
                    };
                });

                // Save to localStorage
                saveAssociateSentimentSnapshots();

                // IMPORTANT: Convert from old format to new array format immediately
                loadAssociateSentimentSnapshots();  // This migrates old format to new array format

                // Repopulate dropdown with migrated data
                if (window.setupMetricTrendsListeners && typeof setupMetricTrendsListeners === 'function') {
                    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
                    if (trendEmployeeSelect && trendEmployeeSelect.value === associate) {
                        populateTrendSentimentDropdown(associate);
                    }
                }

                const uploadedTypes = results.map(r => r.type).join(', ');
                statusDiv.textContent = `✅ Saved ${uploadedTypes} for ${associate} (pulled ${pullDate})`;
                statusDiv.style.color = '#4CAF50';

                showToast(`✅ Sentiment data saved for ${associate}`, 3000);

                // Close modal after short delay
                setTimeout(() => {
                    closeUploadSentimentModal();
                }, 1500);
            })
            .catch(error => {
                statusDiv.textContent = `❌ Error: ${error.message}`;
                statusDiv.style.color = '#f44336';
                console.error('Upload sentiment error:', error);
            });
    }

    function processUploadedSentimentFile(file, type, associate, timeframeKey) {
        return new Promise((resolve, reject) => {
            const fileName = file.name.toLowerCase();
            const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
            console.log(`📊 PROCESS START - File: ${file.name}, Type: ${type}, Associate: ${associate}, TimeframeKey: ${timeframeKey}`);

            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    let lines = [];

                    if (isExcel) {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        const csvContent = XLSX.utils.sheet_to_csv(firstSheet);
                        lines = csvContent.split('\n').filter(line => line.trim());
                    } else {
                        const content = e.target.result;
                        lines = content.split('\n').filter(line => line.trim());
                    }

                    // Parse file
                    const report = parseSentimentFile(type, lines);
                    console.log(`📊 PROCESS PARSED - Type: ${type}, Report percentage: ${report.percentage}%, callsDetected: ${report.callsDetected}, totalCalls: ${report.totalCalls}`);
                    resolve({ type, report });

                } catch (error) {
                    reject(new Error(`Failed to parse ${type} file: ${error.message}`));
                }
            };

            reader.onerror = () => {
                reject(new Error(`Failed to read ${type} file`));
            };

            if (isExcel) {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsText(file);
            }
        });
    }

    function copySentimentSummary() {
        const summaryText = document.getElementById('sentimentSummaryText').textContent;

        if (!summaryText.trim()) {
            alert('⚠️ No summary to copy. Generate a summary first.');
            return;
        }

        // Copy to clipboard
        navigator.clipboard.writeText(summaryText).then(() => {
            const button = document.getElementById('copySentimentSummaryBtn');
            const originalText = button.textContent;
            button.textContent = '✅ Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
            showToast('✅ Summary copied to clipboard', 2000);
        }).catch(() => {
            showToast('⚠️ Unable to copy summary', 2000);
        });
    }

    function generateSentimentCoPilotPrompt() {
        const { positive, negative, emotions } = sentimentReports;

        if (!positive || !negative || !emotions) {
            alert('⚠️ Please generate the summary first');
            return;
        }

        const associateName = positive.associateName || 'the associate';
        const delegatedPrompt = window.DevCoachModules?.sentiment?.buildSentimentCopilotPrompt?.(
            { positive, negative, emotions },
            {
                associateName,
                POSITIVE_GOAL: 86,
                NEGATIVE_GOAL: 83,
                EMOTIONS_GOAL: 95,
                MIN_PHRASE_VALUE,
                TOP_PHRASES_COUNT,
                escapeHtml
            }
        );
        const prompt = delegatedPrompt || '';

        if (!prompt) {
            alert('⚠️ Could not generate CoPilot prompt from sentiment data.');
            return;
        }

        // Copy to clipboard and show feedback
        navigator.clipboard.writeText(prompt).then(() => {
            showToast('✅ CoPilot prompt copied! Opening CoPilot...', 2000);
            setTimeout(() => {
                window.open('https://copilot.microsoft.com', '_blank');
            }, 500);
        }).catch(() => {
            alert('Could not copy. Here\'s the prompt to manually copy:\n\n' + prompt);
        });
    }

    // Export all functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sentiment = {
        normalizePhraseList,
        normalizePhraseForMatch,
        formatKeywordPhraseForDisplay,
        normalizeDateStringForStorage,
        parseDateForComparison,
        ensureSentimentPhraseDatabaseDefaults,
        renderSentimentDatabasePanel,
        saveSentimentPhraseDatabaseFromForm,
        syncSentimentSnapshotDateInputsFromReports,
        saveAssociateSentimentSnapshotFromCurrentReports,
        formatSentimentSnapshotForPrompt,
        buildSentimentFocusAreasForPrompt,
        containsCurseWords,
        censorCurseWords,
        buildPositiveLanguageSentimentSection,
        buildNegativeLanguageSentimentSection,
        buildManagingEmotionsSentimentSection,
        generateSentimentSummary,
        parseSentimentReportDate,
        handleSentimentInteractionsMatch,
        appendParsedSentimentPhrase,
        parseSentimentKeywordLine,
        logSentimentParseCompletion,
        isSentimentKeywordsSectionLine,
        isSentimentHeaderLine,
        parseSentimentAssociateName,
        createEmptySentimentReport,
        parseSentimentFile,
        extractSentimentSpeakerAndPhrase,
        openSentimentPasteModal,
        handleSentimentFileChange,
        openUploadSentimentModal,
        closeUploadSentimentModal,
        populateSentimentAssociateDropdown,
        handleSentimentUploadSubmit,
        processUploadedSentimentFile,
        copySentimentSummary,
        generateSentimentCoPilotPrompt
    };

    window.normalizePhraseList = normalizePhraseList;
    window.normalizePhraseForMatch = normalizePhraseForMatch;
    window.formatKeywordPhraseForDisplay = formatKeywordPhraseForDisplay;
    window.normalizeDateStringForStorage = normalizeDateStringForStorage;
    window.parseDateForComparison = parseDateForComparison;
    window.ensureSentimentPhraseDatabaseDefaults = ensureSentimentPhraseDatabaseDefaults;
    window.renderSentimentDatabasePanel = renderSentimentDatabasePanel;
    window.saveSentimentPhraseDatabaseFromForm = saveSentimentPhraseDatabaseFromForm;
    window.syncSentimentSnapshotDateInputsFromReports = syncSentimentSnapshotDateInputsFromReports;
    window.saveAssociateSentimentSnapshotFromCurrentReports = saveAssociateSentimentSnapshotFromCurrentReports;
    window.formatSentimentSnapshotForPrompt = formatSentimentSnapshotForPrompt;
    window.buildSentimentFocusAreasForPrompt = buildSentimentFocusAreasForPrompt;
    window.containsCurseWords = containsCurseWords;
    window.censorCurseWords = censorCurseWords;
    window.buildPositiveLanguageSentimentSection = buildPositiveLanguageSentimentSection;
    window.buildNegativeLanguageSentimentSection = buildNegativeLanguageSentimentSection;
    window.buildManagingEmotionsSentimentSection = buildManagingEmotionsSentimentSection;
    window.generateSentimentSummary = generateSentimentSummary;
    window.parseSentimentReportDate = parseSentimentReportDate;
    window.handleSentimentInteractionsMatch = handleSentimentInteractionsMatch;
    window.appendParsedSentimentPhrase = appendParsedSentimentPhrase;
    window.parseSentimentKeywordLine = parseSentimentKeywordLine;
    window.logSentimentParseCompletion = logSentimentParseCompletion;
    window.isSentimentKeywordsSectionLine = isSentimentKeywordsSectionLine;
    window.isSentimentHeaderLine = isSentimentHeaderLine;
    window.parseSentimentAssociateName = parseSentimentAssociateName;
    window.createEmptySentimentReport = createEmptySentimentReport;
    window.parseSentimentFile = parseSentimentFile;
    window.extractSentimentSpeakerAndPhrase = extractSentimentSpeakerAndPhrase;
    window.openSentimentPasteModal = openSentimentPasteModal;
    window.handleSentimentFileChange = handleSentimentFileChange;
    window.openUploadSentimentModal = openUploadSentimentModal;
    window.closeUploadSentimentModal = closeUploadSentimentModal;
    window.populateSentimentAssociateDropdown = populateSentimentAssociateDropdown;
    window.handleSentimentUploadSubmit = handleSentimentUploadSubmit;
    window.processUploadedSentimentFile = processUploadedSentimentFile;
    window.copySentimentSummary = copySentimentSummary;
    window.generateSentimentCoPilotPrompt = generateSentimentCoPilotPrompt;
})();
