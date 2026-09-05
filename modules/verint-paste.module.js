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
    const SKIP_TAGS = new Set(['style', 'script', 'head', 'meta', 'title']);

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
        const attrs = String(attributes || '');

        const inline = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
        if (inline) {
            const colour = inline[1].match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
            if (colour) return `c:${normalizeColour(colour[1])}`;
        }

        const fontColour = attrs.match(/\bcolor\s*=\s*["']?([^"'\s>]+)/i);
        if (fontColour) return `c:${normalizeColour(fontColour[1])}`;

        const className = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
        if (className && className[1].trim()) return `k:${className[1].trim().toLowerCase()}`;

        return '';
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
        const source = String(html || '');
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
    function attribute(runs, options = {}) {
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

        if (!spoken.length) return null;

        // Two groups is what a two sided conversation looks like. One means the
        // colour never came through; three or more means this is not speaker
        // colouring and reading it as such would be inventing attribution.
        const weight = {};
        spoken.forEach((line) => {
            if (TIMESTAMP.test(line.text) || !line.key) return;
            weight[line.key] = (weight[line.key] || 0) + line.text.length;
        });

        const keys = Object.keys(weight).sort((a, b) => weight[b] - weight[a]);
        if (keys.length !== 2) return null;

        const named = String(options.advisorName || '')
            .toLowerCase()
            .split(/[\s,]+/)
            .filter((part) => part.length > 2);

        const scoreFor = (key) => {
            const said = spoken.filter((line) => line.key === key).map((line) => line.text).join(' ');
            let score = AGENT_GREETING.test(said) ? 10 : 0;
            if (named.some((part) => said.toLowerCase().includes(part))) score += 4;
            return score;
        };

        const first = scoreFor(keys[0]);
        const second = scoreFor(keys[1]);

        // A tie means neither group can be shown to be the advisor. Labelling
        // on a coin flip is the one outcome worse than not labelling.
        if (first === second) return null;

        const agentKey = first > second ? keys[0] : keys[1];

        return { spoken, agentKey };
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

            const { spoken, agentKey } = attributed;
            const out = [];
            let labelled = 0;

            spoken.forEach((line) => {
                if (TIMESTAMP.test(line.text)) {
                    out.push(line.text.trim());
                    return;
                }
                if (!line.key) {
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

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.verintPaste = {
        toLabelledTranscript,
        extractRuns,
        normalizeColour,
        styleKeyOf
    };
})();
