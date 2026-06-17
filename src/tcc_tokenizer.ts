import { NON_LOOKAHEAD_TCC, LOOKAHEAD_TCC } from './tcc_rules.js';

export function tccPos(text: string): number[] {
    const positions: number[] = [];
    let txt = text;
    let position = 0;

    while (txt.length > 0) {
        const m = NON_LOOKAHEAD_TCC.exec(txt);
        if (m && m.index === 0) {
            const matched = m[0];
            const matchCharCount = matched.length;

            if (LOOKAHEAD_TCC.test(matched)) {
                const segmentCharCount = matchCharCount - 1;
                position += segmentCharCount;
                positions.push(position);
                txt = txt.slice(segmentCharCount);
            } else {
                position += matchCharCount;
                positions.push(position);
                txt = txt.slice(matched.length);
            }
        } else {
            const ch = txt[0];
            txt = txt.slice(ch.length);
            position += 1;
            positions.push(position);
        }
    }

    return positions;
}
