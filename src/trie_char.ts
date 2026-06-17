class TrieNode {
    children: Record<string, TrieNode> | undefined = undefined;
    end = false;
}

export class TrieChar {
    private root = new TrieNode();
    private _wordCount = 0;

    constructor(words?: string[]) {
        if (words) {
            for (const w of words) {
                this.addWord(w);
            }
        }
    }

    addWord(word: string): void {
        const stripped = word.trim();
        if (stripped.length === 0) return;
        const chars = [...stripped];
        let node = this.root;
        for (const ch of chars) {
            if (!node.children) node.children = {};
            if (!(ch in node.children)) {
                node.children[ch] = new TrieNode();
            }
            node = node.children[ch];
        }
        if (!node.end) {
            node.end = true;
            this._wordCount++;
        }
    }

    removeWord(word: string): void {
        const stripped = word.trim();
        if (stripped.length === 0) return;
        if (!this.contains(stripped)) return;
        const chars = [...stripped];
        this.removeFromNode(this.root, chars, 0);
    }

    private removeFromNode(node: TrieNode, chars: string[], depth: number): void {
        if (depth === chars.length) {
            if (node.end) {
                node.end = false;
                this._wordCount--;
            }
            return;
        }
        const ch = chars[depth];
        const child = node.children !== undefined ? node.children[ch] : undefined;
        if (!child) return;
        this.removeFromNode(child, chars, depth + 1);
        if (!child.end && (child.children === undefined || Object.keys(child.children).length === 0)) {
            delete node.children![ch];
        }
    }

    contains(word: string): boolean {
        const stripped = word.trim();
        if (stripped.length === 0) return false;
        const chars = [...stripped];
        let node: TrieNode | undefined = this.root;
        for (const ch of chars) {
            if (!node.children) return false;
            node = node.children[ch];
            if (!node) return false;
        }
        return node.end;
    }

    wordCount(): number {
        return this._wordCount;
    }

    prefixLengthsOf(prefix: string): number[] {
        const result: number[] = [];
        const chars = [...prefix];
        let node: TrieNode | undefined = this.root;
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (!node.children) break;
            node = node.children[ch];
            if (!node) break;
            if (node.end) {
                result.push(i + 1);
            }
        }
        return result;
    }

    prefixLengthsOfChars(chars: readonly string[], startIdx: number): number[] {
        const result: number[] = [];
        let node: TrieNode | undefined = this.root;
        const len = chars.length;
        for (let i = startIdx; i < len; i++) {
            if (!node.children) break;
            node = node.children[chars[i]];
            if (!node) break;
            if (node.end) {
                result.push(i - startIdx + 1);
            }
        }
        return result;
    }
}
