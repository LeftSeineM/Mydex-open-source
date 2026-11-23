(function () {
    'use strict';
    // Small, text-node-only Markdown renderer. Raw HTML is deliberately never executed.
    // Source soft wraps flow naturally; blank lines separate paragraphs, two trailing
    // spaces / a trailing backslash create an explicit break. Code retains whitespace.
    const element = (tag, value) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; return node; };
    function inline(parent, source, depth = 0) {
        if (depth > 12) { parent.append(document.createTextNode(source)); return; }
        const pattern = /\\([\\`*_[\]{}()#+.!>~-])|(`+)([^`]*?)\2(?!`)|(\*\*|__)(?=\S)([\s\S]*?\S)\4|(\*|_)(?=\S)([^\n]*?\S)\6|(?: {2,}|\\)\n|\n/g;
        let position = 0;
        for (const match of source.matchAll(pattern)) {
            parent.append(document.createTextNode(source.slice(position, match.index)));
            if (match[1]) parent.append(document.createTextNode(match[1]));
            else if (match[2]) parent.append(element('code', match[3].replace(/\n/g, ' ')));
            else if (match[4] || match[6]) { const node = element(match[4] ? 'strong' : 'em'); inline(node, match[5] || match[7], depth + 1); parent.append(node); }
            else if (match[0] !== '\n') parent.append(element('br'));
            else parent.append(document.createTextNode(' '));
            position = match.index + match[0].length;
        }
        parent.append(document.createTextNode(source.slice(position)));
    }
    const fence = line => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const heading = line => /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
    const rule = line => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
    const list = line => /^( *)([-+*]|\d+[.)]) +(.*)$/.exec(line);
    const quote = line => /^ {0,3}> ?/.test(line);
    const blockStart = line => !!fence(line) || !!heading(line) || rule(line) || !!list(line) || quote(line);
    function blocks(parent, lines, options, depth = 0) {
        if (depth > 12) { const p = element('p'); inline(p, lines.join('\n')); parent.append(p); return; }
        let i = 0;
        while (i < lines.length) {
            if (!lines[i].trim()) { i++; continue; }
            const start = fence(lines[i]);
            if (start) {
                const language = start[2].trim().split(/\s/)[0], code = [];
                const closing = new RegExp('^ {0,3}' + start[1][0] + '{' + start[1].length + ',}\\s*$');
                i++;
                while (i < lines.length && !closing.test(lines[i])) code.push(lines[i++]);
                const closed = i < lines.length;
                if (closed) i++;
                const raw = code.join('\n') + (closed && code.length ? '\n' : '');
                const wrap = element('section'); wrap.className = 'code-block';
                const header = element('header'); header.className = 'code-header';
                header.append(element('span', language || '代码'));
                const copy = element('button', '复制代码'); copy.className = 'code-copy'; copy.type = 'button';
                copy.setAttribute('aria-label', '复制代码' + (language ? ' · ' + language : ''));
                copy.onclick = async () => {
                    try { await (options.copy || (value => navigator.clipboard.writeText(value)))(raw); copy.textContent = '已复制'; }
                    catch { copy.textContent = '复制失败，请重试'; }
                };
                header.append(copy);
                const pre = element('pre'); pre.append(element('code', raw)); wrap.append(header, pre); parent.append(wrap);
                continue;
            }
            const h = heading(lines[i]);
            if (h) { const node = element('h' + h[1].length); inline(node, h[2].replace(/[ \t]+#+$/, '')); parent.append(node); i++; continue; }
            if (rule(lines[i])) { parent.append(element('hr')); i++; continue; }
            if (quote(lines[i])) {
                const content = [];
                while (i < lines.length && quote(lines[i])) content.push(lines[i++].replace(/^ {0,3}> ?/, ''));
                const node = element('blockquote'); blocks(node, content, options, depth + 1); parent.append(node); continue;
            }
            const first = list(lines[i]);
            if (first) {
                const indent = first[1].length, ordered = /^\d/.test(first[2]);
                const node = element(ordered ? 'ol' : 'ul');
                if (ordered) node.start = parseInt(first[2], 10);
                let loose = false;
                while (i < lines.length) {
                    const item = list(lines[i]);
                    if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
                    const contentIndent = item[0].length - item[3].length;
                    const content = [item[3]]; i++;
                    while (i < lines.length) {
                        if (!lines[i].trim()) {
                            let next = i + 1; while (next < lines.length && !lines[next].trim()) next++;
                            const following = list(lines[next] || '');
                            if (following && following[1].length === indent && /^\d/.test(following[2]) === ordered) { loose = true; i = next; break; }
                            if (next < lines.length && /^ */.exec(lines[next])[0].length >= contentIndent) { content.push(''); loose = true; i++; continue; }
                            break;
                        }
                        if (/^ */.exec(lines[i])[0].length >= contentIndent) { content.push(lines[i++].slice(contentIndent)); continue; }
                        if (blockStart(lines[i])) break;
                        content.push(lines[i++]); // Markdown lazy continuation, not a new paragraph.
                    }
                    const li = element('li'); blocks(li, content, options, depth + 1); node.append(li);
                }
                node.className = loose ? 'loose-list' : 'tight-list'; parent.append(node); continue;
            }
            const content = [lines[i++]];
            while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) content.push(lines[i++]);
            const p = element('p'); inline(p, content.join('\n')); parent.append(p);
        }
    }
    function render(node, value, options = {}) {
        const raw = String(value);
        const fragment = document.createDocumentFragment();
        blocks(fragment, raw.replace(/\r\n?/g, '\n').split('\n'), options);
        node.replaceChildren(fragment); node.dataset.raw = raw;
    }
    window.mydexMarkdown = { render };
}());
