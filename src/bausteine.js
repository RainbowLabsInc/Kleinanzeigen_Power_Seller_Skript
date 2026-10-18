/*
 * Modul: Antwort-Bausteine
 * ------------------------
 * Sobald ein Nachrichtenfeld (Textfeld oder bearbeitbarer Bereich) den Fokus hat, sitzt
 * darüber ein kleiner Button „Bausteine“. Ein Klick zeigt die eigenen Antworten; ein Klick
 * auf eine davon (oder die Ziffer 1 … 9) fügt sie an der Schreibmarke ein.
 *
 * - Platzhalter in geschweiften Klammern, z. B. {Abholort}, werden durch die eigenen
 *   Angaben ersetzt. Fehlt eine Angabe, bleibt der Platzhalter stehen und ist markiert,
 *   sodass man ihn direkt überschreiben kann.
 * - Bausteine und Angaben bearbeiten, sortieren, exportieren und importieren in den
 *   Einstellungen (Tampermonkey-Menü → „PowerSeller: Einstellungen“).
 * - Das Feld wird nicht über feste Selektoren gesucht, sondern über den Fokus. Darum klappt
 *   es auch, wenn Kleinanzeigen den Aufbau der Nachrichtenseite ändert.
 */

(function () {
    'use strict';

    const CONFIG = {
        keys: {
            items: 'kpw-bausteine',     // [{ id, name, text }]
            fields: 'kpw-felder',       // [{ key, value }]
        },
        max: 60,
        nameMax: 40,
        textMax: 4000,
        fieldsMax: 20,
        // Beispiele beim ersten Start (und bei „Auf Beispiele zurücksetzen“)
        defaultItems: [
            ['Noch da', 'Hallo, ja, der Artikel ist noch zu haben. Abholung in {Abholort} nach Absprache.'],
            ['Preis fest', 'Hallo, danke für dein Interesse. Der Preis ist leider fest.'],
            ['Versand', 'Versand ist möglich, als {Versand}. Die Versandkosten kommen zum Preis dazu.'],
            ['Abholung', 'Gern. Wann würde es dir passen? Abholung in {Abholort}.'],
            ['Reserviert', 'Der Artikel ist im Moment reserviert. Ich melde mich, falls er wieder frei wird.'],
            ['Verkauft', 'Tut mir leid, der Artikel ist schon verkauft.'],
        ],
        defaultFields: [
            ['Abholort', ''],
            ['Versand', 'versichertes DHL-Paket'],
        ],
    };

    const { el, load, save, isObj } = KS;

    // ------------------------------------------------------------------
    // Daten
    // ------------------------------------------------------------------

    const newId = () => Math.random().toString(36).slice(2, 10);
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

    const defaultItems = () => CONFIG.defaultItems.map(([name, text]) => ({ id: newId(), name, text }));
    const defaultFields = () => CONFIG.defaultFields.map(([key, value]) => ({ key, value }));

    function cleanItems(raw) {
        if (!Array.isArray(raw)) return null;
        return raw.filter(isObj).slice(0, CONFIG.max).map(x => ({
            id: typeof x.id === 'string' && x.id ? x.id : newId(),
            name: str(x.name, CONFIG.nameMax),
            text: str(x.text, CONFIG.textMax),
        }));
    }

    function cleanFields(raw) {
        if (!Array.isArray(raw)) return null;
        return raw.filter(isObj).slice(0, CONFIG.fieldsMax).map(x => ({
            key: str(x.key, CONFIG.nameMax).replace(/[{}]/g, ''),
            value: str(x.value, 400),
        }));
    }

    function loadItems() {
        const items = cleanItems(load(CONFIG.keys.items, null));
        return items || defaultItems();
    }
    const loadFields = () => cleanFields(load(CONFIG.keys.fields, null)) || defaultFields();
    const saveItems = (items) => save(CONFIG.keys.items, items);
    const saveFields = (fields) => save(CONFIG.keys.fields, fields);

    // {Platzhalter} durch eigene Angaben ersetzen (Groß-/Kleinschreibung egal). Unbekannte
    // oder leere bleiben stehen.
    function fill(text, fields) {
        const map = new Map(fields.filter(f => f.key.trim() && f.value.trim()).map(f => [f.key.trim().toLowerCase(), f.value.trim()]));
        return text.replace(/\{([^{}\n]{1,40})\}/g, (m, k) => map.get(k.trim().toLowerCase()) || m);
    }

    // ------------------------------------------------------------------
    // Einfügen
    // ------------------------------------------------------------------

    const isOurs = (node) => !!(node && node.closest && node.closest('[data-kpw-ui], .ks-overlay'));

    function isField(node) {
        if (!node || isOurs(node)) return false;
        if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly;
        return node instanceof HTMLElement && node.isContentEditable;
    }

    function insert(field, raw) {
        const text = fill(raw, loadFields());
        field.focus();
        if (field instanceof HTMLTextAreaElement) {
            const start = field.selectionStart ?? field.value.length;
            const before = field.value.slice(0, start);
            const piece = (before && !/\s$/.test(before) ? ' ' : '') + text;
            let ok = false;
            // insertText löst ein echtes input-Ereignis aus (wichtig für React-Felder) und
            // lässt sich mit Strg+Z rückgängig machen
            try { ok = document.execCommand('insertText', false, piece); } catch (e) { ok = false; }
            if (!ok || field.value.slice(start, start + piece.length) !== piece) {
                const end = field.selectionEnd ?? start;
                const next = before + piece + field.value.slice(end);
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                setter.call(field, next);
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.setSelectionRange(start + piece.length, start + piece.length);
            }
            // Ersten offenen Platzhalter markieren, damit man ihn gleich überschreibt
            const m = piece.match(/\{[^{}\n]{1,40}\}/);
            if (m) field.setSelectionRange(start + m.index, start + m.index + m[0].length);
        } else {
            try { document.execCommand('insertText', false, text); } catch (e) { /* nichts */ }
        }
    }

    // ------------------------------------------------------------------
    // Button und Auswahl am Nachrichtenfeld
    // ------------------------------------------------------------------

    const style = el('style', { 'data-kpw-ui': '' }, `
        .kpw-bs-btn {
            position: fixed; z-index: 2147483000; display: none; padding: 4px 10px;
            border: 1px solid #c9c7c2; border-radius: 999px; background: #fff; color: #1e1e1e;
            font: 600 12px/1.3 system-ui, sans-serif; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.12);
        }
        .kpw-bs-btn:hover, .kpw-bs-btn[aria-expanded="true"] { border-color: #1e1e1e; }
        .kpw-bs-pop {
            position: fixed; z-index: 2147483001; display: none; width: min(360px, calc(100vw - 16px));
            max-height: min(60vh, 420px); overflow: auto; padding: 6px; box-sizing: border-box;
            background: #fff; color: #1e1e1e; border: 1px solid #d0d0cc; border-radius: 10px;
            box-shadow: 0 10px 28px rgba(0,0,0,.2); font: 13px/1.35 system-ui, sans-serif; text-align: left;
        }
        .kpw-bs-item {
            display: grid; grid-template-columns: 18px 1fr; gap: 2px 8px; width: 100%; padding: 6px 8px;
            border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
        }
        .kpw-bs-item:hover, .kpw-bs-item:focus-visible { background: #f2f1ee; outline: none; }
        .kpw-bs-key { grid-row: span 2; color: #6b6b6b; font-weight: 600; }
        .kpw-bs-name { font-weight: 600; }
        .kpw-bs-text { color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kpw-bs-foot { display: flex; justify-content: space-between; gap: 8px; padding: 6px 8px 2px; border-top: 1px solid #eceae6; margin-top: 4px; }
        .kpw-bs-foot button { border: 0; background: none; padding: 0; color: #1e1e1e; font: inherit; text-decoration: underline; cursor: pointer; }
        .kpw-bs-empty { padding: 6px 8px; color: #6b6b6b; }
    `);

    const btn = el('button', {
        type: 'button', className: 'kpw-bs-btn', 'data-kpw-ui': '', 'aria-haspopup': 'true', 'aria-expanded': 'false',
        title: 'Antwort-Bausteine einfügen', textContent: 'Bausteine',
    });
    const pop = el('div', { className: 'kpw-bs-pop', 'data-kpw-ui': '', role: 'menu', 'aria-label': 'Antwort-Bausteine' });

    let field = null;       // aktuelles Nachrichtenfeld
    let open = false;
    let items = [];

    function mount() {
        if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
        if (!btn.isConnected) document.body.append(btn, pop);
    }

    function place() {
        if (!field || !field.isConnected) return hide();
        const r = field.getBoundingClientRect();
        if (!r.width && !r.height) return hide();
        btn.style.display = 'block';
        const bw = btn.offsetWidth, bh = btn.offsetHeight;
        const above = r.top - bh - 4;
        btn.style.top = `${above >= 4 ? above : Math.min(r.bottom + 4, window.innerHeight - bh - 4)}px`;
        btn.style.left = `${Math.max(4, Math.min(r.right - bw, window.innerWidth - bw - 4))}px`;
        if (open) placePop();
    }

    function placePop() {
        const b = btn.getBoundingClientRect();
        pop.style.display = 'block';
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        const top = b.top - ph - 6 >= 4 ? b.top - ph - 6 : Math.min(b.bottom + 6, window.innerHeight - ph - 4);
        pop.style.top = `${Math.max(4, top)}px`;
        pop.style.left = `${Math.max(4, Math.min(b.right - pw, window.innerWidth - pw - 4))}px`;
    }

    function hide() {
        closePop();
        btn.style.display = 'none';
        field = null;
    }

    function choose(i) {
        const item = items[i];
        const target = field;
        closePop();
        if (item && target) insert(target, item.text);
    }

    function openPop() {
        items = loadItems().filter(x => x.text.trim());
        pop.replaceChildren(
            ...(items.length
                ? items.map((x, i) => el('button', {
                    type: 'button', className: 'kpw-bs-item', role: 'menuitem', title: x.text,
                    onclick: () => choose(i),
                },
                    el('span', { className: 'kpw-bs-key' }, i < 9 ? String(i + 1) : ''),
                    el('span', { className: 'kpw-bs-name' }, x.name || 'Ohne Namen'),
                    el('span', { className: 'kpw-bs-text' }, x.text)))
                : [el('div', { className: 'kpw-bs-empty' }, 'Noch keine Bausteine.')]),
            el('div', { className: 'kpw-bs-foot' },
                el('span', { style: 'color: #6b6b6b' }, items.length ? '1 … 9 zum Einfügen, Esc schließt' : ''),
                el('button', { type: 'button', onclick: () => { closePop(); KS.openSettings(); } }, 'Bearbeiten …')));
        open = true;
        btn.setAttribute('aria-expanded', 'true');
        placePop();
    }

    function closePop() {
        open = false;
        btn.setAttribute('aria-expanded', 'false');
        pop.style.display = 'none';
    }

    // Fokus bleibt im Nachrichtenfeld, damit an der Schreibmarke eingefügt wird
    [btn, pop].forEach(n => n.addEventListener('mousedown', e => e.preventDefault()));
    btn.addEventListener('click', () => (open ? closePop() : openPop()));

    document.addEventListener('focusin', (e) => {
        const t = e.target;
        if (isOurs(t)) return;
        if (isField(t)) {
            if (field !== t) closePop();
            field = t;
            mount();
            place();
        } else {
            hide();
        }
    }, true);

    document.addEventListener('focusout', (e) => {
        if (e.target !== field) return;
        // Kurz warten: der Fokus kann in die eigene Auswahl wandern
        setTimeout(() => {
            const a = document.activeElement;
            if (a !== field && !isOurs(a)) hide();
        }, 150);
    }, true);

    document.addEventListener('keydown', (e) => {
        if (!open) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closePop();
        } else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const i = Number(e.key) - 1;
            if (i < items.length) {
                e.preventDefault();
                e.stopPropagation();
                choose(i);
            }
        } else if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) {
            closePop();
        }
    }, true);

    window.addEventListener('scroll', () => field && place(), true);
    window.addEventListener('resize', () => field && place());
    // Nachrichtenfelder wachsen beim Tippen: Button mitführen
    document.addEventListener('input', (e) => { if (e.target === field) place(); }, true);

    // Feld hatte schon beim Start den Fokus
    if (isField(document.activeElement)) {
        field = document.activeElement;
        mount();
        place();
    }

    // ------------------------------------------------------------------
    // Einstellungen
    // ------------------------------------------------------------------

    function download(name, data) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = el('a', { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    KS.addSettings('bausteine', () => {
        let list = loadItems();
        let fields = loadFields();
        const box = el('div', { className: 'ks-body', style: 'padding: 0' });
        let note = null; // { kind, text }

        let timer = 0;
        const persist = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { saveItems(list); saveFields(fields); }, 250);
        };
        const persistNow = () => { clearTimeout(timer); saveItems(list); saveFields(fields); };

        const move = (arr, i, d) => {
            const j = i + d;
            if (j < 0 || j >= arr.length) return;
            [arr[i], arr[j]] = [arr[j], arr[i]];
            persistNow();
            render();
        };
        const iconBtn = (label, text, onclick, disabled) => el('button', {
            type: 'button', className: 'ks-icon-btn', 'aria-label': label, title: label, onclick, disabled,
        }, text);

        function importFile(file) {
            const reader = new FileReader();
            reader.onload = () => {
                let data = null;
                try { data = JSON.parse(String(reader.result)); } catch (e) { data = null; }
                const nextItems = isObj(data) ? cleanItems(data.bausteine) : null;
                const nextFields = isObj(data) ? cleanFields(data.felder) : null;
                if (!nextItems) {
                    note = { kind: 'error', text: 'Die Datei enthält keine Bausteine (erwartet: Export aus dem PowerSeller).' };
                } else if (window.confirm(`${nextItems.length} Bausteine importieren? Deine bisherigen Bausteine werden ersetzt.`)) {
                    list = nextItems;
                    if (nextFields) fields = nextFields;
                    persistNow();
                    note = { kind: 'ok', text: `${nextItems.length} Bausteine importiert.` };
                }
                render();
            };
            reader.readAsText(file);
        }

        function render() {
            const rows = list.map((x, i) => el('div', { className: 'ks-module' },
                el('div', { className: 'ks-row' },
                    el('input', {
                        className: 'ks-input', style: 'flex: 1; width: auto', value: x.name, maxLength: CONFIG.nameMax,
                        placeholder: 'Name', 'aria-label': `Name von Baustein ${i + 1}`,
                        oninput: (e) => { x.name = e.target.value; persist(); },
                    }),
                    iconBtn('Nach oben', '↑', () => move(list, i, -1), i === 0),
                    iconBtn('Nach unten', '↓', () => move(list, i, 1), i === list.length - 1),
                    iconBtn('Löschen', '🗑', () => {
                        if (x.text.trim() && !window.confirm(`Baustein „${x.name || 'Ohne Namen'}“ löschen?`)) return;
                        list.splice(i, 1);
                        persistNow();
                        render();
                    })),
                el('textarea', {
                    className: 'ks-input', value: x.text, maxLength: CONFIG.textMax, rows: 3,
                    'aria-label': `Text von Baustein ${i + 1}`,
                    oninput: (e) => { x.text = e.target.value; persist(); },
                })));

            const fieldRows = fields.map((f, i) => el('div', { className: 'ks-row' },
                el('input', {
                    className: 'ks-input', style: 'width: 9em', value: f.key, maxLength: CONFIG.nameMax, placeholder: 'Platzhalter',
                    'aria-label': `Platzhalter ${i + 1}`,
                    oninput: (e) => { f.key = e.target.value.replace(/[{}]/g, ''); persist(); },
                }),
                el('input', {
                    className: 'ks-input', style: 'flex: 1; width: auto', value: f.value, maxLength: 400, placeholder: 'wird eingesetzt als …',
                    'aria-label': `Wert für Platzhalter ${i + 1}`,
                    oninput: (e) => { f.value = e.target.value; persist(); },
                }),
                iconBtn('Löschen', '🗑', () => { fields.splice(i, 1); persistNow(); render(); })));

            const fileInput = el('input', {
                type: 'file', accept: 'application/json,.json', style: 'display: none',
                onchange: (e) => { if (e.target.files[0]) importFile(e.target.files[0]); },
            });

            box.replaceChildren(
                el('h3', {}, 'Antwort-Bausteine'),
                el('p', { className: 'ks-hint' }, 'Erscheinen über dem Nachrichtenfeld unter „Bausteine“. '
                    + 'Platzhalter wie {Abholort} werden durch deine Angaben unten ersetzt. Fehlt eine Angabe, bleibt der Platzhalter stehen und ist markiert.'),
                ...rows,
                el('div', { className: 'ks-row' },
                    el('button', {
                        type: 'button', className: 'ks-action', disabled: list.length >= CONFIG.max,
                        onclick: () => { list.push({ id: newId(), name: '', text: '' }); persistNow(); render(); [...box.querySelectorAll('.ks-module input')].pop()?.focus(); },
                    }, '+ Neuer Baustein'),
                    el('span', { className: 'ks-spacer' }),
                    el('button', { type: 'button', className: 'ks-action', onclick: () => download('powerseller-bausteine.json', { bausteine: list, felder: fields }) }, 'Exportieren'),
                    el('button', { type: 'button', className: 'ks-action', onclick: () => fileInput.click() }, 'Importieren …'),
                    fileInput),
                el('h3', {}, 'Deine Angaben für Platzhalter'),
                ...fieldRows,
                el('div', { className: 'ks-row' },
                    el('button', {
                        type: 'button', className: 'ks-action', disabled: fields.length >= CONFIG.fieldsMax,
                        onclick: () => { fields.push({ key: '', value: '' }); persistNow(); render(); },
                    }, '+ Angabe'),
                    el('span', { className: 'ks-spacer' }),
                    el('button', {
                        type: 'button', className: 'ks-action', dataset: { danger: '' },
                        onclick: () => {
                            if (!window.confirm('Alle Bausteine und Angaben auf die Beispiele zurücksetzen?')) return;
                            list = defaultItems();
                            fields = defaultFields();
                            persistNow();
                            note = { kind: 'ok', text: 'Auf die Beispiele zurückgesetzt.' };
                            render();
                        },
                    }, 'Auf Beispiele zurücksetzen')),
                note ? el('p', { className: 'ks-note', dataset: { kind: note.kind } }, note.text) : null);
            note = null;
        }

        render();
        return [box];
    });
})();
