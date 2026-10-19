"use strict";
/**
 * Pure helpers with no `vscode` imports — unit-testable via `out/pure.js`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.contrastColor = contrastColor;
exports.sanitizeHex = sanitizeHex;
exports.escapeCssContent = escapeCssContent;
exports.firstGraphemes = firstGraphemes;
exports.globToRegExp = globToRegExp;
exports.globMatch = globMatch;
exports.matchSessionMarks = matchSessionMarks;
/** Pick black or white text for a given hex background. */
function contrastColor(hex) {
    const m3 = /^#?([0-9a-f]{3})$/i.exec(hex.trim());
    const full = m3
        ? m3[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
    if (!full)
        return '#ffffff';
    const n = parseInt(full, 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.5 ? '#000000' : '#ffffff';
}
/** Normalize `#rgb`/`#rrggbb` (optional leading `#`) to `#rrggbb`; undefined on garbage. */
function sanitizeHex(hex) {
    if (!hex)
        return undefined;
    const m3 = /^#?([0-9a-f]{3})$/i.exec(hex.trim());
    if (m3) {
        const [r, g, b] = m3[1].split('');
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    const m6 = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    return m6 ? `#${m6[1].toLowerCase()}` : undefined;
}
/** Escape characters for a CSS double-quoted string without leaving any literal `.`. */
function escapeCssContent(raw) {
    return raw
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n|\r/g, '')
        .replace(/\./g, '\\2e ');
}
/** Return at most `max` grapheme clusters so VS Code's FileDecoration.badge validator never throws. */
function firstGraphemes(text, max) {
    const Seg = Intl.Segmenter;
    if (Seg) {
        const out = [];
        for (const { segment } of new Seg().segment(text)) {
            out.push(segment);
            if (out.length >= max)
                break;
        }
        return out.join('');
    }
    return Array.from(text).slice(0, max).join('');
}
/**
 * Convert a glob to a RegExp. Supports star, double-star-slash (any directory
 * depth), question mark, brace-group alternation, and character classes.
 * Everything else is literal. Matching is case-insensitive, slash-normalized.
 */
function globToRegExp(glob) {
    let re = '';
    let i = 0;
    const n = glob.length;
    while (i < n) {
        const c = glob[i++];
        if (c === '*') {
            if (glob[i] === '*') {
                if (glob[i + 1] === '/') {
                    re += '(?:[^/]*/)*'; // '**/' — zero or more path segments
                    i += 2;
                }
                else {
                    re += '.*'; // bare '**'
                    i += 1;
                }
            }
            else {
                re += '[^/]*';
            }
        }
        else if (c === '?') {
            re += '[^/]';
        }
        else if (c === '{') {
            const end = glob.indexOf('}', i);
            if (end === -1) {
                re += '\\{';
            }
            else {
                const alts = glob
                    .slice(i, end)
                    .split(',')
                    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                re += '(?:' + alts.join('|') + ')';
                i = end + 1;
            }
        }
        else if (c === '[') {
            const end = glob.indexOf(']', i);
            if (end === -1) {
                re += '\\[';
            }
            else {
                re += glob.slice(i - 1, end + 1); // pass the character class through
                i = end + 1;
            }
        }
        else {
            re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp('^' + re + '$', 'i');
}
function globMatch(pattern, path) {
    if (!pattern)
        return false;
    return globToRegExp(pattern).test(path.replace(/\\/g, '/'));
}
/**
 * Pair persisted session marks with recreated tabs. A slot is the preferred
 * identity; legacy marks fall back to labels, then to tab order only when the
 * remaining marks and tabs form a complete one-to-one bucket.
 */
function matchSessionMarks(marks, tabs, allowCompleteOrderFallback = true) {
    const usedMarks = new Set();
    const usedTabs = new Set();
    const matches = [];
    const pair = (markIndex, tabIndex) => {
        usedMarks.add(markIndex);
        usedTabs.add(tabIndex);
        matches.push({
            key: marks[markIndex].key,
            uri: tabs[tabIndex].uri,
            tabSlot: tabs[tabIndex].tabSlot,
        });
    };
    const markSlots = new Map();
    const tabSlots = new Map();
    marks.forEach((mark, i) => {
        if (!mark.tabSlot)
            return;
        const indexes = markSlots.get(mark.tabSlot) ?? [];
        indexes.push(i);
        markSlots.set(mark.tabSlot, indexes);
    });
    tabs.forEach((tab, i) => {
        if (!tab.tabSlot)
            return;
        const indexes = tabSlots.get(tab.tabSlot) ?? [];
        indexes.push(i);
        tabSlots.set(tab.tabSlot, indexes);
    });
    for (const [slot, markIndexes] of markSlots) {
        const tabIndexes = tabSlots.get(slot);
        if (markIndexes.length === 1 && tabIndexes?.length === 1) {
            pair(markIndexes[0], tabIndexes[0]);
        }
    }
    const labels = new Set(tabs.map((tab, i) => (usedTabs.has(i) ? undefined : tab.label)).filter((v) => !!v));
    for (const label of labels) {
        const markIndexes = marks
            .map((mark, i) => (!usedMarks.has(i) && mark.label === label ? i : -1))
            .filter((i) => i >= 0);
        const tabIndexes = tabs
            .map((tab, i) => (!usedTabs.has(i) && tab.label === label ? i : -1))
            .filter((i) => i >= 0);
        if (markIndexes.length !== tabIndexes.length)
            continue;
        for (let i = 0; i < markIndexes.length; i++)
            pair(markIndexes[i], tabIndexes[i]);
    }
    const remainingMarks = marks.map((_, i) => i).filter((i) => !usedMarks.has(i));
    const remainingTabs = tabs.map((_, i) => i).filter((i) => !usedTabs.has(i));
    const remainingMarkLabels = new Set(remainingMarks.map((i) => marks[i].label).filter((v) => !!v));
    const remainingTabLabels = new Set(remainingTabs.map((i) => tabs[i].label));
    const labelsOverlap = [...remainingMarkLabels].some((label) => remainingTabLabels.has(label));
    const sharedLabel = remainingMarkLabels.values().next().value;
    const allMarksShareLabel = remainingMarkLabels.size === 1 && remainingMarks.every((i) => marks[i].label === sharedLabel);
    if (allowCompleteOrderFallback &&
        remainingMarks.length > 0 &&
        remainingMarks.length === remainingTabs.length &&
        (!labelsOverlap || allMarksShareLabel)) {
        for (let i = 0; i < remainingMarks.length; i++) {
            pair(remainingMarks[i], remainingTabs[i]);
        }
    }
    return matches;
}
//# sourceMappingURL=pure.js.map