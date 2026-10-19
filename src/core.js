/*
 * Kleinanzeigen – PowerSeller
 * ---------------------------
 * Hilfen für Vielverkäufer auf Kleinanzeigen.de, für private und PRO-Konten. Jedes Modul
 * lässt sich einzeln abschalten (Tampermonkey-Menü → „PowerSeller: Einstellungen“).
 *
 * Module:
 *   - Bausteine ........... src/bausteine.js
 *   - Betrugswarnung ...... src/warnung.js (Regeln in src/regeln.js)
 *   - Meine Anzeigen ...... src/anzeigen.js
 *   - Verkaufsbuch ........ src/verkaufsbuch.js
 *   - Interessenten ....... src/interessenten.js
 *
 * Kern und Module sind wie beim Superscript aufgebaut (gleiche KS-Schnittstelle), damit die
 * Module später auch dort laufen können. Gespeichert wird unter eigenen Schlüsseln (kpw-…).
 *
 * powerseller.user.js wird mit `node build.js` aus src/ erzeugt. Änderungen bitte in den
 * Quelldateien vornehmen, nicht in powerseller.user.js.
 */

(function () {
    'use strict';

    const VERSION = '@@VERSION@@';

    // Läuft auf den Seiten unter /m-… (Nachrichten, Meine Anzeigen) und beim Einstellen und
    // Bearbeiten von Anzeigen (siehe @match).
    // Nur auf kleinanzeigen.de laufen – zusätzlich zu @match, falls der Script-Manager
    // die Header ignoriert oder das Script manuell mit breiteren Regeln eingebunden wird.
    if (window.location.protocol !== 'https:' || window.location.hostname !== 'www.kleinanzeigen.de') return;
    if (window.top !== window.self) return;

    // Doppelt installiert? Dann arbeitet nur die zuerst gestartete Kopie.
    const docRoot = document.documentElement;
    if (docRoot.hasAttribute('data-kpw')) {
        console.warn('[PowerSeller] Script läuft bereits, diese Kopie bleibt inaktiv.');
        return;
    }
    docRoot.setAttribute('data-kpw', VERSION);

    // ------------------------------------------------------------------
    // Kern: Speicher, Helfer, Module, Einstellungen
    // ------------------------------------------------------------------

    const KS = (() => {
        const MODULES_KEY = 'kpw-modules'; // { <Modul-ID>: false } = abgeschaltet

        const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

        // Speicher des Userscript-Managers, sonst localStorage
        const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

        function load(key, def) {
            try {
                if (hasGM) {
                    const v = GM_getValue(key);
                    return v === undefined ? def : v;
                }
                const raw = localStorage.getItem(key);
                return raw == null ? def : JSON.parse(raw);
            } catch (e) {
                return def;
            }
        }

        function save(key, value) {
            try {
                if (hasGM) GM_setValue(key, value);
                else localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        }

        // Ruft fn auf, wenn ein anderer Tab den Wert unter key ändert
        function onRemoteChange(key, fn) {
            if (hasGM && typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(key, (name, oldValue, newValue, remote) => { if (remote) fn(); });
            } else if (!hasGM) {
                window.addEventListener('storage', e => { if (e.key === key) fn(); });
            }
        }

        function el(tag, props = {}, ...children) {
            const node = document.createElement(tag);
            for (const [k, v] of Object.entries(props)) {
                if (v == null || v === false) continue;
                if (k === 'dataset') Object.assign(node.dataset, v);
                else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
                else if (k in node && k !== 'list') node[k] = v;
                else node.setAttribute(k, v === true ? '' : v);
            }
            children.flat().forEach(c => c != null && c !== false && node.append(c));
            return node;
        }

        // Wie replaceChildren, lässt aber null/false weg (replaceChildren schriebe „null“)
        function setChildren(node, ...children) {
            node.replaceChildren(...children.flat().filter(c => c != null && c !== false));
            return node;
        }

        // Adresse einer Suche ohne Seitenzahl, damit Seite 2, 3 … zur selben Suche gehören:
        // /s-seite:2/…, /…/seite:2/…, ?pageNum=2. Parameter sortiert.
        function searchKey(href) {
            const url = new URL(href, window.location.origin);
            const p = url.pathname.replace(/\/s-seite:\d+\//, '/s-').replace(/\/seite:\d+(?=\/|$)/, '');
            const params = Array.from(url.searchParams)
                .filter(([k]) => !/^(pagenum|page|seite)$/i.test(k))
                .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
            return p + (params.length ? '?' + new URLSearchParams(params).toString() : '');
        }

        // Bausteine für Einstellungs-Abschnitte der Module
        const checkbox = (text, checked, onChange) => el('label', { className: 'ks-check' },
            el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
            el('span', {}, text));
        const radio = (name, text, checked, onChange) => el('label', { className: 'ks-check' },
            el('input', { type: 'radio', name, checked, onchange: () => onChange() }),
            el('span', {}, text));

        // --- Module

        const modules = [];        // { id, label, description, version, source, status }
        const sections = {};       // <Modul-ID> -> () => Node[] (Einstellungs-Abschnitt)

        const disabledMap = () => {
            const raw = load(MODULES_KEY, {});
            return isObj(raw) ? raw : {};
        };
        const isEnabled = (id) => disabledMap()[id] !== false;

        // Startet ein Modul, sofern es eingeschaltet ist. guard: Attribut am <html>, das die
        // Einzel-Version des Scripts setzt – ist es schon da, läuft das Script bereits separat.
        function module(id, meta, fn) {
            const m = { id, ...meta, status: 'off' };
            modules.push(m);
            if (!isEnabled(id)) return;
            if (meta.guard && docRoot.hasAttribute(meta.guard)) {
                m.status = 'external';
                return;
            }
            try {
                fn();
                m.status = 'on';
            } catch (e) {
                m.status = 'error';
                console.error(`[PowerSeller] Modul „${meta.label}“ ist mit einem Fehler abgebrochen:`, e);
            }
        }

        function setEnabled(id, on) {
            const map = disabledMap();
            if (on) delete map[id]; else map[id] = false;
            save(MODULES_KEY, map);
        }

        const addSettings = (id, render) => { sections[id] = render; };

        // --- Styles

        const styleEl = document.createElement('style');
        styleEl.textContent = `
            .ks-overlay {
                position: fixed; inset: 0; z-index: 2147483200; background: rgba(0,0,0,.4);
                display: grid; place-items: center; padding: 16px;
            }
            .ks-panel {
                box-sizing: border-box; width: min(600px, 100%); max-height: calc(100vh - 32px); overflow: auto;
                background: #fff; color: #1e1e1e; border: 1px solid #d0d0cc; border-radius: 12px;
                box-shadow: 0 12px 32px rgba(0,0,0,.22); font: inherit; font-size: 14px; line-height: 1.4; text-align: left;
            }
            .ks-panel *, .ks-panel *::before, .ks-panel *::after { box-sizing: border-box; }
            .ks-panel button, .ks-panel input, .ks-panel textarea, .ks-panel select { font: inherit; font-size: 14px; color: inherit; }
            .ks-input {
                width: 100%; padding: 6px 8px; border: 1px solid #c9c7c2; border-radius: 6px; background: #fff;
            }
            .ks-input:focus { border-color: #1e1e1e; outline: none; }
            textarea.ks-input { min-height: 64px; resize: vertical; line-height: 1.4; }
            .ks-head {
                position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px;
                padding: 10px 10px 10px 14px; background: #fff; border-bottom: 1px solid #eceae6;
            }
            .ks-title { flex: 1; min-width: 0; font-weight: 700; }
            .ks-icon-btn {
                flex: none; width: 32px; height: 32px; display: inline-grid; place-items: center;
                border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 18px; line-height: 1;
            }
            .ks-icon-btn:hover, .ks-icon-btn:focus-visible { background: #f2f1ee; outline: none; }
            .ks-body { padding: 12px 14px 14px; display: grid; gap: 12px; }
            .ks-section { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid #eceae6; }
            .ks-section:first-of-type { padding-top: 0; border-top: 0; }
            .ks-section h3 { margin: 0; font-size: 15px; font-weight: 700; }
            .ks-module { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid #e3e1dc; border-radius: 8px; }
            .ks-check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; cursor: pointer; }
            .ks-check input { margin: 2px 0 0; accent-color: #1e1e1e; flex: none; }
            .ks-module > .ks-check { font-size: 14px; font-weight: 600; }
            .ks-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
            .ks-spacer { flex: 1; }
            .ks-hint, .ks-muted { margin: 0; font-size: 12px; color: #6b6b6b; }
            .ks-module .ks-muted { padding-left: 24px; }
            .ks-status[data-status="external"], .ks-status[data-status="error"] { color: #8a4b00; }
            .ks-note { margin: 0; padding: 8px 10px; border-radius: 8px; background: #f2f1ee; font-size: 13px; }
            .ks-note[data-kind="ok"] { background: #edf7ee; color: #1f5e23; }
            .ks-note[data-kind="error"] { background: #fdecea; color: #8e1c1c; }
            .ks-action {
                padding: 7px 14px; border-radius: 999px; border: 1px solid #c9c7c2; background: #fff;
                font-weight: 600; cursor: pointer; white-space: nowrap;
            }
            .ks-action:hover:not(:disabled), .ks-action:focus-visible { border-color: #1e1e1e; outline: none; }
            .ks-action[data-primary] { background: #1e1e1e; border-color: #1e1e1e; color: #fff; }
            .ks-action[data-danger]:hover:not(:disabled) { border-color: #c62828; color: #c62828; }
            .ks-action:disabled { opacity: .45; cursor: not-allowed; }
        `;
        const ensureStyles = () => { if (!styleEl.isConnected) (document.head || docRoot).appendChild(styleEl); };

        // --- Darstellung: „rainbow“ (Akzente im Regenbogen wie der Install-Button) oder „standard“.
        // Die Module schreiben ihre Akzente als :root[data-kpw-theme="rainbow"] … und nutzen
        // die Verläufe --kpw-rainbow (waagerecht) und --kpw-rainbow-v (senkrecht).

        const THEME_KEY = 'kpw-theme';
        const THEMES = { rainbow: 'Regenbogen', standard: 'Standard' };
        const theme = () => { const t = load(THEME_KEY, 'rainbow'); return Object.hasOwn(THEMES, t) ? t : 'rainbow'; };
        const applyTheme = () => docRoot.setAttribute('data-kpw-theme', theme());
        applyTheme();
        onRemoteChange(THEME_KEY, applyTheme);
        const colors = '#e53935, #fb8c00, #fdd835, #43a047, #1e88e5, #8e24aa';
        const themeStyle = el('style', { 'data-kpw-ui': '' }, `
            :root { --kpw-rainbow: linear-gradient(90deg, ${colors}); --kpw-rainbow-v: linear-gradient(180deg, ${colors}); }
            :root[data-kpw-theme="rainbow"] .ks-panel .ks-head { background: var(--kpw-rainbow) bottom / 100% 3px no-repeat, #fff; }
            .kpw-remind {
                position: fixed; left: 16px; bottom: 16px; z-index: 2147483100; max-width: min(460px, calc(100vw - 32px));
                display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 10px;
                background: #fff; color: #1e1e1e; border: 1px solid #d0d0cc; box-shadow: 0 8px 24px rgba(0,0,0,.18);
                font: 13px/1.4 system-ui, sans-serif;
            }
            .kpw-remind span { flex: 1 1 220px; }
            .kpw-remind button {
                padding: 5px 12px; border: 1px solid #c9c7c2; border-radius: 999px; background: #fff; color: #1e1e1e;
                font: 600 13px/1.3 system-ui, sans-serif; cursor: pointer;
            }
            .kpw-remind button[data-primary] { background: #1e1e1e; border-color: #1e1e1e; color: #fff; }
            :root[data-kpw-theme="rainbow"] .kpw-remind { border: 2px solid transparent; background: linear-gradient(#fff, #fff) padding-box, var(--kpw-rainbow) border-box; }
            .kpw-restore { display: grid; gap: 6px; background: #f2f1ee; }
            .kpw-restore table { border-collapse: collapse; font-size: 13px; }
            .kpw-restore th, .kpw-restore td { padding: 2px 12px 2px 0; text-align: right; font-weight: 400; }
            .kpw-restore th:first-child, .kpw-restore td:first-child { text-align: left; }
            .kpw-restore thead th { color: #6b6b6b; }
        `);
        (document.head || docRoot).appendChild(themeStyle);

        // --- Einstellungen (Dialog)

        // --- Datensicherung: alle Daten des PowerSellers als eine Datei, Import mit Vorschau,
        // Erinnerung nach 30 Tagen ohne Sicherung (nur wenn es etwas zu sichern gibt)

        const BACKUP = {
            key: 'kpw-backup',              // { last, since, snooze } (Zeitstempel)
            format: 'kleinanzeigen-powerseller-backup',
            // Alle Speicherschlüssel der Module. Neue Schlüssel hier ergänzen.
            keys: ['kpw-bausteine', 'kpw-bausteine-v', 'kpw-felder', 'kpw-warnung', 'kpw-anzeigen', 'kpw-anzeigen-settings',
                'kpw-verkaeufe', 'kpw-verkaufsbuch', 'kpw-interessenten', 'kpw-interessenten-titel', 'kpw-theme', MODULES_KEY],
            remindDays: 30,
            snoozeDays: 7,
        };
        const DAY = 24 * 60 * 60 * 1000;
        const pad2 = (n) => String(n).padStart(2, '0');
        const dateOf = (ts) => { const d = new Date(ts); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };
        const backupState = () => { const v = load(BACKUP.key, {}); return isObj(v) ? v : {}; };
        const setBackupState = (patch) => save(BACKUP.key, { ...backupState(), ...patch });
        if (!backupState().since) setBackupState({ since: Date.now() });

        function download(name, content, type) {
            const url = URL.createObjectURL(new Blob([content], { type }));
            const a = el('a', { href: url, download: name });
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        // Was steckt in den Daten? Für Vorschau und „gibt es etwas zu sichern?“
        function summarize(data) {
            const len = (v) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);
            const ads = isObj(data['kpw-anzeigen']) ? Object.values(data['kpw-anzeigen']).filter(isObj) : [];
            const people = isObj(data['kpw-interessenten']) ? Object.values(data['kpw-interessenten']).reduce((a, l) => a + len(l), 0) : 0;
            return {
                'Bausteine': len(data['kpw-bausteine']),
                'Anzeigen mit Verlauf': ads.length,
                'Notizen zu Anzeigen': ads.filter(a => typeof a.note === 'string' && a.note).length,
                'Verkäufe': len(data['kpw-verkaeufe']),
                'Interessenten': people,
            };
        }

        function currentData() {
            const data = {};
            for (const key of BACKUP.keys) {
                const v = load(key, undefined);
                if (v !== undefined) data[key] = v;
            }
            return data;
        }

        function exportBackup() {
            const now = new Date();
            const file = { format: BACKUP.format, version: VERSION, created: now.toISOString(), data: currentData() };
            download(`powerseller-sicherung-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}.json`,
                JSON.stringify(file, null, 2), 'application/json');
            setBackupState({ last: Date.now(), snooze: 0 });
            hideReminder();
            if (panel) renderSettings();
        }

        // Datei lesen und prüfen; Ergebnis: { data, created } oder { error }
        function readBackup(textContent) {
            let file;
            try { file = JSON.parse(textContent); } catch (e) { return { error: 'Die Datei ist kein gültiges JSON.' }; }
            if (!isObj(file) || file.format !== BACKUP.format || !isObj(file.data)) {
                return { error: 'Das ist keine Sicherung des PowerSellers.' };
            }
            const data = {};
            for (const key of BACKUP.keys) if (Object.hasOwn(file.data, key)) data[key] = file.data[key];
            return { data, created: typeof file.created === 'string' ? Date.parse(file.created) || 0 : 0 };
        }

        function importBackup(data) {
            for (const [key, value] of Object.entries(data)) save(key, value);
        }

        // Erinnerung unten links
        let reminder = null;
        function hideReminder() { if (reminder) { reminder.remove(); reminder = null; } }
        function maybeRemind() {
            if (window.location.pathname.startsWith('/p-anzeige-')) return;     // nicht beim Einstellen stören
            const st = backupState();
            const now = Date.now();
            const ref = Math.max(st.last || 0, st.since || now);
            if (now - ref < BACKUP.remindDays * DAY || now < (st.snooze || 0)) return;
            const s = summarize(currentData());
            if (!s['Verkäufe'] && !s['Interessenten'] && !s['Notizen zu Anzeigen'] && !s['Anzeigen mit Verlauf']) return;
            const days = Math.floor((now - ref) / DAY);
            reminder = el('div', { className: 'kpw-remind', 'data-kpw-ui': '', role: 'status' },
                el('span', {}, st.last ? `PowerSeller: Deine letzte Datensicherung ist ${days} Tage her.` : 'PowerSeller: Deine Daten sind noch nicht gesichert.'),
                el('button', { type: 'button', dataset: { primary: '' }, onclick: exportBackup }, 'Jetzt sichern'),
                el('button', {
                    type: 'button',
                    onclick: () => { setBackupState({ snooze: Date.now() + BACKUP.snoozeDays * DAY }); hideReminder(); },
                }, 'Später'));
            document.body.appendChild(reminder);
        }

        let panel = null; // { overlay, box, changed, cleanup, restore }

        function closeSettings() {
            if (!panel) return;
            panel.cleanup();
            panel.overlay.remove();
            panel = null;
        }

        function openSettings() {
            closeSettings();
            ensureStyles();
            const box = el('div', { className: 'ks-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'PowerSeller-Einstellungen' });
            const overlay = el('div', { className: 'ks-overlay' }, box);
            overlay.addEventListener('pointerdown', e => { if (e.target === overlay) closeSettings(); });
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSettings(); } };
            document.addEventListener('keydown', onKey, true);
            panel = { overlay, box, changed: false, cleanup: () => document.removeEventListener('keydown', onKey, true) };
            document.body.appendChild(overlay);
            renderSettings();
            const first = box.querySelector('input');
            if (first) first.focus();
        }

        const statusText = {
            on: 'aktiv',
            off: 'ausgeschaltet',
            external: 'pausiert: das Script ist zusätzlich einzeln installiert und läuft bereits',
            error: 'mit einem Fehler abgebrochen (Details in der Browser-Konsole)',
        };

        function renderSettings() {
            if (!panel) return;
            const { box } = panel;
            const scrollTop = box.scrollTop;

            const moduleRows = modules.map(m => el('div', { className: 'ks-module' },
                checkbox(`${m.label} ${m.version}`, isEnabled(m.id), (on) => {
                    setEnabled(m.id, on);
                    panel.changed = true;
                    renderSettings();
                }),
                el('span', { className: 'ks-muted' }, m.description),
                el('span', { className: 'ks-muted ks-status', dataset: { status: m.status } },
                    `Status: ${statusText[m.status] || m.status}`, m.source ? ' · ' : '',
                    m.source ? el('a', { href: m.source, target: '_blank', rel: 'noopener' }, 'einzeln installieren') : null)));

            const moduleSections = modules
                .filter(m => m.status === 'on' && sections[m.id])
                .map(m => el('section', { className: 'ks-section' }, sections[m.id]()));

            box.replaceChildren(
                el('div', { className: 'ks-head' },
                    el('span', { className: 'ks-title' }, 'PowerSeller'),
                    el('button', { type: 'button', className: 'ks-icon-btn', 'aria-label': 'Schließen', title: 'Schließen', onclick: closeSettings }, '×')),
                el('div', { className: 'ks-body' },
                    el('section', { className: 'ks-section' },
                        el('h3', {}, 'Module'),
                        moduleRows,
                        panel.changed ? el('div', { className: 'ks-note ks-row', dataset: { kind: 'ok' } },
                            el('span', { className: 'ks-spacer' }, 'Gilt nach dem Neuladen der Seite.'),
                            el('button', { type: 'button', className: 'ks-action', onclick: () => window.location.reload() }, 'Seite neu laden')) : null),
                    el('section', { className: 'ks-section' },
                        el('h3', {}, 'Darstellung'),
                        el('div', { className: 'ks-row' }, Object.entries(THEMES).map(([id, label]) => radio('kpw-theme', label, theme() === id, () => {
                            save(THEME_KEY, id);
                            applyTheme();
                        }))),
                        el('p', { className: 'ks-hint' }, 'Regenbogen: Buttons, Boxen und Dialoge des PowerSellers mit farbigem Rand, damit man sie von Kleinanzeigen unterscheidet. '
                            + 'Warnungen bleiben rot und gelb.')),
                    backupSection(),
                    moduleSections,
                    el('p', { className: 'ks-hint' }, `PowerSeller ${VERSION} · Alles wird nur lokal in deinem Browser gespeichert · `,
                        el('a', { href: '@@REPO@@', target: '_blank', rel: 'noopener' }, 'Projektseite'))));
            box.scrollTop = scrollTop;
        }

        function backupSection() {
            const st = backupState();
            const r = panel.restore; // { name, created, data, now } | { error } | { done }
            const fileInput = el('input', {
                type: 'file', accept: 'application/json,.json', style: 'display: none', dataset: { kpwRestore: '' },
                onchange: (e) => {
                    const f = e.target.files[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                        const res = readBackup(String(reader.result));
                        panel.restore = res.error ? res : { ...res, name: f.name };
                        renderSettings();
                    };
                    reader.readAsText(f);
                },
            });
            let preview = null;
            if (r && r.error) {
                preview = el('p', { className: 'ks-note', dataset: { kind: 'error' } }, r.error);
            } else if (r && r.done) {
                preview = el('div', { className: 'ks-note ks-row', dataset: { kind: 'ok' } },
                    el('span', { className: 'ks-spacer' }, 'Sicherung übernommen. Gilt nach dem Neuladen der Seite.'),
                    el('button', { type: 'button', className: 'ks-action', onclick: () => window.location.reload() }, 'Seite neu laden'));
            } else if (r) {
                const next = summarize(r.data);
                const now = summarize(currentData());
                preview = el('div', { className: 'ks-note kpw-restore' },
                    el('strong', {}, `${r.name}${r.created ? ` vom ${dateOf(r.created)}` : ''}`),
                    el('table', {},
                        el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'in der Datei'), el('th', {}, 'jetzt'))),
                        el('tbody', {}, Object.keys(next).map(k => el('tr', {}, el('td', {}, k), el('td', {}, String(next[k])), el('td', {}, String(now[k])))))),
                    el('p', { className: 'ks-hint' }, 'Übernehmen ersetzt deine jetzigen Daten durch die aus der Datei. Was in der Datei fehlt, bleibt unverändert.'),
                    el('div', { className: 'ks-row' },
                        el('button', {
                            type: 'button', className: 'ks-action', dataset: { primary: '' },
                            onclick: () => { importBackup(r.data); panel.restore = { done: true }; renderSettings(); },
                        }, 'Übernehmen'),
                        el('button', { type: 'button', className: 'ks-action', onclick: () => { panel.restore = null; renderSettings(); } }, 'Abbrechen')));
            }
            return el('section', { className: 'ks-section' },
                el('h3', {}, 'Datensicherung'),
                el('p', { className: 'ks-hint' }, 'Alle Daten des PowerSellers (Bausteine, Verlauf, Notizen, Interessenten, Verkaufsbuch, Einstellungen) liegen nur in diesem Browser. '
                    + `Eine Sicherung ist eine einzelne Datei, z. B. für einen neuen Rechner. Letzte Sicherung: ${st.last ? dateOf(st.last) : 'noch nie'}.`),
                el('div', { className: 'ks-row' },
                    el('button', { type: 'button', className: 'ks-action', dataset: { primary: '' }, onclick: exportBackup }, 'Sicherung herunterladen'),
                    el('button', { type: 'button', className: 'ks-action', onclick: () => fileInput.click() }, 'Sicherung einspielen …'),
                    fileInput),
                preview);
        }

        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('PowerSeller: Einstellungen', openSettings);
        }

        // Erinnerung erst, wenn die Module ihre Daten hatten (die Seite ist dann fertig)
        setTimeout(maybeRemind, 3000);

        return { VERSION, isObj, load, save, onRemoteChange, el, setChildren, checkbox, radio, searchKey, module, addSettings, openSettings, closeSettings, ensureStyles, download };
    })();

    // ------------------------------------------------------------------
    // Module
    // ------------------------------------------------------------------

/* @@MODULES@@ */
})();
