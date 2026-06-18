import { NON_LOOKAHEAD_TCC, LOOKAHEAD_TCC } from './tcc_rules.js';

const TCC_RE = new RegExp(NON_LOOKAHEAD_TCC.source, 'g');

export function tccPos(text: string): number[] {
    const positions: number[] = [];
    const len = text.length;
    let pos = 0;

    while (pos < len) {
        TCC_RE.lastIndex = pos;
        const m = TCC_RE.exec(text);
        if (m && m.index === pos) {
            const matched = m[0];
            const matchCharCount = matched.length;

            if (LOOKAHEAD_TCC.test(matched)) {
                const segmentCharCount = matchCharCount - 1;
                pos += segmentCharCount;
                positions.push(pos);
            } else {
                pos += matchCharCount;
                positions.push(pos);
            }
        } else {
            pos += 1;
            positions.push(pos);
        }
    }

    return positions;
}
