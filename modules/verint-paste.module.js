(function() {
    'use strict';

    /**
     * Recovers who was speaking from the colour of the pasted transcript.
     *
     * Verint has no option to export speaker labels. Its transcript is colour
     * coded instead, which is how Scott tells the two sides apart on screen,
     * and a textarea keeps only the plain text so that information was being
     * thrown away at the door.
     *
     * It does not have to be. A paste carries more than one flavour, and the
     * text/html one still has the colours in it. So the paste handler reads
     * that flavour, works out which colour is the advisor, and writes a
     * labelled transcript into the box instead of the bare text.
     *
     * This matters more than anything else in the call pipeline. Everything
     * the unlabelled path produces is a guess: which side said a scored
     * phrase, whose emotion cue it was, who was talking for most of the call,
     * and which line the customer opened with. That last guess quoted the
     * advisor's own words back to her as the customer's. With labels none of
     * it is inferred.
     *
     * Verint's exact clipboard markup is not something I can see from here, so
     * this is deliberately tolerant: inline styles, font tags, and failing
     * both of those, class names, which often separate speakers too. When it
     * cannot find two clean groups it returns null and the paste behaves
     * exactly as it did before. A wrong label is far worse than no label, so
     * every uncertain case declines.
     */

    // A run of text and the colour it was wearing.
    const BLOCK_TAGS = new Set(['br', 'p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'tbody']);
    // Tags whose contents are never speech. Only tags that close belong here:
    // <meta> used to be listed, and since it never closes, the <meta
    // charset="utf-8"> that Edge puts at the front of a copy switched the
    // skipping on for the rest of the paste. Every paste from Outlook on the
    // web came out empty.
    const SKIP_TAGS = new Set(['style', 'script', 'head', 'title', 'xml']);
    // Tags that never close. Written as <br> far more often than <br/>, and the
    // slash is the only thing the loop below used to check -- so a plain <br>
    // pushed a style frame that nothing ever popped. The next real </span> then
    // popped the <br>'s frame instead of the span's, leaving the advisor's
    // colour active, and every uncoloured line after it was labelled as the
    // advisor. One line break in the middle of a transcript put the customer's
    // words in the agent's mouth.
    const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'col', 'area', 'base', 'embed', 'param', 'track', 'wbr']);

    const ENTITIES = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
        '&apos;': "'", '&nbsp;': ' ', '&#160;': ' '
    };

    // The dash entities are matched by pattern rather than listed, because the
    // house rule bans those literals anywhere in a string and the no-em-dash
    // test cannot tell a decoder that removes one from copy that contains one.
    // It was right to flag it; the entity names are the banned strings.
    const DASH_ENTITY = /^&[mn]dash;$/i;
    const DASH_CHARS = /[‒-―−]/g;

    function decode(value) {
        return String(value || '')
            .replace(/&[a-z]+;|&#\d+;/gi, (match) => {
                const known = ENTITIES[match.toLowerCase()];
                if (known !== undefined) return known;
                if (DASH_ENTITY.test(match)) return ',';
                const numeric = match.match(/^&#(\d+);$/);
                if (numeric) {
                    const code = Number(numeric[1]);
                    return code > 31 && code < 0x10000 ? String.fromCharCode(code) : ' ';
                }
                return ' ';
            })
            // A dash that came through as a character rather than an entity.
            // Transcript text gets quoted into messages that go out with a
            // supervisor's name on them, so it follows the same rule.
            // Comma and a space: "that,one moment" is what a bare comma gives.
            .replace(DASH_CHARS, ', ');
    }

    /**
     * The colour an element declares, normalised so the same colour written
     * three ways groups as one.
     *
     * Falls back to a class name when there is no colour at all: a transcript
     * that separates speakers with `class="agent"` is just as usable, and
     * class based styling is common enough to be worth catching.
     */
    function styleKeyOf(attributes) {
        const inline = attributeValue(attributes, 'style');
        if (inline) {
            const colour = decode(inline).match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
            if (colour) return `c:${normalizeColour(colour[1])}`;
        }

        const fontColour = attributeValue(attributes, 'color');
        if (fontColour) return `c:${normalizeColour(fontColour)}`;

        const className = attributeValue(attributes, 'class');
        if (className && className.trim()) return `k:${className.trim().toLowerCase()}`;

        return '';
    }

    /**
     * One attribute's value, however it was quoted.
     *
     * Desktop Outlook writes style='font-family:"Calibri",sans-serif;color:#0070C0'.
     * Double quotes inside single quotes, and class=MsoNormal with no quotes at
     * all. The old pattern stopped at the first quote of either kind, so it read
     * the style as far as the font name and never reached the colour. Every
     * line of a paste from Outlook then looked the same.
     */
    function attributeValue(attributes, name) {
        const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
        const match = String(attributes || '').match(pattern);
        if (!match) return '';
        return match[1] ?? match[2] ?? match[3] ?? '';
    }

    // One colour written three ways has to group as one, and a transcript
    // really does mix them: "blue", "#0000FF" and "rgb(0, 0, 255)" all turned
    // up in the same paste and read as three speakers, so the whole thing
    // declined.
    const NAMED_COLOURS = {
        black: '0,0,0', white: '255,255,255', red: '255,0,0', lime: '0,255,0',
        blue: '0,0,255', yellow: '255,255,0', cyan: '0,255,255', aqua: '0,255,255',
        magenta: '255,0,255', fuchsia: '255,0,255', silver: '192,192,192',
        gray: '128,128,128', grey: '128,128,128', maroon: '128,0,0',
        olive: '128,128,0', green: '0,128,0', purple: '128,0,128',
        teal: '0,128,128', navy: '0,0,128', orange: '255,165,0'
    };

    function normalizeColour(value) {
        const text = String(value || '').trim().toLowerCase();

        const rgb = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgb) return `${Number(rgb[1])},${Number(rgb[2])},${Number(rgb[3])}`;

        const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
        if (hex) {
            const raw = hex[1].length === 3
                ? hex[1].split('').map((ch) => ch + ch).join('')
                : hex[1];
            return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16)).join(',');
        }

        const bare = text.replace(/\s+/g, '');
        return NAMED_COLOURS[bare] || bare;
    }

    /**
     * Splits pasted HTML into runs of text, each tagged with the style it
     * inherited.
     *
     * Hand rolled rather than DOMParser so the same code runs under the test
     * harness as in the browser. The markup on a clipboard is simple: spans
     * and font tags carrying a colour.
     */
    function extractRuns(html) {
        // The Windows clipboard header ("Version:0.9 StartHTML:...") arrives
        // in front of the markup when a browser hands it over raw.
        const source = String(html || '').replace(/^\s*Version:\d[\s\S]*?(?=<)/, '');
        const runs = [];
        const stack = [];
        let index = 0;
        let skipDepth = 0;

        const push = (text, newline) => {
            // Inside a style or script block there is no speech, only CSS that
            // happens to be text. It was being emitted because the text ran
            // out before the closing tag was seen, so a stylesheet arrived in
            // the transcript as a line somebody said.
            if (skipDepth) return;
            if (newline) {
                runs.push({ newline: true });
                return;
            }
            const value = decode(text).replace(/[ \t ]+/g, ' ');
            if (!value.trim()) return;
            runs.push({ text: value, key: stack.length ? stack[stack.length - 1] : '' });
        };

        while (index < source.length) {
            const open = source.indexOf('<', index);
            if (open === -1) {
                push(source.slice(index));
                break;
            }
            if (open > index) push(source.slice(index, open));

            // A comment ends at -->, not at the first >. Outlook's are full of
            // markup ("<!--[if gte mso 9]><xml>...</xml><![endif]-->").
            if (source.startsWith('<!--', open)) {
                const end = source.indexOf('-->', open + 4);
                index = end === -1 ? source.length : end + 3;
                continue;
            }

            const close = source.indexOf('>', open);
            if (close === -1) break;

            const tag = source.slice(open + 1, close);
            index = close + 1;

            if (tag.startsWith('!')) continue;

            const isClosing = tag.startsWith('/');
            const name = (isClosing ? tag.slice(1) : tag).trim().split(/[\s/>]/)[0].toLowerCase();

            if (SKIP_TAGS.has(name)) {
                if (isClosing) skipDepth = Math.max(0, skipDepth - 1);
                else skipDepth += 1;
                continue;
            }
            if (skipDepth) continue;

            if (BLOCK_TAGS.has(name)) push('', true);

            // A void element carries no content and has nothing to close, so it
            // must not touch the style stack whether or not it was written with
            // a slash.
            if (VOID_TAGS.has(name)) continue;

            if (isClosing) {
                if (stack.length) stack.pop();
                continue;
            }
            if (tag.endsWith('/')) continue;

            const key = styleKeyOf(tag.slice(name.length));
            stack.push(key || (stack.length ? stack[stack.length - 1] : ''));
        }

        return runs;
    }

    const TIMESTAMP = /^\s*(\d{1,3}):([0-5]\d)\s*$/;
    const AGENT_GREETING = /thank(?:s| you)?(?: you)? (?:so much )?for (?:being|calling|choosing)|my name is|this is \w+ speaking|how m(?:ay|ight) i help|how can i help/i;

    /**
     * Groups the runs into lines and works out which style is the advisor.
     *
     * The advisor is the one who opens the call. Every one of these
     * transcripts starts with a branded greeting, so the style wearing it is
     * the advisor and the other one is the customer. When the greeting cannot
     * be found in exactly one group, this gives up rather than guessing.
     */
    // Where the transcript sits inside a whole Interaction Review email. The
    // same markers call-transcript cuts the boilerplate on.
    const BODY_START = /No visual indicators/i;
    const BODY_END = /^(?:Did advisor |Additional Comments$|Notes on Soft Skills$|Kudos\/Compliments$|Call Opportunities$)|This message is for the designated recipient/i;

    /**
     * The runs as lines, and which of those lines are somebody speaking.
     *
     * Copying the whole email brings the header and the QA form with it, in
     * the email's own text colour. Counted in with the speech, that colour
     * was a third speaker and every such paste declined. So only the
     * transcript body is counted: after Verint's "No visual indicators" line,
     * before the form, and where the call is timestamped, only the line under
     * each timestamp. Everything else passes through as it was.
     */
    function readLines(runs) {
        const lines = [];
        let current = null;

        runs.forEach((run) => {
            if (run.newline) { current = null; return; }
            if (!current) {
                current = { text: '', keys: {} };
                lines.push(current);
            }
            current.text = `${current.text}${run.text}`;
            if (run.key) current.keys[run.key] = (current.keys[run.key] || 0) + run.text.trim().length;
        });

        const spoken = lines
            .map((line) => ({
                text: line.text.replace(/\s+/g, ' ').trim(),
                key: Object.keys(line.keys).sort((a, b) => line.keys[b] - line.keys[a])[0] || ''
            }))
            .filter((line) => line.text);

        let start = 0;
        spoken.forEach((line, i) => { if (BODY_START.test(line.text)) start = i + 1; });
        let end = spoken.length;
        for (let i = start; i < spoken.length; i++) {
            if (BODY_END.test(spoken[i].text)) { end = i; break; }
        }

        const timestamped = spoken.slice(start, end).some((line) => TIMESTAMP.test(line.text));
        spoken.forEach((line, i) => {
            line.inBody = i >= start && i < end;
            line.speech = line.inBody
                && !TIMESTAMP.test(line.text)
                && /[a-z]{2}/i.test(line.text)
                && (!timestamped || (i > 0 && TIMESTAMP.test(spoken[i - 1].text)));
        });

        // Two groups is what a two sided conversation looks like. One means the
        // colour never came through; three or more means this is not speaker
        // colouring and reading it as such would be inventing attribution.
        const weight = {};
        spoken.forEach((line) => {
            if (!line.speech || !line.key) return;
            weight[line.key] = (weight[line.key] || 0) + line.text.length;
        });

        return { spoken, weight };
    }

    function attribute(runs, options = {}) {
        const { spoken, weight } = readLines(runs);
        if (!spoken.length) return null;

        const keys = Object.keys(weight).sort((a, b) => weight[b] - weight[a]);
        if (keys.length !== 2) return null;

        const named = String(options.advisorName || '')
            .toLowerCase()
            .split(/[\s,]+/)
            .filter((part) => part.length > 2);

        // The greeting only counts near the front of a side's turns. Customers
        // say "my name is" too, and on the sample export one did, so matching it
        // anywhere gave both sides the same score and the paste declined. The
        // side that greets first wins a tie: the advisor opens the call. Opening
        // without a greeting proves nothing, because a paste can start anywhere.
        const speech = spoken.filter((line) => line.speech && keys.includes(line.key));
        const opener = speech.length ? speech[0].key : '';

        const scoreFor = (key) => {
            const turns = speech.filter((line) => line.key === key).map((line) => line.text);
            let score = 0;
            if (AGENT_GREETING.test(turns.slice(0, 2).join(' '))) score += key === opener ? 13 : 10;
            const said = ` ${turns.join(' ').toLowerCase()} `;
            if (named.some((part) => said.includes(` ${part} `))) score += 4;
            return score;
        };

        const first = scoreFor(keys[0]);
        const second = scoreFor(keys[1]);

        // A tie means neither group can be shown to be the advisor. Labelling
        // on a coin flip is the one outcome worse than not labelling.
        if (first === second) return null;

        const agentKey = first > second ? keys[0] : keys[1];

        return { spoken, agentKey, speakerKeys: keys };
    }

    /**
     * Turns a colour coded Verint paste into a labelled transcript.
     *
     * Returns null whenever it cannot be certain, and the caller keeps the
     * plain text it already had.
     */
    function toLabelledTranscript(html, options = {}) {
        try {
            const runs = extractRuns(html);
            if (!runs.length) return null;

            const attributed = attribute(runs, options);
            if (!attributed) return null;

            const { spoken, agentKey, speakerKeys } = attributed;
            const out = [];
            let labelled = 0;

            spoken.forEach((line) => {
                if (TIMESTAMP.test(line.text)) {
                    out.push(line.text.trim());
                    return;
                }
                // The email header and the QA form keep their own text as it
                // was. "Customer: Date/Time:" is how they came out before, and
                // then nothing downstream could read the call date.
                if (!line.inBody || !speakerKeys.includes(line.key)) {
                    out.push(line.text);
                    return;
                }
                out.push(`${line.key === agentKey ? 'Agent' : 'Customer'}: ${line.text}`);
                labelled += 1;
            });

            // Not worth rewriting the box for a handful of labels.
            if (labelled < 3) return null;

            return { text: out.join('\n'), labelled, speakers: 2 };
        } catch (error) {
            console.error('[verint paste] Could not read the colours from the paste:', error);
            return null;
        }
    }

    /**
     * Why a paste did or did not get labelled, in words.
     *
     * Every decline above is a bare null, which is right for the paste handler
     * and useless to somebody holding a transcript that will not label. This
     * walks the same path and reports where it stopped. It decides nothing:
     * change a rule here and the two would disagree, so it re-runs the real
     * one and describes the result.
     */
    function describePaste(html, options = {}) {
        const source = String(html || '');
        const out = {
            hasHtml: source.length > 0,
            bytes: source.length,
            runs: 0,
            lines: 0,
            groups: [],
            greeting: false,
            labelled: 0,
            ok: false,
            reason: ''
        };

        if (!source) {
            out.reason = 'The clipboard carried no formatting at all, only plain text. '
                + 'That happens when the copy went through a plain text box on the way here, '
                + 'or when the page was copied as text rather than selected on screen.';
            return out;
        }

        let runs = [];
        try { runs = extractRuns(source); } catch (error) { runs = []; }
        out.runs = runs.length;

        // The same grouping attribute() does, so the two cannot disagree.
        const { spoken, weight } = readLines(runs);
        out.lines = spoken.length;
        out.groups = Object.keys(weight)
            .sort((a, b) => weight[b] - weight[a])
            .map((key) => ({ key, characters: weight[key] }));

        out.greeting = spoken.some((line) => line.speech && AGENT_GREETING.test(line.text));

        const converted = toLabelledTranscript(source, options);
        if (converted) {
            out.ok = true;
            out.labelled = converted.labelled;
            out.reason = `${converted.labelled} lines were labelled from ${out.groups.length} groups.`;
            return out;
        }

        if (!out.runs) {
            out.reason = 'Nothing readable came out of the markup. It may not be a transcript, '
                + 'or the copy caught the page furniture instead of the lines.';
        } else if (!out.lines) {
            out.reason = 'The markup came through but held no text lines.';
        } else if (out.groups.length === 0) {
            out.reason = 'No line carried any style of its own, so there is nothing to tell the '
                + 'two sides apart by. In this transcript the speakers are probably marked some '
                + 'other way, by an icon or a column rather than by the text itself.';
        } else if (out.groups.length === 1) {
            out.reason = 'Every line is styled the same way, so the markup holds no difference '
                + 'between the speakers. Whatever separates them on screen is not in the text.';
        } else if (out.groups.length > 2) {
            out.reason = `The lines fall into ${out.groups.length} styles rather than 2. That is not `
                + 'speaker colouring, it is something else being marked, such as the phrases the '
                + 'system highlights. Reading it as speakers would invent who said what.';
        } else if (!out.greeting) {
            out.reason = 'There are two styles, but neither one opens with a greeting this '
                + 'recognises, so which is the advisor cannot be settled. Picking one would be a '
                + 'coin flip.';
        } else {
            out.reason = 'There are two styles and a greeting, but not enough lines came out '
                + 'labelled to be worth rewriting the box.';
        }
        return out;
    }

    /**
     * The same markup with every word taken out of it.
     *
     * What decides the speakers is structure: tags, styles, classes, which run
     * sits where. None of that needs the words, and the words are a customer
     * saying her name and the last four of her social. Letters become x and
     * digits become 0, inside text only, so tags and attributes survive whole
     * and a timestamp still reads as a timestamp shape.
     */
    function redactMarkup(html, limit) {
        const source = String(html || '');
        const cap = Number.isFinite(limit) && limit > 0 ? limit : 20000;
        let out = '';
        let index = 0;

        const scrub = (text) => text.replace(/[A-Za-z]/g, 'x').replace(/[0-9]/g, '0');

        while (index < source.length) {
            const open = source.indexOf('<', index);
            if (open === -1) { out += scrub(source.slice(index)); break; }
            if (open > index) out += scrub(source.slice(index, open));
            const close = source.indexOf('>', open);
            if (close === -1) { out += source.slice(open); break; }
            out += source.slice(open, close + 1);
            index = close + 1;
        }

        return out.length > cap ? `${out.slice(0, cap)}
<!-- trimmed, ${out.length} characters in total -->` : out;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.verintPaste = {
        toLabelledTranscript,
        describePaste,
        redactMarkup,
        extractRuns,
        normalizeColour,
        styleKeyOf
    };
})();
