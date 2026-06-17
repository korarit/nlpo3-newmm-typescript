import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NewmmTokenizer } from '../src/newmm.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] === ',') { i++; continue; }
        if (line[i] === '"') {
            i++;
            let field = '';
            while (i < line.length) {
                if (line[i] === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        field += '"';
                        i += 2;
                    } else {
                        i++;
                        break;
                    }
                } else {
                    field += line[i];
                    i++;
                }
            }
            fields.push(field);
        } else {
            let field = '';
            while (i < line.length && line[i] !== ',') {
                field += line[i];
                i++;
            }
            fields.push(field);
        }
    }
    return fields;
}

function parsePythonList(raw: string): string[] {
    const s = raw.trim();
    if (!s.startsWith('[') || !s.endsWith(']')) {
        throw new Error('Invalid Python list format');
    }
    const inner = s.slice(1, -1);
    const items: string[] = [];
    let i = 0;
    while (i < inner.length) {
        while (i < inner.length && (inner[i] === ' ' || inner[i] === ',' || inner[i] === '\t' || inner[i] === '\n' || inner[i] === '\r')) i++;
        if (i >= inner.length) break;
        if (inner[i] === '"' || inner[i] === "'") {
            const quote = inner[i];
            i++;
            let str = '';
            while (i < inner.length && inner[i] !== quote) {
                if (inner[i] === '\\') {
                    i++;
                    if (i < inner.length) {
                        if (inner[i] === 'n') str += '\n';
                        else if (inner[i] === 't') str += '\t';
                        else str += inner[i];
                        i++;
                    }
                } else {
                    str += inner[i];
                    i++;
                }
            }
            if (i < inner.length) i++;
            items.push(str);
        } else {
            while (i < inner.length && inner[i] !== ',' && inner[i] !== ']') i++;
        }
    }
    return items;
}

function charLength(s: string): number {
    return Array.from(s).length;
}

function forceGC(): void {
    if (typeof gc === 'function') {
        gc();
        gc();
    }
}

