import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NewmmTokenizer } from '../src/newmm.js';
import { TrieChar } from '../src/trie_char.js';
import { tccPos } from '../src/tcc_tokenizer.js';

function sampleWordList(): string[] {
    return ['ภาษา', 'ไทย', 'ทดสอบ', 'การ', 'ตัด', 'คำ'];
}

describe('TrieChar', () => {
    it('add and remove words', () => {
        const trie = new TrieChar(['ศาล']);
        assert.equal(trie.wordCount(), 1);

        trie.addWord('ศาล');
        assert.equal(trie.wordCount(), 1);

        trie.addWord('  ศาล ');
        assert.equal(trie.wordCount(), 1);

        trie.addWord('ศาลา');
        assert.equal(trie.wordCount(), 2);

        trie.removeWord('ศาลา');
        assert.equal(trie.wordCount(), 1);

        trie.removeWord('ลา');
        assert.equal(trie.wordCount(), 1);

        trie.removeWord('ศาล');
        assert.equal(trie.wordCount(), 0);

        trie.removeWord('');
        assert.equal(trie.wordCount(), 0);
    });

    it('prefix_ref returns correct lengths', () => {
        const trie = new TrieChar(['ก', 'กข', 'กขค', 'คง']);
        const lengths = trie.prefixLengthsOf('กขคงจ');
        assert.ok(lengths.includes(1));
        assert.ok(lengths.includes(2));
        assert.ok(lengths.includes(3));
        assert.equal(lengths.length, 3);
    });
});

describe('TCC Tokenizer', () => {
    it('tcc_pos for karan text', () => {
        const result = tccPos('พิสูจน์ได้ค่ะ');
        assert.ok(result.includes(2));
        assert.ok(result.includes(7));
        assert.ok(result.includes(10));
        assert.ok(result.includes(13));
    });

    it('tcc_pos strictly increasing and in bounds', () => {
        const text = 'ภาษาไทยภาษาไทยABC123';
        const positions = tccPos(text);
        const totalChars = [...text].length;

        for (let i = 1; i < positions.length; i++) {
            assert.ok(positions[i - 1] < positions[i]);
        }
        for (const p of positions) {
            assert.ok(p > 0 && p <= totalChars);
        }
        assert.equal(positions[positions.length - 1], totalChars);
    });
});

describe('NewmmTokenizer', () => {
    it('defaults match explicit options', () => {
        const tok = NewmmTokenizer.fromWordList(sampleWordList());
        const text = 'ภาษาไทยทดสอบการตัดคำ';

        const viaDefault = tok.segment(text);
        const viaExplicit = tok.segmentWithOptions(text, false, undefined);

        assert.deepEqual(viaDefault, viaExplicit);
    });

    it('add and remove words', () => {
        const tok = NewmmTokenizer.fromWordList(['ห้องสมุด', 'ประชา', 'ชน', 'เทศบาลตำบล', 'วิชิต']);

        tok.addWord('ห้องสมุดประชาชนเทศบาลตำบลวิชิต');
        assert.deepEqual(
            tok.segment('ห้องสมุดประชาชนเทศบาลตำบลวิชิต'),
            ['ห้องสมุดประชาชนเทศบาลตำบลวิชิต']
        );

        tok.removeWord('ห้องสมุดประชาชนเทศบาลตำบลวิชิต', 'ห้องสมุดประชาชน', 'ประชาชน');
        assert.deepEqual(
            tok.segment('ห้องสมุดประชาชนเทศบาลตำบลวิชิต'),
            ['ห้องสมุด', 'ประชา', 'ชน', 'เทศบาลตำบล', 'วิชิต']
        );
    });

    it('segment basic Thai text', () => {
        const tok = NewmmTokenizer.fromWordList(sampleWordList());
        const result = tok.segment('ภาษาไทยทดสอบการตัดคำ');

        assert.equal(result.join(''), 'ภาษาไทยทดสอบการตัดคำ');
        assert.ok(result.length > 0);
    });

    it('empty input returns empty array', () => {
        const tok = NewmmTokenizer.fromWordList(sampleWordList());
        assert.deepEqual(tok.segment(''), []);
    });

    it('handles non-Thai patterns', () => {
        const tok = NewmmTokenizer.fromWordList(['มาตรา']);
        assert.deepEqual(tok.segment('มาตรา39'), ['มาตรา', '39']);
        assert.deepEqual(tok.segment('19...'), ['19', '...']);
        assert.deepEqual(tok.segment('19.'), ['19', '.']);
    });

    it('handles Thai numbers', () => {
        const tok = NewmmTokenizer.fromWordList(['มาตรา']);
        assert.deepEqual(tok.segment('๑๙...'), ['๑๙', '...']);
        assert.deepEqual(tok.segment('๑๙.'), ['๑๙', '.']);
    });

    it('segment with real Thai text patterns', () => {
        const tok = NewmmTokenizer.fromWordList(['นิสสัน', 'ผ่อน', 'จน', 'เพลีย', 'นาวา', 'ร่า', '..']);
        assert.deepEqual(
            tok.segment('นิสสันผ่อนจนเพลียนาวาร่า..'),
            ['นิสสัน', 'ผ่อน', 'จน', 'เพลีย', 'นาวา', 'ร่า', '..']
        );
    });

    it('segment handles mixed Thai and English', () => {
        const tok = NewmmTokenizer.fromWordList(['ประมวลผล', 'ภาษาไทย', 'มาตรา']);
        assert.deepEqual(
            tok.segment('1) ประมวลผลภาษาไทย'),
            ['1', ')', ' ', 'ประมวลผล', 'ภาษาไทย']
        );
    });

    it('BFS path explosion protection', () => {
        const chars = ['ก', 'ข', 'ค', 'ง', 'จ'];
        const words: string[] = [];
        for (const c of chars) words.push(c);
        for (const c1 of chars) {
            for (const c2 of chars) {
                words.push(c1 + c2);
            }
        }
        for (const c1 of chars) {
            for (const c2 of chars) {
                for (const c3 of chars) {
                    words.push(c1 + c2 + c3);
                }
            }
        }

        const tok = NewmmTokenizer.fromWordList(words);
        const text = 'กขคงจ'.repeat(50);

        const start = Date.now();
        const result = tok.segment(text);
        const elapsed = Date.now() - start;

        assert.ok(result.length > 0);
        assert.ok(elapsed < 5000, `tokenization took ${elapsed}ms`);
    });

    it('uses default dictionary when no custom words given', () => {
        const tok = new NewmmTokenizer();
        const result = tok.segment('ภาษาไทย');
        assert.ok(result.length > 0);
        assert.equal(result.join(''), 'ภาษาไทย');
    });

    it('merges custom words with default dictionary', () => {
        const tok = new NewmmTokenizer(['คำศัพท์เฉพาะทาง']);
        const result = tok.segment('คำศัพท์เฉพาะทาง');
        assert.equal(result.join(''), 'คำศัพท์เฉพาะทาง');
    });
});

