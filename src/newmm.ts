import { TrieChar } from './trie_char.js';
import { tccPos } from './tcc_tokenizer.js';
import { getDefaultWords } from './default_dict.js';

const MAX_GRAPH_SIZE = 50;
const TEXT_SCAN_POINT = 120;
const TEXT_SCAN_LEFT = 20;
const TEXT_SCAN_RIGHT = 20;
const TEXT_SCAN_BEGIN = TEXT_SCAN_POINT - TEXT_SCAN_LEFT;
const TEXT_SCAN_END = TEXT_SCAN_POINT + TEXT_SCAN_RIGHT;

const NON_THAI_PATTERN = /^[-a-zA-Z]+|^[0-9]+(?:[,\.][0-9]+)*|^[๐-๙]+(?:[,\.][๐-๙]+)*|^[ \t]+|^\r?\n/;
const NON_THAI_RAW = NON_THAI_PATTERN.source.replace(/\^/g, '');
const NON_THAI_RE = new RegExp(NON_THAI_RAW, 'y');

const THAI_CONSONANT_LO = 0x0E01; // ก
const THAI_CONSONANT_HI = 0x0E2E; // ฮ

function isTwoCharThaiConsonants(text: string, pos: number, len: number): boolean {
    if (len > 2) return false;
    for (let i = 0; i < len; i++) {
        const c = text.charCodeAt(pos + i);
        if (c < THAI_CONSONANT_LO || c > THAI_CONSONANT_HI) return false;
    }
    return true;
}

function isValidPos(validPosition: number[], pos: number): boolean {
    let lo = 0, hi = validPosition.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (validPosition[mid] === pos) return true;
        if (validPosition[mid] < pos) lo = mid + 1;
        else hi = mid - 1;
    }
    return false;
}

class MinHeap {
    private heap: number[] = [];

    push(val: number): void {
        this.heap.push(val);
        this.bubbleUp(this.heap.length - 1);
    }

    pop(): number | undefined {
        if (this.heap.length === 0) return undefined;
        const top = this.heap[0];
        const bottom = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this.sinkDown(0);
        }
        return top;
    }

    peek(): number | undefined {
        return this.heap[0];
    }

    get length(): number {
        return this.heap.length;
    }

    private bubbleUp(idx: number): void {
        while (idx > 0) {
            const parent = (idx - 1) >> 1;
            if (this.heap[parent] <= this.heap[idx]) break;
            [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
            idx = parent;
        }
    }

    private sinkDown(idx: number): void {
        const n = this.heap.length;
        while (true) {
            let smallest = idx;
            const left = (idx << 1) + 1;
            const right = left + 1;
            if (left < n && this.heap[left] < this.heap[smallest]) smallest = left;
            if (right < n && this.heap[right] < this.heap[smallest]) smallest = right;
            if (smallest === idx) break;
            [this.heap[smallest], this.heap[idx]] = [this.heap[idx], this.heap[smallest]];
            idx = smallest;
        }
    }
}

export class NewmmTokenizer {
    private dict: TrieChar;

    /**
     * Create a tokenizer with the built-in ~62k word dictionary.
     *
     * @param customWords Optional extra words to add on top of the default dictionary.
     *                    When omitted, only the default dictionary is used.
     */
    constructor(customWords?: string[]) {
        this.dict = new TrieChar(getDefaultWords());
        if (customWords) {
            for (const w of customWords) {
                this.dict.addWord(w);
            }
        }
    }

    /**
     * Create a tokenizer using only the given word list (no default dictionary).
     * Mirrors `NewmmTokenizer::from_word_list` in the Rust version.
     */
    static fromWordList(words: string[]): NewmmTokenizer {
        const tok = Object.create(NewmmTokenizer.prototype) as NewmmTokenizer;
        tok.dict = new TrieChar(words);
        return tok;
    }

    addWord(...words: string[]): void {
        for (const w of words) {
            this.dict.addWord(w);
        }
    }

    removeWord(...words: string[]): void {
        for (const w of words) {
            this.dict.removeWord(w);
        }
    }

    segment(text: string, safe = false): string[] {
        return this.segmentWithOptions(text, safe, undefined);
    }

    segmentWithOptions(text: string, safe: boolean, _parallelChunkSize?: number): string[] {
        return this.internalSegment(text, safe, _parallelChunkSize);
    }

    private internalSegment(_input: string, safe: boolean, _parallelChunkSize?: number): string[] {
        if (_input.length === 0) return [];
        return this.segmentSingle(_input, safe);
    }

