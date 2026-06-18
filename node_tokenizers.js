const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// ---------------------------------------------------------------------------
// Tokenizer factories
// ---------------------------------------------------------------------------

const TOKENIZER_FACTORIES = {
  'nlpo3-newmm': () => {
    const { NewmmTokenizer } = require('nlpo3-newmm-typescript');
    const tok = new NewmmTokenizer();
    return (text) => tok.segment(text);
  },
  'intl-segmenter': () => {
    const { Segmenter } = require('intl-segmenter');
    const segmenter = new Segmenter('th', { granularity: 'word' });
    return (text) => {
      const segments = [...segmenter.segment(text)];
      return segments.map(s => s.segment).filter(t => t.trim() !== '');
    };
  },
  'wordcut': () => {
    const Wordcut = require('wordcut');
    Wordcut.init('');
    return (text) => Wordcut.cut(text).split('|');
  },
  'tnthai': () => {
    const ThaiAnalyzer = require('tnthai');
    const analyzer = new ThaiAnalyzer();
    return (text) => analyzer.segmenting(text).solution;
  },
};

// ---------------------------------------------------------------------------
// Stdin/stdout protocol (for test_all.py subprocess)
// ---------------------------------------------------------------------------

function runStdinMode(model) {
  const factory = TOKENIZER_FACTORIES[model];
  if (!factory) {
    process.stderr.write('Unknown mode: ' + model + '\n');
    process.exit(1);
  }

  const tokenize = factory();
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    try {
      const tokens = tokenize(line);
      process.stdout.write(JSON.stringify(tokens) + '\n');
    } catch (e) {
      process.stderr.write(e.message + '\n');
      process.stdout.write('[]\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// CSV parsing (zero-dependency)
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ',') { i++; continue; }
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"'; i += 2;
          } else {
            i++; break;
          }
        } else {
          field += line[i]; i++;
        }
      }
      fields.push(field);
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') { field += line[i]; i++; }
      fields.push(field);
    }
  }
  return fields;
}

