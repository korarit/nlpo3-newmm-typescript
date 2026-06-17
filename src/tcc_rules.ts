function replaceTccSymbol(pattern: string): string {
    return pattern
        .split('k').join('(?:cc?[dิ]?[์])?')
        .split('c').join('[ก-ฮ]')
        .split('t').join('[่-๋]?')
        .split('d').join('ุู');
}

const RAW_PATTERNS = [
    '^เc็ck',         // 1
    '^เcctาะk',       // 2
    '^เccีtยะk',      // 3
    '^เcc็ck',        // 4
    '^เcิc์ck',       // 5
    '^เcิtck',        // 6
    '^เcีtยะ?k',      // 7
    '^เcืtอะ?k',      // 8
    '^เctา?ะ?k',      // 9
    '^cัtวะk',        // 10
    '^c[ัื]tc[ุิะ]?k', // 11
    '^c[ิุู]์k',       // 12
    '^c[ะ-ู]tk',      // 13
    '^cรรc์ ็',       // 14
    '^c็',            // 15
    '^ct[ะาำ]?k',     // 16
    '^ck',            // 17
    '^แc็c',          // 18
    '^แcc์',          // 19
    '^แctะ',          // 20
    '^แcc็c',         // 21
    '^แccc์',         // 22
    '^โctะ',          // 23
    '^[เ-ไ]ct',       // 24
    '^ก็',
    '^อึ',
    '^หึ',
];

const LOOKAHEAD_RAW = [
    '^(เccีtย)[เ-ไก-ฮ]k',
    '^(เc[ิีุู]tย)[เ-ไก-ฮ]k',
];

export const NON_LOOKAHEAD_TCC = new RegExp(
    RAW_PATTERNS.map(replaceTccSymbol).join('|')
);

export const LOOKAHEAD_TCC = new RegExp(
    LOOKAHEAD_RAW.map(replaceTccSymbol).join('|')
);
