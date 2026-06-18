# nlpo3-newmm-typescript

Pure TypeScript / ES2016 implementation of the **NewMM** (New Maximum Matching) Thai word tokenizer.

Transliterated from the Rust version of [nlpO3](https://github.com/PyThaiNLP/nlpo3) — a Thai natural language processing library by PyThaiNLP.

No native bindings, no build tools required — pure JavaScript that works in both ESM and CommonJS.

**Project VideCode use deepseek 4 Pro**

## Features

- **NewMM algorithm** — dictionary-based maximal matching with Thai Character Cluster (TCC) boundary constraints
- **TrieChar dictionary** — character-level trie for O(k) prefix lookups
- **BFS path resolution** — shortest-path graph search over candidate split positions
- **Path explosion protection** — visited set + `MAX_GRAPH_SIZE=50` prevent exponential blowup
- **Safe mode** — sliding-window heuristic for long texts with many ambiguities
- **Default dictionary** — bundled `words_th.txt` (~62k words, 1.6 MB) from nlpO3
- **Dual ESM/CJS** — works with `import` and `require()`

## Installation

```bash
npm install nlpo3-newmm-typescript
```

## Usage

### TypeScript / ESM

```typescript
import { NewmmTokenizer } from 'nlpo3-newmm-typescript';

// Default dictionary only
const tok = new NewmmTokenizer();
tok.segment('ภาษาไทยเป็นภาษาที่มีโครงสร้างซับซ้อน');
// ['ภาษา', 'ไทย', 'เป็น', 'ภาษา', 'ที่', 'มี', 'โครงสร้าง', 'ซับซ้อน']
```

### CommonJS

```javascript
const { NewmmTokenizer } = require('nlpo3-newmm-typescript');

const tok = new NewmmTokenizer();
const tokens = tok.segment('สวัสดีชาวโลก');
```

### Default dictionary + custom words

```typescript
const tok = new NewmmTokenizer(['คำศัพท์เฉพาะทาง', 'nlpo3']);
tok.segment('nlpo3เป็นคำศัพท์เฉพาะทาง');
// ['nlpo3', 'เป็น', 'คำศัพท์เฉพาะทาง']
```

### Isolated word list (no defaults)

```typescript
const tok = NewmmTokenizer.fromWordList(['สวัสดี', 'ชาว', 'โลก']);
tok.segment('สวัสดีชาวโลก');
// ['สวัสดี', 'ชาว', 'โลก']
```

### Add / remove words dynamically

```typescript
const tok = new NewmmTokenizer();
tok.addWord('นิวซีแลนด์');
tok.removeWord('ที่ไม่ต้องการ');
tok.segment('นิวซีแลนด์');
```

### Safe mode (for long texts)

```typescript
tok.segment(longText, true);  // second arg = safe mode
```

## API

### `new NewmmTokenizer(customWords?: string[])`

Create a tokenizer with the built-in ~62k word dictionary. Optionally merge custom words on top.

### `NewmmTokenizer.fromWordList(words: string[])`

Create a tokenizer using **only** the given word list. No default dictionary.

### `segment(text: string, safe?: boolean): string[]`

Tokenize `text` into words.

- `safe` — enable safe mode (default `false`). Uses a sliding window to avoid long run times on highly ambiguous input. Recommended for texts longer than ~140 characters.

### `segmentWithOptions(text: string, safe: boolean, parallelChunkSize?: number): string[]`

Full-options entry point. `parallelChunkSize` is accepted for API parity with the Rust version but has no effect in this single-threaded implementation.

### `addWord(...words: string[]): void`

Add one or more words to the dictionary.

### `removeWord(...words: string[]): void`

Remove one or more words from the dictionary.

## How it works

```
Input text
    ↓
TCC (Thai Character Cluster) — compute valid split positions
    ↓
Main loop (min-heap of candidate positions):
  ├─ dictionary prefix lookup at current position
  ├─ build graph: position → position + word_length
  ├─ when only 1 candidate → BFS shortest path → extract tokens
  └─ when 0 candidates → non-Thai pattern match / forward scan
    ↓
Word tokens
```

The algorithm is the same dictionary-based maximal matching used by [PyThaiNLP](https://github.com/PyThaiNLP/pythainlp)'s `newmm` tokenizer, with:
- TCC rules from Theeramunkong et al. 2000
- BFS path resolution with visited-set cycle prevention
- Non-Thai text detection (English, numbers, whitespace)

## Benchmarks

> Run standalone: `node --expose-gc node_tokenizers.js`
> Run Python bridge: `python test_all.py`
> Run Node.js test: `npm run test:perf`

### Performance Impact (v1.0.3 optimization)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Throughput (LST20) | ~50 sent/s | ~492 sent/s | **~10x** |
| Avg per sentence | ~20 ms | ~2.0 ms | **~10x** |

**Optimizations applied:**
- Eliminated all `Array.from()` calls from hot path (trie walk via `text[i]` string indexing)
- Replaced `chars.slice().join('')` with zero-copy `string.slice()` throughout
- Rewrote `tccPos` to use regex `lastIndex` instead of per-character `string.slice()` (zero alloc)
- Inlined `THAI_TWOCHARS_PATTERN` regex check with `charCodeAt` range comparison
- `NON_THAI_PATTERN` uses sticky (`y`) flag with `lastIndex` — no substring creation
- BFS queue `shift()` replaced with O(1) head-pointer deque
- Eliminated `graph.has()+graph.get()` double `Map` lookup
- Hoisted `isValidPosition` closure to module-level function
- Cached token lengths in safe-mode sliding window

### Dictionary & Memory

| Model | Dictionary Size | Memory (RSS Δ) |
|-------|----------------|----------------|
| **nlpo3-newmm (TS)** | **~62,000** | 53.8 MB |
| wordcut (JS) | ~25,000 | 25.3 MB |
| tnthai (JS) | ~20,000 | 7.0 MB |
| intl-segmenter (C++ ICU) | unknown | 2.0 MB |

### Accuracy

| Dataset | Sentences | Text Match | Boundary F1 |
|---------|-----------|------------|-------------|
| LST20 | 300 | 99.3% | **88.6%** |

### Cross-Lib Comparison (LST20, 300 sentences)

| Model | F1 | Time | ms/sent | Memory |
|-------|-----|------|---------|--------|
| **nlpo3-newmm (TS)** | **88.4%** | **509ms** | 1.70 | 53.8 MB |
| intl-segmenter (JS but build from C++) | 75.5% | 446ms | 1.49 | 2.0 MB |
| wordcut (JS) | 72.9% | 3558ms | 11.86 | 25.3 MB |
| tnthai (JS) | 40.4% | 6728ms | 48.40 | 7.0 MB |

*`intl-segmenter` is a native C++ binding (ICU). `nlpo3-newmm` is pure TypeScript — within 60ms of native C++ while delivering best-in-class accuracy.*

## Tests

```bash
npm test
```

## Build

```bash
npm run build
```

Output:
- `dist/index.js` — ESM bundle (target es2020)
- `dist/index.cjs` — CommonJS bundle (target es2016)
- `dist/index.d.ts` + `dist/index.d.cts` — TypeScript declarations
- `dist/words_th.txt` — bundled dictionary

## Project structure

```
src/
  index.ts          — Public exports
  newmm.ts          — NewmmTokenizer (main algorithm)
  trie_char.ts      — Character-based trie dictionary
  tcc_rules.ts      — TCC regex patterns (24 rules)
  tcc_tokenizer.ts  — TCC position computation
  default_dict.ts   — Default dictionary loader
  words_th.txt      — Bundled ~62k word dictionary
test/
  newmm.test.ts     — Test suite (15 tests)
scripts/
  fix-cjs.mjs       — Post-build CJS compat patching
tsup.config.ts      — Build config (dual ESM/CJS)
```

## Credits

- **Algorithm**: Korakot Chaovavanich, Jakkrit TeCho, Wittawat Jitkrittum, Thanathip Suntorntip
- **Rust implementation**: [nlpO3](https://github.com/PyThaiNLP/nlpo3) by [PyThaiNLP](https://github.com/PyThaiNLP)
- **TCC rules**: Theeramunkong et al. 2000 — *"Learning-based Thai Word Boundary"*
- **Thai dictionary**: PyThaiNLP project (`words_th.txt`)

## License

Apache-2.0 (matching nlpO3)