    private segmentSingle(input: string, safe: boolean): string[] {
        if (!safe || input.length < TEXT_SCAN_END) {
            return this.oneCut(input);
        }

        let remaining = input;
        const txtParts: string[] = [];
        while (remaining.length >= TEXT_SCAN_END) {
            const sample = remaining.slice(TEXT_SCAN_BEGIN, TEXT_SCAN_END);
            let cutPos: number;

            const spaceIdx = sample.lastIndexOf(' ');
            if (spaceIdx !== -1) {
                cutPos = TEXT_SCAN_BEGIN + spaceIdx + 1;
            } else {
                const wordTokens = this.oneCut(sample);
                let maxIdx = 0;
                let maxLen = 0;
                const tokenLens = new Array(wordTokens.length);
                for (let i = 0; i < wordTokens.length; i++) {
                    const tokLen = wordTokens[i].length;
                    tokenLens[i] = tokLen;
                    if (tokLen >= maxLen) {
                        maxLen = tokLen;
                        maxIdx = i;
                    }
                }
                cutPos = TEXT_SCAN_BEGIN;
                for (let i = 0; i < maxIdx; i++) {
                    cutPos += tokenLens[i];
                }
            }

            txtParts.push(remaining.slice(0, cutPos));
            remaining = remaining.slice(cutPos);
        }
        if (remaining.length > 0) {
            txtParts.push(remaining);
        }

        const out: string[] = [];
        for (const part of txtParts) {
            out.push(...this.oneCut(part));
        }
        return out;
    }

    private oneCut(input: string): string[] {
        const text = input;
        const textLength = text.length;
        const validPosition = tccPos(text);

        let graphSize = 0;
        const graph = new Map<number, number[]>();
        const result: string[] = [];

        const positionList = new MinHeap();
        const existingCandidate = new Set<number>();
        positionList.push(0);
        existingCandidate.add(0);

        let endPosition = 0;

        while (true) {
            const beginPosition = positionList.peek();
            if (beginPosition === undefined || beginPosition >= textLength) break;
            positionList.pop();

            const prefixes = this.dict.prefixLengthsOfText(text, beginPosition);
            for (const wordLength of prefixes) {
                const endCandidate = beginPosition + wordLength;
                if (isValidPos(validPosition, endCandidate)) {
                    const edges = graph.get(beginPosition);
                    if (edges) {
                        edges.push(endCandidate);
                    } else {
                        graph.set(beginPosition, [endCandidate]);
                    }

                    graphSize += 1;
                    if (!existingCandidate.has(endCandidate)) {
                        existingCandidate.add(endCandidate);
                        positionList.push(endCandidate);
                    }
                    if (graphSize > MAX_GRAPH_SIZE) {
                        break;
                    }
                }
            }

            const listLen = positionList.length;

            if (listLen === 1) {
                const firstCandidate = positionList.peek()!;
                const path = this.bfsPathsGraph(graph, endPosition, firstCandidate);
                graphSize = 0;
                graph.clear();

                for (let i = 1; i < path.length; i++) {
                    result.push(text.slice(endPosition, path[i]));
                    endPosition = path[i];
                }
            } else if (listLen === 0) {
                NON_THAI_RE.lastIndex = beginPosition;
                const nonThaiMatch = NON_THAI_RE.exec(text);

                if (nonThaiMatch && nonThaiMatch.index === beginPosition) {
                    endPosition = beginPosition + nonThaiMatch[0].length;
                } else {
                    let finishWithoutBreak = true;
                    for (let pos = beginPosition + 1; pos < textLength; pos++) {
                        if (isValidPos(validPosition, pos)) {
                            const listOfPrefixes = this.dict.prefixLengthsOfText(text, pos);

                            const validWords: number[] = [];
                            for (const wl of listOfPrefixes) {
                                const newPos = pos + wl;
                                if (isValidPos(validPosition, newPos)) {
                                    if (!isTwoCharThaiConsonants(text, pos, wl)) {
                                        validWords.push(wl);
                                    }
                                }
                            }

                            if (validWords.length > 0) {
                                endPosition = pos;
                                finishWithoutBreak = false;
                                break;
                            }
                            NON_THAI_RE.lastIndex = pos;
                            const ntMatch = NON_THAI_RE.exec(text);
                            if (ntMatch && ntMatch.index === pos) {
                                endPosition = pos;
                                finishWithoutBreak = false;
                                break;
                            }
                        }
                    }
                    if (finishWithoutBreak) {
                        endPosition = textLength;
                    }
                }

                graphSize = 0;
                graph.clear();
                result.push(text.slice(beginPosition, endPosition));
                positionList.push(endPosition);
                existingCandidate.add(endPosition);
            }
        }

        return result;
    }

    private bfsPathsGraph(
        graph: Map<number, number[]>,
        start: number,
        goal: number,
    ): number[] {
        const visited = new Set<number>();
        visited.add(start);
        const queue: { vertex: number; path: number[] }[] = [{ vertex: start, path: [start] }];
        let head = 0;

        while (head < queue.length) {
            const { vertex, path } = queue[head++];
            const neighbors = graph.get(vertex);
            if (neighbors) {
                for (const position of neighbors) {
                    if (position === goal) {
                        path.push(position);
                        return path;
                    }
                    if (!visited.has(position)) {
                        visited.add(position);
                        const newPath = path.slice();
                        newPath.push(position);
                        queue.push({ vertex: position, path: newPath });
                    }
                }
            }
        }

        throw new Error(`newmm BFS: cannot find goal ${goal} from start ${start}`);
    }
}