function formatMemory(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function measureMemoryDelta(
    label: string,
    fn: () => void,
): { heapDelta: number; externalDelta: number } {
    forceGC();
    const before = process.memoryUsage();
    fn();
    forceGC();
    const after = process.memoryUsage();

    const heapDelta = after.heapUsed - before.heapUsed;
    const externalDelta = after.external - before.external;

    const sign = (n: number) => n >= 0 ? '+' : '';
    console.log(`  ${label.padEnd(28)} heap: ${sign(heapDelta)}${formatMemory(heapDelta)}  external: ${sign(externalDelta)}${formatMemory(externalDelta)}  rss: ${formatMemory(after.rss)}`);
    return { heapDelta, externalDelta };
}

function computeBoundaryScore(predicted: string[], groundTruth: string[]): { precision: number; recall: number; f1: number } {
    const predText = predicted.join('');
    const truthText = groundTruth.join('');
    if (predText !== truthText) {
        return { precision: 0, recall: 0, f1: 0 };
    }

    const totalChars = charLength(predText);
    let truePos = 0, falsePos = 0, falseNeg = 0;

    const predBoundaries = new Set<number>();
    let pos = 0;
    for (const token of predicted) {
        pos += charLength(token);
        if (pos < totalChars) predBoundaries.add(pos);
    }

    const truthBoundaries = new Set<number>();
    pos = 0;
    for (const token of groundTruth) {
        pos += charLength(token);
        if (pos < totalChars) truthBoundaries.add(pos);
    }

    for (let i = 1; i < totalChars; i++) {
        const isPred = predBoundaries.has(i);
        const isTruth = truthBoundaries.has(i);
        if (isPred && isTruth) truePos++;
        else if (isPred && !isTruth) falsePos++;
        else if (!isPred && isTruth) falseNeg++;
    }

    const precision = truePos / (truePos + falsePos) || 0;
    const recall = truePos / (truePos + falseNeg) || 0;
    const f1 = (2 * precision * recall) / (precision + recall) || 0;
    return { precision, recall, f1 };
}

function runBenchmark(
    label: string,
    sentences: string[],
    groundTruths: string[][],
    tok: NewmmTokenizer,
): void {
    let exactMatchCount = 0;
    let totalBoundaryF1 = 0;
    let boundaryExactCount = 0;

    forceGC();
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    for (let i = 0; i < sentences.length; i++) {
        const result = tok.segment(sentences[i]);
        const truth = groundTruths[i];

        if (result.join('') === truth.join('')) {
            exactMatchCount++;
            const score = computeBoundaryScore(result, truth);
            totalBoundaryF1 += score.f1;
            if (score.f1 === 1) boundaryExactCount++;
        }
    }

    const elapsed = performance.now() - start;
    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;
    const n = sentences.length;
    const boundaryF1Avg = (totalBoundaryF1 / n) * 100;

    console.log(`\n--- ${label} (${n} sentences) ---`);
    console.log(`Total time:    ${(elapsed / 1000).toFixed(1)} s`);
    console.log(`Avg time:      ${(elapsed / n).toFixed(1)} ms/sent`);
    console.log(`Throughput:    ${((n / elapsed) * 1000).toFixed(0)} sent/s`);
    console.log(`Text match:    ${exactMatchCount}/${n} (${((exactMatchCount / n) * 100).toFixed(1)}%)`);
    console.log(`Boundary F1:   ${boundaryF1Avg.toFixed(1)}%`);
    console.log(`Heap delta:    ${formatMemory(memDelta)}`);
    console.log(`---------------------------------`);

    assert.ok(exactMatchCount > 0, 'At least one sentence should have identical text after join');
}

// ---------------------------------------------------------------------------
// LST20 dataset (Python-list format: index,"sentence","['token1','token2']")
// ---------------------------------------------------------------------------

function loadLST20(csvPath: string): { sentences: string[]; groundTruths: string[][] } {
    const content = readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');

    const sentences: string[] = [];
    const groundTruths: string[][] = [];

    for (let row = 1; row < lines.length; row++) {
        const line = lines[row].trim();
        if (!line) continue;
        const fields = parseCsvLine(line);
        if (fields.length < 3) continue;

        sentences.push(fields[1]);
        groundTruths.push(parsePythonList(fields[2]));
    }

    return { sentences, groundTruths };
}

// ---------------------------------------------------------------------------
// thai_wordseg_menu dataset (`|`-delimited format)
// ---------------------------------------------------------------------------

function loadMenuDataset(csvPath: string): {
    sentences: string[];
    groundTruths: string[][];
    levels: string[];
} {
    const content = readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');

    const sentences: string[] = [];
    const groundTruths: string[][] = [];
    const levels: string[] = [];

    for (let row = 1; row < lines.length; row++) {
        const fields = parseCsvLine(lines[row]);
        if (fields.length < 4) continue;

        const text = fields[2];
        const goldSeg = fields[3]; // `|`-delimited tokens

        if (!text || !goldSeg) continue;

        sentences.push(text);
        groundTruths.push(goldSeg.split('|'));
        levels.push(fields[1]);
    }

    return { sentences, groundTruths, levels };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LST20 Benchmark', () => {
    const CSV_PATH = fileURLToPath(new URL('dataset/lst20.csv', import.meta.url));

    it('benchmark on 300 LST20 sentences', () => {
        const { sentences, groundTruths } = loadLST20(CSV_PATH);
        const tok = new NewmmTokenizer();
        runBenchmark('LST20', sentences, groundTruths, tok);
    });
});

describe('thai_wordseg_menu Benchmark', () => {
    const CSV_PATH = fileURLToPath(new URL('dataset/thai_wordseg_menu.csv', import.meta.url));

    it('benchmark overall', () => {
        const { sentences, groundTruths } = loadMenuDataset(CSV_PATH);
        const tok = new NewmmTokenizer();
        runBenchmark('thai_wordseg_menu (overall)', sentences, groundTruths, tok);
    });

    it('benchmark by level', () => {
        const { sentences, groundTruths, levels } = loadMenuDataset(CSV_PATH);
        const tok = new NewmmTokenizer();

        const grouped: Record<string, { sent: string[]; truth: string[][] }> = {};
        for (let i = 0; i < sentences.length; i++) {
            const lv = levels[i];
            if (!grouped[lv]) grouped[lv] = { sent: [], truth: [] };
            grouped[lv].sent.push(sentences[i]);
            grouped[lv].truth.push(groundTruths[i]);
        }

        for (const [level, data] of Object.entries(grouped)) {
            let exactMatch = 0;
            let totalF1 = 0;
            const n = data.sent.length;

            for (let i = 0; i < n; i++) {
                const result = tok.segment(data.sent[i]);
                const truth = data.truth[i];
                if (result.join('') === truth.join('')) {
                    exactMatch++;
                    totalF1 += computeBoundaryScore(result, truth).f1;
                }
            }

            const f1Pct = ((totalF1 / n) * 100).toFixed(1);
            console.log(`  ${level.padEnd(12)} ${String(n).padStart(3)} sent  |  text match: ${String(exactMatch).padStart(2)}/${n}  |  Boundary F1: ${f1Pct}%`);
        }

        assert.ok(true);
    });
});

