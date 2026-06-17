import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let _defaultWords: string[] | null = null;

function loadWordsTh(): string[] {
    if (_defaultWords) return _defaultWords;

    // ESM build (es2020 target): import.meta.url stays as-is
    // CJS build (es2016 target): import_meta = {url: ...} is injected by fix-cjs.mjs
    const dictPath = resolve(dirname(fileURLToPath(import.meta.url)), 'words_th.txt');

    const content = readFileSync(dictPath, 'utf-8');
    const words: string[] = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
            words.push(trimmed);
        }
    }
    _defaultWords = words;
    return _defaultWords;
}

export function getDefaultWords(): string[] {
    return loadWordsTh();
}
