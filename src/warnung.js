/*
 * Modul: Betrugswarnung
 * ---------------------
 * Liest die Nachrichten auf der Nachrichtenseite und markiert solche mit typischen Maschen
 * gegen Verkäufer (Regeln in src/regeln.js): rot bei hohem Risiko, gelb als Hinweis.
 * Unter der Nachricht steht, was aufgefallen ist.
 *
 * - Nur Lesen: Es wird nichts nachgeladen und nichts weggeschickt.
 * - Die Nachrichten werden nicht über feste Selektoren gesucht, sondern als kleinste
 *   Textblöcke der Seite. Darum klappt es auch, wenn Kleinanzeigen den Aufbau ändert.
 *   Eigene Nachrichten können dabei auch markiert werden.
 */

(function () {
    'use strict';

    const CONFIG = {
        keys: { settings: 'kpw-warnung' },
        defaultSettings: { hints: true },   // auch gelbe Hinweise zeigen
        // Nur auf diesen Seiten prüfen (Pfad). Stand 10/2026, mit eingeloggtem Konto zu bestätigen.
        paths: [/^\/m-nachrichten/],
        // Bereich der Seite, in dem gesucht wird (erster Treffer), sonst <body>
        rootSelectors: ['main', '#site-content', '#content'],
        minLength: 8,
        maxLength: 3000,
        scanDelayMs: 400,
    };

    if (!CONFIG.paths.some(re => re.test(window.location.pathname))) return;

    const { el, load, save, isObj } = KS;

    const loadSettings = () => {
        const raw = load(CONFIG.keys.settings, {});
        return { ...CONFIG.defaultSettings, ...(isObj(raw) ? raw : {}) };
    };
    let settings = loadSettings();

    // ------------------------------------------------------------------
    // Textblöcke finden
    // ------------------------------------------------------------------

    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON', 'SVG', 'TEMPLATE', 'HEAD', 'IFRAME']);
    const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'BR', 'IMG', 'SMALL', 'U', 'S', 'MARK', 'WBR', 'TIME', 'ABBR', 'CODE', 'SUP', 'SUB', 'Q', 'CITE', 'BDI', 'BDO']);

    const isOurs = (node) => !!node.closest('[data-kpw-ui], .ks-overlay');
    const inEditor = (node) => !!node.closest('[contenteditable]:not([contenteditable="false"])');

    // Element, dessen Inhalt nur aus Text und Inline-Elementen besteht
    function isTextBlock(node, memo) {
        if (memo.has(node)) return memo.get(node);
        let ok = !SKIP.has(node.tagName) && node.firstChild !== null;
        if (ok) {
            for (const c of node.children) {
                const empty = c.tagName === 'BR' || c.tagName === 'IMG' || c.tagName === 'WBR';
                if (!INLINE.has(c.tagName) || !empty && !isTextBlock(c, memo)) { ok = false; break; }
            }
        }
        memo.set(node, ok);
        return ok;
    }

    // Die obersten Textblöcke: ganze Nachricht statt einzelner <span>
    function findBlocks(root) {
        const memo = new Map();
        const out = [];
        for (const node of root.querySelectorAll('*')) {
            if (!isTextBlock(node, memo)) continue;
            const parent = node.parentElement;
            if (parent && parent !== root && isTextBlock(parent, memo)) continue;
            if (isOurs(node) || inEditor(node)) continue;
            out.push(node);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Markieren
    // ------------------------------------------------------------------

    const style = el('style', { 'data-kpw-ui': '' }, `
        [data-kpw-warn="hoch"] { outline: 2px solid #c62828; outline-offset: 2px; border-radius: 4px; }
        [data-kpw-warn="hinweis"] { outline: 2px solid #e0a100; outline-offset: 2px; border-radius: 4px; }
        .kpw-warn {
            margin: 6px 0; padding: 8px 10px; border-radius: 8px; max-width: 520px; box-sizing: border-box;
            font: 13px/1.4 system-ui, sans-serif; text-align: left; white-space: normal;
            background: #fff8e1; color: #5c4400; border: 1px solid #f0d58a;
        }
        .kpw-warn[data-level="hoch"] { background: #fdecea; color: #8e1c1c; border-color: #f2b8b5; }
        .kpw-warn-head { display: flex; gap: 8px; align-items: baseline; font-weight: 700; }
        .kpw-warn-head span { flex: 1; }
        .kpw-warn-head button { border: 0; background: none; padding: 0; color: inherit; font: inherit; font-weight: 400; text-decoration: underline; cursor: pointer; }
        .kpw-warn ul { margin: 4px 0 0; padding-left: 18px; }
        .kpw-warn p { margin: 6px 0 0; }
    `);

    let state = new WeakMap();      // Block -> { text, badge }
    const dismissed = new Set();    // Texte, deren Warnung weggeklickt wurde (bis zum Neuladen)

    function badgeFor(res, text, block) {
        const high = res.level === 'hoch';
        const badge = el('div', { className: 'kpw-warn', 'data-kpw-ui': '', role: 'note', dataset: { level: res.level } },
            el('div', { className: 'kpw-warn-head' },
                el('span', {}, high ? '⚠ Vorsicht, mögliche Betrugsmasche' : 'Hinweis'),
                el('button', {
                    type: 'button', title: 'Diese Warnung bis zum Neuladen ausblenden',
                    onclick: () => { dismissed.add(text); unmark(block); },
                }, 'Ausblenden')),
            el('ul', {}, res.hits.map(h => el('li', {}, h.label))),
            high ? el('p', {}, 'Öffne keine Links, um Geld zu „erhalten“, und gib keine Kartendaten oder Codes heraus. '
                + 'Prüfe Zahlungen nur direkt in deinem Kleinanzeigen-Konto.') : null);
        return badge;
    }

    function unmark(block) {
        const s = state.get(block);
        if (s && s.badge) s.badge.remove();
        block.removeAttribute('data-kpw-warn');
        state.set(block, { text: s ? s.text : null, badge: null });
    }

    function checkBlock(block) {
        const text = block.textContent.replace(/\s+/g, ' ').trim();
        const s = state.get(block);
        if (s && s.text === text && (!s.badge || s.badge.isConnected)) return;
        if (s) unmark(block);
        state.set(block, { text, badge: null });
        if (text.length < CONFIG.minLength || text.length > CONFIG.maxLength || dismissed.has(text)) return;

        const res = KPW_REGELN.check(text);
        if (!res.level || (res.level === 'hinweis' && !settings.hints)) return;
        const badge = badgeFor(res, text, block);
        block.setAttribute('data-kpw-warn', res.level);
        block.after(badge);
        state.set(block, { text, badge });
    }

    function root() {
        for (const sel of CONFIG.rootSelectors) {
            const node = document.querySelector(sel);
            if (node) return node;
        }
        return document.body;
    }

    function scan() {
        if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
        findBlocks(root()).forEach(checkBlock);
    }

    function rescanAll() {
        document.querySelectorAll('[data-kpw-warn]').forEach(unmark);
        document.querySelectorAll('.kpw-warn').forEach(n => n.remove());
        state = new WeakMap();
        scan();
    }

    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, CONFIG.scanDelayMs); };

    // Nachrichten werden nachgeladen; eigene Änderungen lösen keine neue Prüfung aus
    const oursEl = (n) => n.nodeType === 1 && isOurs(n);
    const onlyOurs = (r) => oursEl(r.target)
        || r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute('data-kpw-ui'));
    new MutationObserver((records) => {
        if (!records.every(onlyOurs)) schedule();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    KS.onRemoteChange(CONFIG.keys.settings, () => { settings = loadSettings(); rescanAll(); });
    scan();

    // ------------------------------------------------------------------
    // Einstellungen
    // ------------------------------------------------------------------

    KS.addSettings('warnung', () => [
        el('h3', {}, 'Betrugswarnung'),
        KS.checkbox('Auch gelbe Hinweise zeigen (z. B. „möchte per WhatsApp weiterschreiben“, Links auf fremde Seiten)', settings.hints, (on) => {
            settings = { ...settings, hints: on };
            save(CONFIG.keys.settings, settings);
            rescanAll();
        }),
        el('p', { className: 'ks-hint' }, 'Rot markiert sind Nachrichten mit hohem Risiko: nachgemachte Bezahl- oder Versandseiten, Fragen nach Kartendaten oder SMS-Codes, Überzahlung. '
            + 'Die Prüfung läuft nur in deinem Browser. Sie erkennt nicht jede Masche, und auch harmlose Nachrichten können markiert werden.'),
    ]);
})();