describe('Memory Usage', () => {
    it('tokenizer construction and dictionary load', () => {
        console.log('');
        measureMemoryDelta('new NewmmTokenizer()', () => {
            const tok = new NewmmTokenizer();
            assert.ok(tok);
        });
        assert.ok(true);
    });

    it('warm-up and sustained segment memory', () => {
        const CSV_PATH = fileURLToPath(new URL('dataset/lst20.csv', import.meta.url));
        const { sentences } = loadLST20(CSV_PATH);
        const tok = new NewmmTokenizer();

        forceGC();
        const startHeap = process.memoryUsage();

        for (let i = 0; i < 100; i++) {
            tok.segment(sentences[i % sentences.length]);
            if (i % 20 === 19) forceGC();
        }

        const endHeap = process.memoryUsage();

        console.log('');
        console.log('--- Sustained segment (100 calls) ---');
        console.log(`  heapUsed start:  ${formatMemory(startHeap.heapUsed)}`);
        console.log(`  heapUsed end:    ${formatMemory(endHeap.heapUsed)}`);
        console.log(`  heapUsed delta:  ${formatMemory(endHeap.heapUsed - startHeap.heapUsed)}`);
        console.log(`  heapTotal end:   ${formatMemory(endHeap.heapTotal)}`);
        console.log(`  external end:    ${formatMemory(endHeap.external)}`);
        console.log(`  rss end:         ${formatMemory(endHeap.rss)}`);
        console.log('-------------------------------------');

        assert.ok(true);
    });

    it('large dataset segment memory', () => {
        const CSV_PATH = fileURLToPath(new URL('dataset/lst20.csv', import.meta.url));
        const { sentences } = loadLST20(CSV_PATH);
        const tok = new NewmmTokenizer();

        forceGC();
        const before = process.memoryUsage().heapUsed;

        for (const sent of sentences) {
            tok.segment(sent);
        }

        forceGC();
        const after = process.memoryUsage().heapUsed;
        const delta = after - before;

        console.log('');
        console.log(`--- Segment all ${sentences.length} LST20 sentences ---`);
        console.log(`  heapUsed before:  ${formatMemory(before)}`);
        console.log(`  heapUsed after:   ${formatMemory(after)}`);
        console.log(`  heapUsed delta:   ${formatMemory(delta)}`);
        console.log(`  avg per segment:  ${formatMemory(delta / sentences.length)}`);
        console.log('-------------------------------------------------');

        assert.ok(delta < 50 * 1024 * 1024, `Heap delta ${formatMemory(delta)} exceeds 50 MB threshold`);
    });

    it('idle memory after tokenizer is created', () => {
        forceGC();
        const idleBefore = process.memoryUsage();
        const tok = new NewmmTokenizer();
        forceGC();
        const idleAfter = process.memoryUsage();

        console.log('');
        console.log('--- Idle memory snapshot ---');
        console.log(`  Before tokenizer:  heapUsed=${formatMemory(idleBefore.heapUsed)}  rss=${formatMemory(idleBefore.rss)}`);
        console.log(`  After tokenizer:   heapUsed=${formatMemory(idleAfter.heapUsed)}  rss=${formatMemory(idleAfter.rss)}`);
        console.log(`  Overhead:          heapUsed=${formatMemory(idleAfter.heapUsed - idleBefore.heapUsed)}`);

        assert.ok(idleAfter.heapUsed < 200 * 1024 * 1024, 'Tokenizer memory should be under 200 MB');
    });
});