function parsePythonList(raw) {
  const s = raw.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return [];
  const inner = s.slice(1, -1);
  const items = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && ' ,\t\n\r'.includes(inner[i])) i++;
    if (i >= inner.length) break;
    if (inner[i] === '"' || inner[i] === "'") {
      const quote = inner[i]; i++;
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
        } else { str += inner[i]; i++; }
      }
      if (i < inner.length) i++;
      items.push(str);
    } else {
      while (i < inner.length && inner[i] !== ',' && inner[i] !== ']') i++;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Dataset loaders
// ---------------------------------------------------------------------------

function loadLST20(path) {
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const sentences = [], groundTruths = [];
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

function loadMenuDataset(path) {
  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n');
  const sentences = [], groundTruths = [], levels = [];
  for (let row = 1; row < lines.length; row++) {
    const fields = parseCsvLine(lines[row]);
    if (fields.length < 4) continue;
    const text = fields[2], goldSeg = fields[3];
    if (!text || !goldSeg) continue;
    sentences.push(text);
    groundTruths.push(goldSeg.split('|'));
    levels.push(fields[1]);
  }
  return { sentences, groundTruths, levels };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeF1(gold, pred) {
  const goldClean = gold.filter(t => t.trim());
  const predClean = pred.filter(t => t.trim());
  if (!goldClean.length || !predClean.length) return { f1: 0, prec: 0, rec: 0 };

  const goldText = goldClean.join('');
  const predText = predClean.join('');
  if (goldText !== predText) return { f1: 0, prec: 0, rec: 0 };

  const goldBounds = new Set();
  let pos = 0;
  for (const tok of goldClean) { pos += tok.length; goldBounds.add(pos); }

  const predBounds = new Set();
  pos = 0;
  for (const tok of predClean) { pos += tok.length; predBounds.add(pos); }

  let tp = 0, fp = 0, fn = 0;
  const allChars = goldText.length;
  for (let i = 1; i < allChars; i++) {
    const p = predBounds.has(i), g = goldBounds.has(i);
    if (p && g) tp++;
    else if (p && !g) fp++;
    else if (!p && g) fn++;
  }

  const prec = tp / (tp + fp) || 0;
  const rec = tp / (tp + fn) || 0;
  const f1 = (2 * prec * rec) / (prec + rec) || 0;
  return { f1: f1 * 100, prec: prec * 100, rec: rec * 100 };
}

// ---------------------------------------------------------------------------
// Standalone benchmark
// ---------------------------------------------------------------------------

function formatMem(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function measureMemory(label, fn) {
  if (typeof gc === 'function') { gc(); gc(); }
  const before = process.memoryUsage();
  const result = fn();
  if (typeof gc === 'function') { gc(); gc(); }
  const after = process.memoryUsage();
  return {
    label,
    heapDelta: after.heapUsed - before.heapUsed,
    rssDelta: after.rss - before.rss,
    heapAfter: after.heapUsed,
    rssAfter: after.rss,
    result,
  };
}

function benchModel(modelName, createFn, dataset) {
  const { sentences, groundTruths } = dataset;
  const tokenize = createFn();
  const start = performance.now();
  let exactMatch = 0, totalF1 = 0, totalPrec = 0, totalRec = 0;
  let errors = 0;
  const n = sentences.length;

  for (let i = 0; i < n; i++) {
    let pred;
    try {
      pred = tokenize(sentences[i]);
    } catch {
      errors++;
      continue;
    }
    const gold = groundTruths[i];
    if (pred.join('') === gold.join('')) {
      exactMatch++;
      const { f1, prec, rec } = computeF1(gold, pred);
      totalF1 += f1; totalPrec += prec; totalRec += rec;
    }
  }

  const elapsed = performance.now() - start;
  const completed = n - errors;
  return {
    avgF1: completed > 0 ? totalF1 / n : 0,
    avgPrec: completed > 0 ? totalPrec / n : 0,
    avgRec: completed > 0 ? totalRec / n : 0,
    elapsed, avgMs: completed > 0 ? elapsed / completed : 0,
    throughput: completed > 0 ? (completed / elapsed) * 1000 : 0,
    exactMatch, total: n, errors
  };
}

function printRow(name, f1, prec, rec, elapsed, avgMs, throughput, match, n, errors) {
  const errStr = errors ? ` ${errors}err` : '';
  console.log(
    `${name.padEnd(18)} ${f1.toFixed(2).padStart(8)}% ${prec.toFixed(2).padStart(8)}% ${rec.toFixed(2).padStart(8)}% ` +
    `${elapsed.toFixed(0).padStart(12)}ms ${avgMs.toFixed(2).padStart(8)}ms ${throughput.toFixed(0).padStart(8)}/s ` +
    `${match}/${n}`.padStart(8) + errStr
  );
}

function printHeader(label, n) {
  console.log(`\n${'='.repeat(84)}`);
  console.log(`${label} (${n} sentences)`);
  console.log(`${'='.repeat(84)}`);
  console.log(
    `${'Model'.padEnd(18)} ${'F1'.padStart(8)} ${'Prec'.padStart(8)} ${'Rec'.padStart(8)} ` +
    `${`Total(${n})`.padStart(12)} ${'ms/sent'.padStart(8)} ${'sent/s'.padStart(8)} ${'Match'.padStart(8)}`
  );
  console.log('-'.repeat(84));
}

function runBenchmarks() {
  const datasetDir = join(__dirname, 'dataset');

  // -----------------------------------------------------------------------
  // Dictionary & memory measurement
  // -----------------------------------------------------------------------
  const DICT_SIZES = {
    'nlpo3-newmm': '~62,000',
    'wordcut': '~25,000',
    'tnthai': '~20,000',
    'intl-segmenter': 'unknown',
  };

  console.log(`\n${'='.repeat(70)}`);
  console.log('DICTIONARY & MEMORY (tokenizer construction)');
  console.log(`${'='.repeat(70)}`);
  console.log(`${'Model'.padEnd(18)} ${'Dict'.padStart(10)} ${'Heap Δ'.padStart(10)} ${'RSS Δ'.padStart(10)} ${'RSS idle'.padStart(10)}`);
  console.log('-'.repeat(70));

  const memResults = {};
  for (const model of Object.keys(TOKENIZER_FACTORIES)) {
    process.stdout.write(`Measuring ${model}... `);
    try {
      const mem = measureMemory(model, () => TOKENIZER_FACTORIES[model]());
      memResults[model] = mem;
      console.log(`${formatMem(mem.heapDelta).padStart(8)} ${formatMem(mem.rssDelta).padStart(8)} ${formatMem(mem.rssAfter).padStart(8)}`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }
  console.log(`${'-'.repeat(70)}`);

  // print the table (collect during measurement above, print here)
  for (const model of Object.keys(TOKENIZER_FACTORIES)) {
    const mem = memResults[model];
    if (mem) {
      const dict = DICT_SIZES[model] || 'unknown';
      console.log(
        `${model.padEnd(18)} ${dict.padStart(10)} ${formatMem(mem.heapDelta).padStart(10)} ${formatMem(mem.rssDelta).padStart(10)} ${formatMem(mem.rssAfter).padStart(10)}`
      );
    } else {
      console.log(`${model.padEnd(18)} ${(DICT_SIZES[model]||'unknown').padStart(10)} ${'FAILED'.padStart(10)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Datasets
  // -----------------------------------------------------------------------
  console.log('\nLoading datasets...');
  const lst20 = loadLST20(join(datasetDir, 'lst20.csv'));
  console.log(`  LST20:              ${lst20.sentences.length} sentences`);

  const menu = loadMenuDataset(join(datasetDir, 'thai_wordseg_menu.csv'));
  console.log(`  thai_wordseg_menu:  ${menu.sentences.length} sentences`);

  // -----------------------------------------------------------------------
  // Speed + accuracy benchmarks
  // -----------------------------------------------------------------------
  const models = Object.keys(TOKENIZER_FACTORIES);
  const allResults = {};

  for (const [dsLabel, ds] of [['LST20', lst20], ['thai_wordseg_menu', menu]]) {
    const results = {};
    for (const model of models) {
      process.stdout.write(`Benchmarking ${model}... `);
      try {
        results[model] = benchModel(model, TOKENIZER_FACTORIES[model], ds);
        console.log('done');
      } catch (e) {
        console.log(`FAILED: ${e.message}`);
      }
    }
    allResults[dsLabel] = results;
    printHeader(dsLabel, ds.sentences.length);
    for (const model of models) {
      const r = results[model];
      if (r) printRow(model, r.avgF1, r.avgPrec, r.avgRec, r.elapsed, r.avgMs, r.throughput, r.exactMatch, r.total, r.errors);
    }
  }

  // -----------------------------------------------------------------------
  // Combined summary
  // -----------------------------------------------------------------------
  console.log(`\n${'='.repeat(80)}`);
  console.log('COMBINED (LST20 300 + menu 109 = 409 sentences)');
  console.log(`${'='.repeat(80)}`);
  console.log(`${'Model'.padEnd(18)} ${'LST20'.padStart(10)} ${'Menu'.padStart(10)} ${'Total'.padStart(10)} ${'Mem'.padStart(10)} ${'F1(L)'.padStart(8)} ${'F1(M)'.padStart(8)}`);
  console.log('-'.repeat(76));
  for (const model of models) {
    const l = allResults['LST20']?.[model];
    const m = allResults['thai_wordseg_menu']?.[model];
    const mem = memResults[model];
    const lTime = l ? l.elapsed.toFixed(0) : 'N/A';
    const mTime = m ? m.elapsed.toFixed(0) : 'N/A';
    const total = (l && m) ? (l.elapsed + m.elapsed).toFixed(0) : 'N/A';
    const lF1 = l ? l.avgF1.toFixed(1) : 'N/A';
    const mF1 = m ? m.avgF1.toFixed(1) : 'N/A';
    const memStr = mem ? formatMem(mem.rssDelta) : 'N/A';
    console.log(
      `${model.padEnd(18)} ${(lTime+'ms').padStart(10)} ${(mTime+'ms').padStart(10)} ${(total+'ms').padStart(10)} ` +
      `${memStr.padStart(10)} ${(lF1+'%').padStart(8)} ${(mF1+'%').padStart(8)}`
    );
  }

  // -----------------------------------------------------------------------
  // Menu by difficulty
  // -----------------------------------------------------------------------
  console.log(`\n${'='.repeat(50)}`);
  console.log('thai_wordseg_menu by difficulty (nlpo3-newmm)');
  console.log(`${'='.repeat(50)}`);
  console.log(`${'Level'.padEnd(12)} ${'Sentences'.padStart(10)} ${'F1'.padStart(8)} ${'Match'.padStart(8)}`);
  console.log('-'.repeat(40));

  const groups = {};
  for (let i = 0; i < menu.sentences.length; i++) {
    const lv = menu.levels[i];
    if (!groups[lv]) groups[lv] = { sentences: [], truths: [] };
    groups[lv].sentences.push(menu.sentences[i]);
    groups[lv].truths.push(menu.groundTruths[i]);
  }

  const { NewmmTokenizer } = require('nlpo3-newmm-typescript');
  const tok = new NewmmTokenizer();
  for (const [level, data] of Object.entries(groups)) {
    let exact = 0, totalF1 = 0;
    for (let i = 0; i < data.sentences.length; i++) {
      const pred = tok.segment(data.sentences[i]);
      const gold = data.truths[i];
      if (pred.join('') === gold.join('')) { exact++; totalF1 += computeF1(gold, pred).f1; }
    }
    const n = data.sentences.length;
    console.log(`${level.padEnd(12)} ${String(n).padStart(10)} ${((totalF1/n).toFixed(1)+'%').padStart(8)} ${(exact+'/'+n).padStart(8)}`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const arg = process.argv[2];

if (!arg || arg === '--benchmark') {
  runBenchmarks();
} else {
  runStdinMode(arg);
}
