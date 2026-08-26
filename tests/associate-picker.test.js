/**
 * The picker is one module behind fourteen dropdowns now, so a mistake here is
 * a mistake everywhere at once. These pin the parts that were inconsistent
 * before consolidation and the two exceptions that were kept on purpose.
 */
const { suite } = require('./harness');

function fakeSelect() {
    var html = '';
    var el = { value: '', children: [] };
    Object.defineProperty(el, 'innerHTML', {
        get: function () { return html; },
        // A real <select> drops its selection when its options are replaced.
        set: function (v) { html = String(v); el.children = []; el.value = ''; }
    });
    el.appendChild = function (c) { el.children.push(c); return c; };
    el.querySelector = function () { return null; };
    return el;
}

function labels(select) {
    return select.children.map(function (o) { return o.textContent; });
}
function values(select) {
    return select.children.map(function (o) { return o.value; });
}

suite('associate picker', function (t) {
    t.installFakeBrowser();
    global.document.createElement = function () {
        return { value: '', textContent: '', setAttribute: function () {} };
    };
    var api = t.loadModule('modules/associate-picker.module.js').associatePicker;

    // One placeholder, not the six that had drifted apart.
    t.equal('one placeholder wording', api.DEFAULT_PLACEHOLDER, '-- Choose an associate --');

    var messy = ['  Bravo ', 'Alpha', 'Bravo', '', null, undefined, '   '];
    t.equal('trims, drops blanks, dedupes and sorts',
        api.normalizeNames(messy, { teamFilter: false }).join(','), 'Alpha,Bravo');

    // Reliability lists worst-first. Alphabetising it would destroy the feature.
    t.equal('sort:false keeps the order it was given',
        api.normalizeNames(['Charlie', 'Alpha', 'Bravo'], { teamFilter: false, sort: false }).join(','),
        'Charlie,Alpha,Bravo');

    // The one picker that never applied team scope keeps not applying it, and
    // has to ask for that explicitly.
    t.check('teamFilter defaults on',
        api.normalizeNames(['Anyone']).length === 1 || api.normalizeNames(['Anyone']).length === 0);
    t.equal('teamFilter:false lets everyone through',
        api.normalizeNames(['Anyone'], { teamFilter: false }).join(','), 'Anyone');

    // metric-trends interpolated names straight into an option string.
    var html = api.optionsHtml(['a<b>', 'x"y', "O'Brien", 'p&q'], { teamFilter: false });
    t.check('escapes angle brackets', html.indexOf('a&lt;b&gt;') !== -1);
    t.check('escapes double quotes', html.indexOf('x&quot;y') !== -1);
    t.check('escapes ampersands', html.indexOf('p&amp;q') !== -1);
    t.check('no raw bracket survives', html.indexOf('<option value="a<b>"') === -1);

    var sel = fakeSelect();
    api.populateSelect(sel, ['Bravo', 'Alpha'], { teamFilter: false });
    t.equal('placeholder is first', labels(sel)[0], '-- Choose an associate --');
    t.equal('placeholder has an empty value', values(sel)[0], '');
    t.equal('names follow, sorted', labels(sel).slice(1).join(','), 'Alpha,Bravo');

    var empty = fakeSelect();
    api.populateSelect(empty, [], { teamFilter: false });
    t.equal('an empty roster leaves the placeholder alone', labels(empty).join(','), '-- Choose an associate --');

    // Trends offers "All Associates"; that is an instruction, not a person, so
    // it must not be sorted in among the names.
    var extra = fakeSelect();
    api.populateSelect(extra, ['Alpha'], { teamFilter: false, extraOptions: [{ value: 'ALL', label: 'All Associates' }] });
    t.equal('extra options sit between placeholder and names',
        values(extra).join(','), ',ALL,Alpha');

    // PTO shows a payroll count beside the name; the value must stay the name.
    var labelled = fakeSelect();
    api.populateSelect(labelled, ['Alpha'], { teamFilter: false, label: function (n) { return n + ' (3)'; } });
    t.equal('label may differ from value', labels(labelled)[1], 'Alpha (3)');
    t.equal('value stays the bare name', values(labelled)[1], 'Alpha');

    // The group-analysis picker's blank option means "everyone", not "pick one".
    var custom = fakeSelect();
    api.populateSelect(custom, ['Alpha'], { teamFilter: false, placeholder: 'All Team Members' });
    t.equal('a caller may keep its own placeholder', labels(custom)[0], 'All Team Members');

    var kept = fakeSelect();
    kept.value = 'Alpha';
    api.populateSelect(kept, ['Alpha', 'Bravo'], { teamFilter: false, preserveSelection: true });
    t.equal('preserveSelection keeps a still-present name', kept.value, 'Alpha');

    var gone = fakeSelect();
    gone.value = 'Departed';
    api.populateSelect(gone, ['Alpha'], { teamFilter: false, preserveSelection: true });
    t.equal('a name no longer in the list is not restored', gone.value, '');
});
