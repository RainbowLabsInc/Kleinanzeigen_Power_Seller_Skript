// ==UserScript==
// @name          Kleinanzeigen - PowerSeller
// @namespace     https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript
// @description   Hilfen für Vielverkäufer auf Kleinanzeigen.de, privat und PRO: Bausteine für Nachrichten und Anzeigentexte, Warnung vor typischen Betrugsmaschen, Besucher-Verlauf, Notizen, Warteliste für Interessenten und Verkaufsbuch. Alles lokal, jedes Modul einzeln abschaltbar.
// @author        RainbowlabsInc
// @copyright     2026, RainbowlabsInc
// @license       MIT
// @version       0.5.0
// @icon          https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/main/assets/icon48.png
// @homepage      https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript
// @updateURL     https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/main/powerseller.user.js
// @downloadURL   https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/main/powerseller.user.js
// @match         https://www.kleinanzeigen.de/m-*
// @match         https://www.kleinanzeigen.de/p-anzeige-aufgeben*
// @match         https://www.kleinanzeigen.de/p-anzeige-bearbeiten*
// @grant         GM_getValue
// @grant         GM_setValue
// @grant         GM_addValueChangeListener
// @grant         GM_registerMenuCommand
// @noframes
// @run-at        document-idle
// ==/UserScript==

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

    const VERSION = '0.5.0';

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
                        el('a', { href: 'https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript', target: '_blank', rel: 'noopener' }, 'Projektseite'))));
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

// ========================================================================
// Helfer: src/regeln.js
// ========================================================================
/*
 * Regeln für die Betrugswarnung
 * -----------------------------
 * Prüft einen Nachrichtentext auf typische Maschen, mit denen Verkäufer auf Kleinanzeigen
 * hereingelegt werden: gefälschte Bezahl- oder Versandseiten, „Geld freigeben“, Kurier-
 * Abholung, Fragen nach Karten- oder SMS-Codes, Überzahlung.
 *
 * Reine Textprüfung ohne Seitenzugriff, damit sie sich mit `node test/regeln.test.js`
 * testen lässt. Ergebnis: { level: 'hoch' | 'hinweis' | null, hits: [{ id, level, label }] }
 */

const KPW_REGELN = (() => {
    // Kleinbuchstaben, Umlaute ausgeschrieben, Leerraum zusammengefasst. Die Muster unten
    // sind in dieser Schreibweise formuliert.
    function normalize(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const RULES = [
        {
            id: 'karte', level: 'hoch',
            label: 'Fragt nach Kartendaten oder Bankzugang',
            re: /\b(kartendaten|kreditkarten?(daten|nummer)?|kartennummer|cvc|cvv|pruefnummer|sicherheitscode|online-?banking|zugangsdaten)\b/,
        },
        {
            id: 'code', level: 'hoch',
            label: 'Fragt nach einem Code aus SMS oder App',
            re: /\b(sms-?code|bestaetigungscode|verifizierungscode|verifikationscode|einmalcode|freigabecode)\b|\bcode\b[^.!?]{0,40}\b(schick|send|nenn|mitteil|weiterleit|gib)|\b(schick|send|nenn|mitteil|weiterleit|gib)\w*\b[^.!?]{0,40}\bcode\b/,
        },
        {
            id: 'geld', level: 'hinweis',
            label: 'Spricht davon, Geld zu „erhalten“ oder „freizugeben“',
            re: /um (das|ihr|dein|euer) geld zu (erhalten|empfangen|bekommen)|zahlung (zu )?(empfangen|bestaetigen|freigeben|freischalten|annehmen)|geld (zu )?(empfangen|freigeben|freischalten|annehmen)|auszahlung (zu )?(erhalten|bestaetigen|anfordern|freigeben)|\b(bestaetig|freigeb|freischalt)\w* (die |deine |ihre |eure )?(zahlung|ueberweisung|auszahlung)/,
        },
        {
            id: 'kurier', level: 'hinweis',
            label: 'Abholung durch Kurier oder Spedition',
            re: /\b(kurier\w*|spedition\w*|transportunternehmen|transportfirma|umzugsfirma|logistikunternehmen|abholdienst|(mein|meinen) fahrer)\b/,
        },
        {
            id: 'ueberzahlung', level: 'hoch',
            label: 'Überzahlung oder Rücküberweisung',
            re: /zu viel (ueberwiesen|bezahlt|gezahlt|geschickt)|ueberzahl\w*|differenz (zurueck|ueberweisen|erstatten)|restbetrag (zurueck|ueberweisen|erstatten)/,
        },
        {
            id: 'extern', level: 'hinweis',
            label: 'Möchte außerhalb von Kleinanzeigen weiterschreiben',
            re: /\b(whats ?app|telegram|viber)\b|\b(deine|ihre|eure) (e-?mail(-?adresse)?|handynummer|telefonnummer|nummer)\b/,
        },
    ];

    // Adressen im Text, auch ohne http:// (z. B. „dhl-paket.info/abc“)
    const URL_RE = /\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,62})*\.(?:de|com|net|org|info|eu|io|co|me|app|link|site|online|shop|top|xyz|ru|cc|biz|live|store|club|pw)(?:\/[^\s<>"']*)?)/g;

    // Echte Kleinanzeigen-Adressen werden nicht gemeldet
    const OWN = /(^|\.)kleinanzeigen\.de$/;
    // Echte Adressen bekannter Dienste: nur Hinweis, keine Warnung
    const OFFICIAL = /(^|\.)(dhl\.de|dhl\.com|paypal\.com|paypal\.de|hermesworld\.com|myhermes\.de|dpd\.com|dpd\.de|gls-pakete\.de|gls-group\.com|ups\.com|deutschepost\.de|ebay\.de|ebay\.com)$/;
    // Klingt nach Kleinanzeigen, Versand oder Bezahlen, ist es aber nicht: typische Fälschung
    const LURE = /kleinanzeig|ebay|dhl|hermes|dpd|gls|ups|paypal|post|paket|versand|liefer|sicher|safe|secure|pay|zahlung|bezahl|kaeufer|verkaeufer|deal|transaktion|treuhand/;

    function hostOf(raw) {
        const s = raw.replace(/[),.;:!?]+$/, '');
        try {
            return new URL(/^https?:\/\//.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, '');
        } catch (e) {
            return null;
        }
    }

    function linkHits(norm) {
        const hits = [];
        const seen = new Set();
        for (const m of norm.match(URL_RE) || []) {
            const host = hostOf(m);
            if (!host || seen.has(host) || OWN.test(host)) continue;
            seen.add(host);
            if (OFFICIAL.test(host)) {
                hits.push({ id: 'link', level: 'hinweis', label: `Link auf ${host}: lieber selbst über die bekannte Seite öffnen` });
            } else if (host.startsWith('xn--') || host.includes('.xn--') || LURE.test(host)) {
                hits.push({ id: 'link', level: 'hoch', label: `Link auf ${host}: sieht nach einer nachgemachten Bezahl- oder Versandseite aus` });
            } else {
                hits.push({ id: 'link', level: 'hinweis', label: `Link auf eine fremde Seite (${host})` });
            }
        }
        return hits;
    }

    function check(text) {
        const norm = normalize(text);
        if (!norm) return { level: null, hits: [] };
        const hits = RULES.filter(r => r.re.test(norm)).map(({ id, level, label }) => ({ id, level, label }));
        const links = linkHits(norm);
        hits.push(...links);
        let level = hits.some(h => h.level === 'hoch') ? 'hoch' : hits.length ? 'hinweis' : null;
        // Fremder Link plus eine weitere Auffälligkeit: das typische Muster der Maschen
        if (level === 'hinweis' && links.length && hits.length > links.length) level = 'hoch';
        return { level, hits };
    }

    return { normalize, check, RULES };
})();

// ========================================================================
// Modul „Bausteine“: src/bausteine.js
// ========================================================================
KS.module("bausteine", {"label":"Bausteine","version":"0.5.0","description":"Button „Bausteine“ am Nachrichtenfeld und an der Beschreibung beim Einstellen: eigene Texte mit Platzhaltern per Klick einfügen."}, function () {
/*
 * Modul: Bausteine
 * ----------------
 * Sobald ein Textfeld den Fokus hat (Nachricht oder Beschreibung beim Einstellen und
 * Bearbeiten einer Anzeige), sitzt darüber ein kleiner Button „Bausteine“. Ein Klick zeigt
 * die eigenen Texte für diese Seite; ein Klick auf einen davon (oder die Ziffer 1 … 9) fügt
 * ihn an der Schreibmarke ein.
 *
 * - Jeder Baustein gilt für Nachrichten, für Anzeigentexte oder für beides.
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
            items: 'kpw-bausteine',     // [{ id, name, text, wo: 'nachricht' | 'anzeige' | 'beide' }]
            fields: 'kpw-felder',       // [{ key, value }]
            version: 'kpw-bausteine-v', // 2: Beispiele für Anzeigentexte ergänzt
        },
        version: 2,
        max: 60,
        nameMax: 40,
        textMax: 4000,
        fieldsMax: 20,
        // Beispiele beim ersten Start (und bei „Auf Beispiele zurücksetzen“)
        defaultItems: [
            ['Noch da', 'Hallo {Name}, ja, der Artikel ist noch zu haben. Abholung in {Abholort} nach Absprache.', 'nachricht'],
            ['Preis fest', 'Hallo {Name}, danke für dein Interesse. Der Preis von {Preis} ist leider fest.', 'nachricht'],
            ['Versand', 'Versand ist möglich, als {Versand}. Die Versandkosten kommen zum Preis dazu.', 'nachricht'],
            ['Abholung', 'Gern. Wann würde es dir passen? Abholung in {Abholort}.', 'nachricht'],
            ['Reserviert', 'Der Artikel ist im Moment reserviert. Ich melde mich, falls er wieder frei wird.', 'nachricht'],
            ['Verkauft', 'Tut mir leid, der Artikel ist schon verkauft.', 'nachricht'],
            ['Privatverkauf', 'Privatverkauf, daher keine Garantie, Gewährleistung oder Rücknahme.', 'anzeige'],
            ['Versand & Abholung', 'Abholung in {Abholort}. Versand als {Versand} gegen Aufpreis möglich.', 'anzeige'],
        ],
        places: { nachricht: 'Nachrichten', anzeige: 'Anzeigentexte', beide: 'Beides' },
        // Angaben aus der Seite (Stand 10/2026)
        page: {
            conversation: '[data-testid="conversation-wrapper"]',
            adLinkRe: /\/(?:zur-anzeige\/|s-anzeige\/(?:[^/?#]+\/)?)(\d{6,})/,
            adsKey: 'kpw-anzeigen',
            titleInput: 'input[name="title"]',
            priceInput: 'input[name="priceAmount"]',
        },
        defaultFields: [
            ['Abholort', ''],
            ['Versand', 'versichertes DHL-Paket'],
        ],
    };

    const { el, setChildren, load, save, isObj } = KS;

    // ------------------------------------------------------------------
    // Daten
    // ------------------------------------------------------------------

    const newId = () => Math.random().toString(36).slice(2, 10);
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

    const defaultItems = () => CONFIG.defaultItems.map(([name, text, wo]) => ({ id: newId(), name, text, wo }));

    // Welche Bausteine hier passen: beim Einstellen und Bearbeiten Anzeigentexte, sonst Nachrichten
    const KIND = window.location.pathname.startsWith('/p-anzeige-') ? 'anzeige' : 'nachricht';
    const defaultFields = () => CONFIG.defaultFields.map(([key, value]) => ({ key, value }));

    function cleanItems(raw) {
        if (!Array.isArray(raw)) return null;
        return raw.filter(isObj).slice(0, CONFIG.max).map(x => ({
            id: typeof x.id === 'string' && x.id ? x.id : newId(),
            name: str(x.name, CONFIG.nameMax),
            text: str(x.text, CONFIG.textMax),
            wo: Object.hasOwn(CONFIG.places, x.wo) ? x.wo : 'nachricht',
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
        if (!items) return defaultItems();
        // Gespeicherte Listen aus 0.1 einmalig um die Beispiele für Anzeigentexte ergänzen
        if (load(CONFIG.keys.version, 1) < CONFIG.version) {
            const names = new Set(items.map(x => x.name));
            defaultItems().filter(x => x.wo === 'anzeige' && !names.has(x.name)).forEach(x => items.push(x));
            save(CONFIG.keys.items, items.slice(0, CONFIG.max));
            save(CONFIG.keys.version, CONFIG.version);
        }
        return items;
    }
    const loadFields = () => cleanFields(load(CONFIG.keys.fields, null)) || defaultFields();
    const saveItems = (items) => { save(CONFIG.keys.items, items); save(CONFIG.keys.version, CONFIG.version); };
    const saveFields = (fields) => save(CONFIG.keys.fields, fields);

    // Angaben aus der Seite: {Name}, {Titel}, {Preis}. In einer Unterhaltung Name des Gegenübers
    // („Über Kai“) und Titel der Anzeige aus dem Kopf, der Preis aus „Meine Anzeigen“ (falls die
    // Anzeige dort schon einmal zu sehen war). Beim Einstellen Titel und Preis aus dem Formular.
    const textOf = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
    function pageFields() {
        const out = {};
        if (KIND === 'anzeige') {
            out.titel = (document.querySelector(CONFIG.page.titleInput) || {}).value || '';
            const p = ((document.querySelector(CONFIG.page.priceInput) || {}).value || '').trim();
            out.preis = /^\d[\d.,]*$/.test(p) ? `${p} €` : p;
        } else {
            const wrap = document.querySelector(CONFIG.page.conversation);
            if (!wrap) return out;
            for (const node of wrap.querySelectorAll('div, span')) {
                if (node.children.length || node.closest('a, .sr-only, [data-kpw-ui]')) continue;
                const m = textOf(node).match(/^Über (.{1,40})$/);
                if (m) { out.name = m[1]; break; }
            }
            const link = [...wrap.querySelectorAll('a[href]')].find(a => textOf(a) && CONFIG.page.adLinkRe.test(a.getAttribute('href')));
            if (link) {
                out.titel = textOf(link);
                const ads = load(CONFIG.page.adsKey, {});
                const ad = isObj(ads) ? ads[link.getAttribute('href').match(CONFIG.page.adLinkRe)[1]] : null;
                if (isObj(ad) && typeof ad.price === 'string') out.preis = ad.price;
            }
        }
        return out;
    }

    // {Platzhalter} ersetzen (Groß-/Kleinschreibung egal): erst Angaben aus der Seite, dann die
    // eigenen. Unbekannte oder leere bleiben stehen.
    function fill(text, fields, fromPage = {}) {
        const map = new Map(fields.filter(f => f.key.trim() && f.value.trim()).map(f => [f.key.trim().toLowerCase(), f.value.trim()]));
        for (const [k, v] of Object.entries(fromPage)) if (v && v.trim()) map.set(k, v.trim());
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
        const text = fill(raw, loadFields(), pageFields());
        field.focus();
        if (field instanceof HTMLTextAreaElement) {
            const start = field.selectionStart ?? field.value.length;
            const before = field.value.slice(0, start);
            // Anzeigentexte als eigener Absatz, Nachrichten mit Leerzeichen anhängen
            const sep = !before || /\s$/.test(before) ? '' : KIND === 'anzeige' ? '\n\n' : ' ';
            const piece = sep + text;
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
        :root[data-kpw-theme="rainbow"] .kpw-bs-btn {
            border: 2px solid transparent; color: #fff;
            background: linear-gradient(#141418, #141418) padding-box, var(--kpw-rainbow) border-box;
        }
        :root[data-kpw-theme="rainbow"] .kpw-bs-btn:hover, :root[data-kpw-theme="rainbow"] .kpw-bs-btn[aria-expanded="true"] {
            background: linear-gradient(#2a2a30, #2a2a30) padding-box, var(--kpw-rainbow) border-box;
        }
        :root[data-kpw-theme="rainbow"] .kpw-bs-pop { padding-top: 9px; background: var(--kpw-rainbow) top / 100% 3px no-repeat, #fff; }
    `);

    const btn = el('button', {
        type: 'button', className: 'kpw-bs-btn', 'data-kpw-ui': '', 'aria-haspopup': 'true', 'aria-expanded': 'false',
        title: 'Bausteine einfügen', textContent: 'Bausteine',
    });
    const pop = el('div', { className: 'kpw-bs-pop', 'data-kpw-ui': '', role: 'menu', 'aria-label': 'Bausteine' });

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
        items = loadItems().filter(x => x.text.trim() && (x.wo === KIND || x.wo === 'beide'));
        setChildren(pop,
            ...(items.length
                ? items.map((x, i) => el('button', {
                    type: 'button', className: 'kpw-bs-item', role: 'menuitem', title: x.text,
                    onclick: () => choose(i),
                },
                    el('span', { className: 'kpw-bs-key' }, i < 9 ? String(i + 1) : ''),
                    el('span', { className: 'kpw-bs-name' }, x.name || 'Ohne Namen'),
                    el('span', { className: 'kpw-bs-text' }, x.text)))
                : [el('div', { className: 'kpw-bs-empty' }, KIND === 'anzeige' ? 'Noch keine Bausteine für Anzeigentexte.' : 'Noch keine Bausteine für Nachrichten.')]),
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
                    el('select', {
                        className: 'ks-input', style: 'width: auto', 'aria-label': `Wo Baustein ${i + 1} erscheint`,
                        title: 'Wo der Baustein erscheint',
                        onchange: (e) => { x.wo = e.target.value; persistNow(); },
                    }, Object.entries(CONFIG.places).map(([v, t]) => el('option', { value: v, selected: x.wo === v }, t))),
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

            setChildren(box,
                el('h3', {}, 'Bausteine'),
                el('p', { className: 'ks-hint' }, 'Erscheinen über dem Nachrichtenfeld und über der Beschreibung beim Einstellen einer Anzeige unter „Bausteine“. '
                    + 'Platzhalter wie {Abholort} werden durch deine Angaben unten ersetzt. Fehlt eine Angabe, bleibt der Platzhalter stehen und ist markiert. '
                    + 'Automatisch gefüllt werden {Name} (dein Gegenüber in der Unterhaltung), {Titel} und {Preis} (der Anzeige).'),
                ...rows,
                el('div', { className: 'ks-row' },
                    el('button', {
                        type: 'button', className: 'ks-action', disabled: list.length >= CONFIG.max,
                        onclick: () => { list.push({ id: newId(), name: '', text: '', wo: KIND }); persistNow(); render(); [...box.querySelectorAll('.ks-module input')].pop()?.focus(); },
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
});

// ========================================================================
// Modul „Betrugswarnung“: src/warnung.js
// ========================================================================
KS.module("warnung", {"label":"Betrugswarnung","version":"0.5.0","description":"Markiert Nachrichten mit typischen Maschen: falsche Bezahl- und Versandlinks, „Geld freigeben“, Kurier, Codes, Überzahlung."}, function () {
/*
 * Modul: Betrugswarnung
 * ---------------------
 * Liest die Nachrichten auf der Nachrichtenseite und markiert solche mit typischen Maschen
 * gegen Verkäufer (Regeln in src/regeln.js): rot bei hohem Risiko, gelb als Hinweis.
 * Unter der Nachricht steht, was aufgefallen ist.
 *
 * - Nur Lesen: Es wird nichts nachgeladen und nichts weggeschickt.
 * - Geprüft werden nur Nachrichten des Gegenübers ([data-testid="INBOUND"]), nicht die
 *   eigenen und nicht die Hinweise von Kleinanzeigen.
 * - Findet sich keine solche Unterhaltung (Kleinanzeigen hat den Aufbau geändert), werden
 *   ersatzweise die kleinsten Textblöcke der Seite geprüft. Dann können auch eigene
 *   Nachrichten markiert werden.
 */

(function () {
    'use strict';

    const CONFIG = {
        keys: { settings: 'kpw-warnung' },
        defaultSettings: { hints: true },   // auch gelbe Hinweise zeigen
        // Nur auf diesen Seiten prüfen (Pfad)
        paths: [/^\/m-nachrichten/],
        // Stand 10/2026 (gespeicherte Seite „Meine Nachrichten“): Unterhaltung und Nachrichten des Gegenübers
        conversationSelector: '[data-testid="conversation-wrapper"]',
        inboundSelector: '[data-testid="INBOUND"]',
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
        .kpw-warn ul { margin: 4px 0 0; padding-left: 18px; list-style: disc; }
        .kpw-warn p { margin: 6px 0 0; }
        /* Kleinanzeigen setzt eigene Größen für p, li und div: hier gleich groß halten */
        .kpw-warn, .kpw-warn * { font-family: system-ui, sans-serif !important; font-size: 13px !important; line-height: 1.4 !important; }
        .kpw-warn { max-width: 520px !important; }
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
        const conversation = document.querySelector(CONFIG.conversationSelector);
        if (conversation) conversation.querySelectorAll(CONFIG.inboundSelector).forEach(checkBlock);
        else findBlocks(root()).forEach(checkBlock);
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
});

// ========================================================================
// Modul „Meine Anzeigen“: src/anzeigen.js
// ========================================================================
KS.module("anzeigen", {"label":"Meine Anzeigen","version":"0.5.0","description":"Verlauf von Besuchern und Merkern, Hinweis auf Ladenhüter, eigene Notiz pro Anzeige, Summen über der Liste."}, function () {
/*
 * Modul: Meine Anzeigen
 * ---------------------
 * Ergänzt die Seite „Meine Anzeigen“ um einen Verlauf von Besuchern und Merkern und um eine
 * eigene Notiz pro Anzeige.
 *
 * - Bei jedem Aufruf der Seite werden „N Besucher“ und „N mal gemerkt“ jeder Anzeige
 *   gemerkt, ein Stand pro Tag. Darunter steht, was seit dem letzten Stand vor heute dazu-
 *   gekommen ist, z. B. „+12 Besucher, +1 gemerkt seit 15.10.“. Ein Klick zeigt den Verlauf.
 * - Ladenhüter: Gab es seit mindestens 7 Tagen keine neuen Besucher, steht ein Hinweis da.
 * - Notiz pro Anzeige (Lagerort, Artikelnummer, Einkaufspreis …), nur lokal gespeichert.
 * - Über der Liste: Zahl der Anzeigen, Besucher, Merker und Summe der Preise auf dieser Seite.
 * - Export als CSV in den Einstellungen.
 *
 * Nur Lesen: Es wird nichts nachgeladen und nichts an Kleinanzeigen geschickt.
 */

(function () {
    'use strict';

    const CONFIG = {
        keys: {
            ads: 'kpw-anzeigen',            // { <adId>: { title, price, hist: [[Tag, Besucher, Merker]], note } }
            settings: 'kpw-anzeigen-settings',
        },
        defaultSettings: { stale: true },
        path: /^\/m-meine-anzeigen/,
        // Stand 10/2026 (gespeicherte Seite „Meine Anzeigen“, privates Konto)
        listSelector: '#my-manageitems-adlist',
        cardSelector: 'li[data-testid="ad-card"][data-adid]',
        imageSelector: 'img[data-testid="ad-image"]',
        featureSection: '#feature-offer-section',
        visitorsRe: /^([\d.]+)\s+Besucher$/,
        favoritesRe: /^([\d.]+)\s+mal\s+gemerkt$/,
        historyMax: 120,        // Tage pro Anzeige
        adsMax: 3000,
        staleDays: 7,
        noteMax: 300,
        scanDelayMs: 300,
    };

    if (!CONFIG.path.test(window.location.pathname)) return;

    const { el, setChildren, load, save, isObj } = KS;

    // ------------------------------------------------------------------
    // Helfer
    // ------------------------------------------------------------------

    const pad = (n) => String(n).padStart(2, '0');
    const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = () => dayOf(new Date());
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayOf(d); };
    const shortDate = (day) => { const [, m, d] = day.split('-'); return `${Number(d)}.${Number(m)}.`; };
    const fmt = (n) => n.toLocaleString('de-DE');
    const plus = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
    const text = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');

    function loadAds() {
        const raw = load(CONFIG.keys.ads, {});
        return isObj(raw) ? raw : {};
    }
    const loadSettings = () => {
        const raw = load(CONFIG.keys.settings, {});
        return { ...CONFIG.defaultSettings, ...(isObj(raw) ? raw : {}) };
    };
    let settings = loadSettings();

    // „1.250 € VB“ -> 1250, sonst null (VB ohne Betrag, Zu verschenken …)
    function priceValue(p) {
        const m = String(p || '').match(/(\d[\d.]*)(?:,(\d{1,2}))?\s*€/);
        return m ? Number(m[1].replace(/\./g, '')) + (m[2] ? Number(m[2]) / 100 : 0) : null;
    }

    // ------------------------------------------------------------------
    // Anzeigen lesen
    // ------------------------------------------------------------------

    function readCard(card) {
        const id = card.getAttribute('data-adid');
        if (!/^\d+$/.test(id || '')) return null;
        let visitors = null, favorites = null, statsNode = null;
        for (const li of card.querySelectorAll('li')) {
            if (li.closest('[data-kpw-ui]')) continue;
            const t = text(li);
            let m;
            if ((m = t.match(CONFIG.visitorsRe))) { visitors = Number(m[1].replace(/\./g, '')); statsNode = li; }
            else if ((m = t.match(CONFIG.favoritesRe))) favorites = Number(m[1].replace(/\./g, ''));
        }
        const img = card.querySelector(CONFIG.imageSelector);
        const h3 = card.querySelector('h3');
        // Titel: Bild-Beschreibung, sonst letzter Text der Überschrift (davor steht der Status)
        const title = (img && img.getAttribute('alt')) || (h3 && text(h3.querySelector('span:last-of-type'))) || text(h3);
        // Preis: erstes Listenelement mit €, nicht in den Angeboten fürs Hochschieben
        let price = '';
        for (const li of card.querySelectorAll('ul.list > li, li')) {
            if (li.closest(CONFIG.featureSection) || li.closest('[data-kpw-ui]')) continue;
            const t = text(li);
            if (/€|VB|verschenken/i.test(t) && t.length < 40) { price = t; break; }
        }
        // „Bald Online“: noch nicht sichtbar, also kein Ladenhüter
        const pending = /bald online/i.test(text(h3));
        return { id, title: title.slice(0, 120), price, visitors, favorites, statsNode, pending };
    }

    // Stand von heute eintragen. Gibt true zurück, wenn sich etwas geändert hat.
    function record(ads, info) {
        const day = today();
        const ad = isObj(ads[info.id]) ? ads[info.id] : (ads[info.id] = { hist: [] });
        let changed = ad.title !== info.title || ad.price !== info.price;
        ad.title = info.title;
        ad.price = info.price;
        if (!Array.isArray(ad.hist)) ad.hist = [];
        if (info.visitors !== null) {
            const last = ad.hist[ad.hist.length - 1];
            const entry = [day, info.visitors, info.favorites ?? 0];
            if (last && last[0] === day) {
                if (last[1] !== entry[1] || last[2] !== entry[2]) { ad.hist[ad.hist.length - 1] = entry; changed = true; }
            } else {
                ad.hist.push(entry);
                if (ad.hist.length > CONFIG.historyMax) ad.hist.splice(0, ad.hist.length - CONFIG.historyMax);
                changed = true;
            }
        }
        ad.seen = day;
        return changed;
    }

    // Letzter Stand vor heute, Ladenhüter-Prüfung
    function compare(ad, info) {
        const hist = Array.isArray(ad.hist) ? ad.hist : [];
        const day = today();
        const prev = [...hist].reverse().find(h => h[0] < day) || null;
        const limit = daysAgo(CONFIG.staleDays);
        const old = [...hist].reverse().find(h => h[0] <= limit) || null;
        return {
            prev,
            dv: prev && info.visitors !== null ? info.visitors - prev[1] : null,
            df: prev && info.favorites !== null ? info.favorites - prev[2] : null,
            stale: !!(old && !info.pending && info.visitors !== null && info.visitors === old[1]),
            since: old ? old[0] : null,
        };
    }

    // Damit nicht zu viele Anzeigen gespeichert werden: die am längsten nicht mehr gesehenen fallen heraus
    function prune(ads) {
        const ids = Object.keys(ads);
        if (ids.length <= CONFIG.adsMax) return;
        const seen = (id) => String(isObj(ads[id]) && ads[id].seen || '');
        ids.sort((a, b) => seen(a).localeCompare(seen(b)));
        ids.slice(0, ids.length - CONFIG.adsMax).forEach(id => { if (!isObj(ads[id]) || !ads[id].note) delete ads[id]; });
    }

    // ------------------------------------------------------------------
    // Darstellung
    // ------------------------------------------------------------------

    const style = el('style', { 'data-kpw-ui': '' }, `
        .kpw-ma { margin: 6px 0 0; display: grid; gap: 4px; font: 13px/1.4 system-ui, sans-serif; color: #3d3d3d; text-align: left; }
        .kpw-ma button { border: 0; background: none; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; }
        .kpw-ma-delta { justify-self: start; text-decoration: underline dotted; text-underline-offset: 3px; }
        .kpw-ma-delta[data-up] { color: #1f6f2b; font-weight: 600; }
        .kpw-ma-stale { padding: 4px 8px; border-radius: 6px; background: #fff3d6; color: #6a4a00; }
        .kpw-ma-hist { border-collapse: collapse; font-size: 12px; }
        .kpw-ma-hist th, .kpw-ma-hist td { padding: 1px 10px 1px 0; text-align: right; font-weight: 400; }
        .kpw-ma-hist th:first-child, .kpw-ma-hist td:first-child { text-align: left; }
        .kpw-ma-hist thead th { color: #6b6b6b; }
        .kpw-ma-note { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
        .kpw-ma-note-text { padding: 2px 8px; border-radius: 6px; background: #eef4fb; color: #1d3a5c; white-space: pre-wrap; }
        .kpw-ma-link { text-decoration: underline; color: #1e1e1e !important; }
        .kpw-ma-edit { display: flex; gap: 6px; flex-wrap: wrap; }
        .kpw-ma-edit input { flex: 1; min-width: 160px; padding: 4px 8px; border: 1px solid #c9c7c2; border-radius: 6px; font: inherit; }
        .kpw-ma-edit button { padding: 4px 10px; border: 1px solid #c9c7c2 !important; border-radius: 999px; background: #fff !important; font-weight: 600; }
        .kpw-ma-sum {
            margin: 0 0 10px; padding: 8px 12px; border-radius: 8px; background: #f2f1ee;
            font: 13px/1.5 system-ui, sans-serif; color: #1e1e1e;
        }
        .kpw-ma-sum b { font-weight: 700; }
        .kpw-ma, .kpw-ma *, .kpw-ma-sum, .kpw-ma-sum * { font-family: system-ui, sans-serif !important; }
        :root[data-kpw-theme="rainbow"] .kpw-ma { padding-left: 10px; background: var(--kpw-rainbow-v) left / 3px 100% no-repeat; }
        :root[data-kpw-theme="rainbow"] .kpw-ma-sum {
            border: 2px solid transparent;
            background: linear-gradient(#f7f6f3, #f7f6f3) padding-box, var(--kpw-rainbow) border-box;
        }
    `);

    const openHist = new Set();     // Anzeigen mit aufgeklapptem Verlauf

    function histTable(ad) {
        const rows = (ad.hist || []).slice(-14).reverse();
        return el('table', { className: 'kpw-ma-hist' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Tag'), el('th', {}, 'Besucher'), el('th', {}, 'gemerkt'))),
            el('tbody', {}, rows.map(h => el('tr', {}, el('td', {}, shortDate(h[0])), el('td', {}, fmt(h[1])), el('td', {}, fmt(h[2]))))));
    }

    function editNote(box, id) {
        const ads = loadAds();
        const current = isObj(ads[id]) ? String(ads[id].note || '') : '';
        const input = el('input', { value: current, maxLength: CONFIG.noteMax, placeholder: 'z. B. Kiste B, Art.-Nr. 1042, EK 20 €', 'aria-label': 'Notiz zur Anzeige' });
        const done = (store) => {
            if (store) {
                const fresh = loadAds();
                if (!isObj(fresh[id])) fresh[id] = { hist: [] };
                fresh[id].note = input.value.trim().slice(0, CONFIG.noteMax);
                save(CONFIG.keys.ads, fresh);
            }
            delete box.dataset.editing;
            delete box.dataset.sig;
            scan();
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(true); }
            else if (e.key === 'Escape') { e.preventDefault(); done(false); }
        });
        box.dataset.editing = '1';
        const row = box.querySelector('.kpw-ma-note');
        row.replaceWith(el('div', { className: 'kpw-ma-edit' }, input,
            el('button', { type: 'button', onclick: () => done(true) }, 'Speichern'),
            el('button', { type: 'button', onclick: () => done(false) }, 'Abbrechen')));
        input.focus();
    }

    function render(box, info, ad) {
        const c = compare(ad, info);
        const note = String(ad.note || '');
        const sig = JSON.stringify([info.visitors, info.favorites, c.prev, c.stale, note, openHist.has(info.id), settings.stale]);
        if (box.dataset.sig === sig || box.dataset.editing) return;
        box.dataset.sig = sig;

        let deltaText;
        if (!c.prev) deltaText = 'Verlauf ab heute';
        else if (!c.dv && !c.df) deltaText = `Keine neuen Besucher seit ${shortDate(c.prev[0])}`;
        else deltaText = `${plus(c.dv || 0)} Besucher, ${plus(c.df || 0)} gemerkt seit ${shortDate(c.prev[0])}`;

        setChildren(box,
            el('button', {
                type: 'button', className: 'kpw-ma-delta', dataset: c.dv > 0 ? { up: '' } : {},
                title: 'Verlauf zeigen', 'aria-expanded': String(openHist.has(info.id)),
                onclick: () => { openHist.has(info.id) ? openHist.delete(info.id) : openHist.add(info.id); delete box.dataset.sig; scan(); },
            }, deltaText),
            openHist.has(info.id) ? histTable(ad) : null,
            settings.stale && c.stale ? el('div', { className: 'kpw-ma-stale' },
                `Seit dem ${shortDate(c.since)} keine neuen Besucher. Preis, Bilder oder Titel überarbeiten?`) : null,
            el('div', { className: 'kpw-ma-note' },
                note ? el('span', { className: 'kpw-ma-note-text' }, `📝 ${note}`) : null,
                el('button', { type: 'button', className: 'kpw-ma-link', onclick: () => editNote(box, info.id) }, note ? 'Notiz ändern' : '+ Notiz')));
    }

    function renderSummary(list, rows) {
        let box = list.previousElementSibling;
        if (!box || !box.classList.contains('kpw-ma-sum')) {
            box = el('div', { className: 'kpw-ma-sum', 'data-kpw-ui': '' });
            list.before(box);
        }
        const withStats = rows.filter(r => r.info.visitors !== null);
        const visitors = withStats.reduce((a, r) => a + r.info.visitors, 0);
        const favorites = withStats.reduce((a, r) => a + (r.info.favorites || 0), 0);
        const fresh = withStats.reduce((a, r) => a + Math.max(0, r.c.dv || 0), 0);
        const prices = rows.map(r => priceValue(r.info.price)).filter(v => v !== null);
        const total = prices.reduce((a, v) => a + v, 0);
        const stale = rows.filter(r => r.c.stale).length;
        const sig = JSON.stringify([rows.length, visitors, favorites, fresh, total, stale, settings.stale]);
        if (box.dataset.sig === sig) return;
        box.dataset.sig = sig;
        setChildren(box,
            el('b', {}, `${rows.length} ${rows.length === 1 ? 'Anzeige' : 'Anzeigen'} auf dieser Seite`),
            ` · ${fmt(visitors)} Besucher`, fresh ? ` (${plus(fresh)} neu)` : '',
            ` · ${fmt(favorites)} mal gemerkt`,
            prices.length ? ` · Summe der Preise ${total.toLocaleString('de-DE', { maximumFractionDigits: 2 })} €` : '',
            settings.stale && stale ? ` · ${stale} ohne neue Besucher seit ${CONFIG.staleDays} Tagen` : '');
    }

    // ------------------------------------------------------------------
    // Ablauf
    // ------------------------------------------------------------------

    function scan() {
        const list = document.querySelector(CONFIG.listSelector);
        const cards = [...document.querySelectorAll(CONFIG.cardSelector)];
        if (!cards.length) return;
        if (!style.isConnected) (document.head || document.documentElement).appendChild(style);

        const ads = loadAds();
        let changed = false;
        const rows = [];
        for (const card of cards) {
            const info = readCard(card);
            if (!info) continue;
            if (record(ads, info)) changed = true;
            const ad = ads[info.id];
            rows.push({ info, c: compare(ad, info) });

            let box = card.querySelector('.kpw-ma');
            if (!box) {
                box = el('div', { className: 'kpw-ma', 'data-kpw-ui': '' });
                const anchor = info.statsNode && (info.statsNode.closest('section') || info.statsNode.parentElement);
                if (anchor && anchor !== card) anchor.after(box);
                else (card.querySelector('h3')?.parentElement || card).appendChild(box);
            }
            render(box, info, ad);
        }
        if (changed) {
            prune(ads);
            save(CONFIG.keys.ads, ads);
        }
        if (list && rows.length) renderSummary(list, rows);
    }

    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, CONFIG.scanDelayMs); };
    const onlyOurs = (r) => (r.target.nodeType === 1 && r.target.closest('[data-kpw-ui]'))
        || r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute('data-kpw-ui'));
    new MutationObserver((records) => { if (!records.every(onlyOurs)) schedule(); })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
    KS.onRemoteChange(CONFIG.keys.ads, () => { document.querySelectorAll('.kpw-ma').forEach(b => delete b.dataset.sig); schedule(); });
    scan();

    // ------------------------------------------------------------------
    // Einstellungen
    // ------------------------------------------------------------------

    function csv() {
        const ads = loadAds();
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [['Anzeigen-Nr.', 'Titel', 'Preis', 'Besucher', 'gemerkt', 'Stand vom', 'erster Stand', 'Notiz'].map(q).join(';')];
        for (const [id, ad] of Object.entries(ads)) {
            if (!isObj(ad)) continue;
            const hist = Array.isArray(ad.hist) ? ad.hist : [];
            const last = hist[hist.length - 1] || [];
            lines.push([id, ad.title, ad.price, last[1], last[2], last[0], hist[0] ? hist[0][0] : '', ad.note].map(q).join(';'));
        }
        // BOM, damit Excel die Umlaute richtig liest
        const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        const a = el('a', { href: url, download: `meine-anzeigen-${today()}.csv` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    KS.addSettings('anzeigen', () => {
        const count = Object.keys(loadAds()).length;
        return [
            el('h3', {}, 'Meine Anzeigen'),
            KS.checkbox(`Hinweis, wenn eine Anzeige seit ${CONFIG.staleDays} Tagen keine neuen Besucher hat`, settings.stale, (on) => {
                settings = { ...settings, stale: on };
                save(CONFIG.keys.settings, settings);
                document.querySelectorAll('.kpw-ma, .kpw-ma-sum').forEach(b => delete b.dataset.sig);
                scan();
            }),
            el('p', { className: 'ks-hint' }, `Gespeichert: ${fmt(count)} ${count === 1 ? 'Anzeige' : 'Anzeigen'} mit Verlauf und Notizen, nur in deinem Browser. `
                + 'Ein Stand pro Tag, sobald du „Meine Anzeigen“ aufrufst. Erfasst werden nur die Anzeigen, die auf der aufgerufenen Seite stehen.'),
            el('div', { className: 'ks-row' },
                el('button', { type: 'button', className: 'ks-action', disabled: !count, onclick: csv }, 'Als CSV exportieren'),
                el('span', { className: 'ks-spacer' }),
                el('button', {
                    type: 'button', className: 'ks-action', dataset: { danger: '' }, disabled: !count,
                    onclick: (e) => {
                        if (!window.confirm('Verlauf und Notizen aller Anzeigen löschen?')) return;
                        save(CONFIG.keys.ads, {});
                        document.querySelectorAll('.kpw-ma, .kpw-ma-sum').forEach(b => b.remove());
                        e.target.disabled = true;
                        scan();
                    },
                }, 'Verlauf und Notizen löschen')),
        ];
    });
})();
});

// ========================================================================
// Modul „Verkaufsbuch“: src/verkaufsbuch.js
// ========================================================================
KS.module("verkaufsbuch", {"label":"Verkaufsbuch","version":"0.5.0","description":"„Verkauft …“ an jeder Anzeige: Endpreis, Zahlungsart, Einkaufspreis festhalten. Summen pro Monat und Jahr, Meldegrenze, CSV-Export."}, function () {
/*
 * Modul: Verkaufsbuch
 * -------------------
 * Verkäufe selbst festhalten: unter „Meine Anzeigen“ sitzt an jeder Anzeige „Verkauft …“.
 * Endpreis, Datum, Zahlungsart, Abholung oder Versand und optional ein Einkaufspreis werden
 * lokal gespeichert. Eine Anzeige kann mehrmals verkauft werden (mehrere Stück).
 *
 * - Übersicht (Button über der Liste oder Tampermonkey-Menü → „PowerSeller: Verkaufsbuch“):
 *   Summen pro Jahr und Monat, Gewinn bei bekanntem Einkaufspreis, alle Verkäufe des Jahres,
 *   Verkäufe ohne Anzeige nachtragen, CSV-Export.
 * - Meldegrenze: zählt die eingetragenen Verkäufe „über Kleinanzeigen bezahlt“ gegen die
 *   Grenzen, ab denen Plattformen Verkäufer ans Bundeszentralamt für Steuern melden
 *   (30 Verkäufe oder mehr als 2.000 € im Jahr). Nur ein Hinweis, keine Steuerberatung.
 * - Einkaufspreis: steht in der Notiz der Anzeige „EK 20 €“ (Modul Meine Anzeigen), wird er
 *   vorgeschlagen.
 *
 * Nur Lesen: Am Zustand der Anzeige auf Kleinanzeigen ändert sich nichts.
 */

(function () {
    'use strict';

    const CONFIG = {
        keys: {
            sales: 'kpw-verkaeufe',         // [{ id, adId, url, title, price, date, pay, ship, ek, note }]
            settings: 'kpw-verkaufsbuch',   // { pay, ship } zuletzt gewählt
        },
        foreign: { ads: 'kpw-anzeigen' },   // Notizen aus dem Modul Meine Anzeigen
        path: /^\/m-meine-anzeigen/,
        // Stand 10/2026, wie im Modul Meine Anzeigen
        listSelector: '#my-manageitems-adlist',
        cardSelector: 'li[data-testid="ad-card"][data-adid]',
        imageSelector: 'img[data-testid="ad-image"]',
        featureSection: '#feature-offer-section',
        visitorsRe: /^[\d.]+\s+Besucher$/,
        max: 20000,
        titleMax: 120,
        noteMax: 200,
        // Meldegrenzen nach DAC7 / Plattformen-Steuertransparenzgesetz (pro Plattform und Jahr)
        limitCount: 30,
        limitAmount: 2000,
        scanDelayMs: 300,
    };

    const PAY = {
        bar: 'Bar',
        kleinanzeigen: 'Über Kleinanzeigen bezahlt',
        paypal: 'PayPal',
        ueberweisung: 'Überweisung',
        sonstig: 'Sonstiges',
    };
    const SHIP = { abholung: 'Abholung', versand: 'Versand' };
    const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    const { el, setChildren, load, save, isObj } = KS;

    // ------------------------------------------------------------------
    // Helfer
    // ------------------------------------------------------------------

    const pad = (n) => String(n).padStart(2, '0');
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const shortDate = (day) => { const [y, m, d] = day.split('-'); return `${Number(d)}.${Number(m)}.${y}`; };
    const newId = () => Math.random().toString(36).slice(2, 10);
    const text = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
    const euro = (n) => `${n.toLocaleString('de-DE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
    const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

    // „75“, „75,50“, „1.200“, „1.200,50 €“ -> Zahl, sonst null
    function parseAmount(raw) {
        let s = String(raw || '').replace(/[\s€]/g, '');
        if (!s) return null;
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
        return num(Number(s));
    }

    // Preis der Anzeige („80 € VB“) als Vorschlag für den Endpreis
    function priceValue(p) {
        const m = String(p || '').match(/(\d[\d.]*)(?:,(\d{1,2}))?\s*€/);
        return m ? Number(m[1].replace(/\./g, '')) + (m[2] ? Number(m[2]) / 100 : 0) : null;
    }

    function cleanSale(x) {
        if (!isObj(x) || !isDay(x.date) || num(x.price) === null) return null;
        return {
            id: typeof x.id === 'string' && x.id ? x.id : newId(),
            adId: typeof x.adId === 'string' && /^\d+$/.test(x.adId) ? x.adId : '',
            url: typeof x.url === 'string' && /^https:\/\/www\.kleinanzeigen\.de\/(s-anzeige|zur-anzeige)\//.test(x.url) ? x.url.slice(0, 300) : '',
            title: typeof x.title === 'string' ? x.title.slice(0, CONFIG.titleMax) : '',
            price: num(x.price),
            date: x.date,
            pay: Object.hasOwn(PAY, x.pay) ? x.pay : 'sonstig',
            ship: Object.hasOwn(SHIP, x.ship) ? x.ship : 'abholung',
            ek: num(x.ek),
            note: typeof x.note === 'string' ? x.note.slice(0, CONFIG.noteMax) : '',
        };
    }

    function loadSales() {
        const raw = load(CONFIG.keys.sales, []);
        return Array.isArray(raw) ? raw.map(cleanSale).filter(Boolean) : [];
    }
    const saveSales = (sales) => save(CONFIG.keys.sales, sales.slice(-CONFIG.max));
    const loadSettings = () => {
        const raw = load(CONFIG.keys.settings, {});
        return { pay: 'bar', ship: 'abholung', ...(isObj(raw) ? raw : {}) };
    };

    // Einkaufspreis aus der Notiz der Anzeige („EK 20 €“, „EK: 12,50“)
    function ekFromNote(adId) {
        const ads = load(CONFIG.foreign.ads, {});
        const note = isObj(ads) && isObj(ads[adId]) ? String(ads[adId].note || '') : '';
        const m = note.match(/\bEK\s*:?\s*(\d[\d.,]*)/i);
        return m ? parseAmount(m[1]) : null;
    }

    function upsert(sale) {
        const sales = loadSales();
        const i = sales.findIndex(s => s.id === sale.id);
        if (i >= 0) sales[i] = sale; else sales.push(sale);
        sales.sort((a, b) => a.date.localeCompare(b.date));
        saveSales(sales);
        save(CONFIG.keys.settings, { pay: sale.pay, ship: sale.ship });
    }

    function remove(id) {
        saveSales(loadSales().filter(s => s.id !== id));
    }

    // ------------------------------------------------------------------
    // Styles
    // ------------------------------------------------------------------

    const style = el('style', { 'data-kpw-ui': '' }, `
        .kpw-vb { margin: 6px 0 0; display: grid; gap: 4px; font: 13px/1.4 system-ui, sans-serif; color: #3d3d3d; text-align: left; }
        .kpw-vb, .kpw-vb *, .kpw-vb-bar, .kpw-vb-bar * { font-family: system-ui, sans-serif !important; }
        .kpw-vb button { border: 0; background: none; padding: 0; font: inherit; color: #1e1e1e; cursor: pointer; text-decoration: underline; }
        .kpw-vb-sold { padding: 2px 8px; border-radius: 6px; background: #e8f5e9; color: #1b5e20; justify-self: start; }
        .kpw-vb-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
        .kpw-vb-form { display: grid; gap: 6px; padding: 8px; border: 1px solid #d0d0cc; border-radius: 8px; background: #fafaf8; max-width: 420px; }
        .kpw-vb-form label { display: grid; grid-template-columns: 9em 1fr; gap: 8px; align-items: center; font-size: 13px; color: #3d3d3d; }
        .kpw-vb-form input, .kpw-vb-form select {
            box-sizing: border-box; width: 100%; padding: 4px 8px; border: 1px solid #c9c7c2; border-radius: 6px;
            background: #fff; color: #1e1e1e; font: 13px/1.4 system-ui, sans-serif; height: auto; min-height: 0;
        }
        .kpw-vb-form .kpw-vb-error { color: #b71c1c; }
        .kpw-vb-form .kpw-vb-actions { display: flex; gap: 8px; }
        .kpw-vb-form .kpw-vb-actions button {
            padding: 4px 12px; border: 1px solid #c9c7c2; border-radius: 999px; background: #fff; text-decoration: none; font-weight: 600;
        }
        .kpw-vb-form .kpw-vb-actions button[data-primary] { background: #1e1e1e; border-color: #1e1e1e; color: #fff; }
        .kpw-vb-bar { margin: 0 0 10px; display: flex; justify-content: flex-end; }
        .kpw-vb-bar button {
            padding: 6px 14px; border: 1px solid #c9c7c2; border-radius: 999px; background: #fff; color: #1e1e1e;
            font: 600 13px/1.3 system-ui, sans-serif; cursor: pointer;
        }
        .kpw-vb-bar button:hover { border-color: #1e1e1e; }
        .ks-panel.kpw-book { width: min(820px, 100%); }
        .kpw-book table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .kpw-book th, .kpw-book td { padding: 4px 8px 4px 0; text-align: right; border-bottom: 1px solid #eceae6; vertical-align: top; }
        .kpw-book th:first-child, .kpw-book td:first-child, .kpw-book td.kpw-l, .kpw-book th.kpw-l { text-align: left; }
        .kpw-book thead th { color: #6b6b6b; font-weight: 600; }
        .kpw-book tfoot td { font-weight: 700; border-bottom: 0; }
        .kpw-book .kpw-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
        .kpw-book .kpw-stat { padding: 8px 10px; border: 1px solid #e3e1dc; border-radius: 8px; }
        .kpw-book .kpw-stat b { display: block; font-size: 18px; }
        .kpw-book .kpw-limit { padding: 8px 10px; border-radius: 8px; background: #f2f1ee; font-size: 13px; display: grid; gap: 4px; }
        .kpw-book .kpw-limit[data-level="near"] { background: #fff3d6; color: #5c4400; }
        .kpw-book .kpw-limit[data-level="over"] { background: #fdecea; color: #8e1c1c; }
        .kpw-book .kpw-meter { height: 6px; border-radius: 3px; background: rgba(0,0,0,.1); overflow: hidden; }
        .kpw-book .kpw-meter span { display: block; height: 100%; background: currentColor; }
        .kpw-book select.ks-input { width: auto; }
        :root[data-kpw-theme="rainbow"] .kpw-vb { padding-left: 10px; background: var(--kpw-rainbow-v) left / 3px 100% no-repeat; }
        :root[data-kpw-theme="rainbow"] .kpw-vb-bar button {
            border: 2px solid transparent; color: #fff;
            background: linear-gradient(#141418, #141418) padding-box, var(--kpw-rainbow) border-box;
        }
        :root[data-kpw-theme="rainbow"] .kpw-vb-bar button:hover { background: linear-gradient(#2a2a30, #2a2a30) padding-box, var(--kpw-rainbow) border-box; }
        :root[data-kpw-theme="rainbow"] .kpw-vb-form .kpw-vb-actions button[data-primary] {
            border: 2px solid transparent; background: linear-gradient(#141418, #141418) padding-box, var(--kpw-rainbow) border-box;
        }
    `);
    const ensureStyle = () => { if (!style.isConnected) (document.head || document.documentElement).appendChild(style); };

    // ------------------------------------------------------------------
    // Formular (an der Anzeige und in der Übersicht)
    // ------------------------------------------------------------------

    // sale: bestehender Verkauf oder Vorlage { adId, title, price }. onDone(saved: boolean)
    function saleForm(sale, onDone, withTitle) {
        const last = loadSettings();
        const ek = sale.ek ?? (sale.adId ? ekFromNote(sale.adId) : null);
        const amount = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
        const f = {
            title: el('input', { value: sale.title || '', maxLength: CONFIG.titleMax, placeholder: 'Was wurde verkauft?' }),
            price: el('input', { value: amount(sale.price), inputMode: 'decimal', placeholder: 'z. B. 75 oder 75,50' }),
            date: el('input', { type: 'date', value: sale.date || today(), max: today() }),
            pay: el('select', {}, Object.entries(PAY).map(([v, t]) => el('option', { value: v, selected: (sale.pay || last.pay) === v }, t))),
            ship: el('select', {}, Object.entries(SHIP).map(([v, t]) => el('option', { value: v, selected: (sale.ship || last.ship) === v }, t))),
            ek: el('input', { value: amount(ek), inputMode: 'decimal', placeholder: 'optional' }),
            note: el('input', { value: sale.note || '', maxLength: CONFIG.noteMax, placeholder: 'optional, z. B. Käufer' }),
        };
        const error = el('div', { className: 'kpw-vb-error', role: 'alert' });
        const submit = () => {
            const price = parseAmount(f.price.value);
            const ekValue = f.ek.value.trim() ? parseAmount(f.ek.value) : null;
            const title = (withTitle ? f.title.value : sale.title || '').trim();
            if (withTitle && !title) return void (error.textContent = 'Bitte angeben, was verkauft wurde.');
            if (price === null) return void (error.textContent = 'Bitte einen Endpreis angeben, z. B. 75 oder 75,50.');
            if (f.ek.value.trim() && ekValue === null) return void (error.textContent = 'Der Einkaufspreis ist keine gültige Zahl.');
            if (!isDay(f.date.value)) return void (error.textContent = 'Bitte ein Datum wählen.');
            upsert(cleanSale({
                id: sale.id || newId(), adId: sale.adId || '', url: sale.url || '', title, price, date: f.date.value,
                pay: f.pay.value, ship: f.ship.value, ek: ekValue, note: f.note.value.trim(),
            }));
            onDone(true);
        };
        const form = el('form', {
            className: 'kpw-vb-form', 'data-kpw-ui': '',
            onsubmit: (e) => { e.preventDefault(); e.stopPropagation(); submit(); },
            onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(false); } },
        },
            withTitle ? el('label', {}, 'Artikel', f.title) : null,
            el('label', {}, 'Endpreis (€)', f.price),
            el('label', {}, 'Verkauft am', f.date),
            el('label', {}, 'Bezahlt', f.pay),
            el('label', {}, 'Übergabe', f.ship),
            el('label', {}, 'Einkaufspreis (€)', f.ek),
            el('label', {}, 'Notiz', f.note),
            error,
            el('div', { className: 'kpw-vb-actions' },
                el('button', { type: 'submit', dataset: { primary: '' } }, 'Speichern'),
                el('button', { type: 'button', onclick: () => onDone(false) }, 'Abbrechen')));
        setTimeout(() => (withTitle ? f.title : f.price).focus(), 0);
        return form;
    }

    // ------------------------------------------------------------------
    // An den Anzeigen
    // ------------------------------------------------------------------

    function readCard(card) {
        const adId = card.getAttribute('data-adid');
        if (!/^\d+$/.test(adId || '')) return null;
        const img = card.querySelector(CONFIG.imageSelector);
        const h3 = card.querySelector('h3');
        const title = (img && img.getAttribute('alt')) || (h3 && text(h3.querySelector('span:last-of-type'))) || text(h3);
        let price = '';
        let stats = null;
        for (const li of card.querySelectorAll('li')) {
            if (li.closest(CONFIG.featureSection) || li.closest('[data-kpw-ui]')) continue;
            const t = text(li);
            if (!price && /€|VB|verschenken/i.test(t) && t.length < 40) price = t;
            if (!stats && CONFIG.visitorsRe.test(t)) stats = li;
        }
        const link = card.querySelector('a[href*="/s-anzeige/"]');
        return { adId, url: link ? link.href : '', title: title.slice(0, CONFIG.titleMax), price, stats };
    }

    function renderCard(box, info, sales) {
        const mine = sales.filter(s => s.adId === info.adId);
        const sig = JSON.stringify(mine);
        if (box.dataset.sig === sig || box.dataset.editing) return;
        box.dataset.sig = sig;
        const edit = (sale) => {
            box.dataset.editing = '1';
            setChildren(box, saleForm(sale, () => { delete box.dataset.editing; delete box.dataset.sig; scan(); }));
        };
        setChildren(box,
            mine.map(s => el('div', { className: 'kpw-vb-row' },
                el('span', { className: 'kpw-vb-sold' }, `✓ Verkauft am ${shortDate(s.date)} für ${euro(s.price)} (${PAY[s.pay]}, ${SHIP[s.ship]})`),
                el('button', { type: 'button', onclick: () => edit(s) }, 'Ändern'),
                el('button', {
                    type: 'button', onclick: () => {
                        if (!window.confirm(`Verkauf vom ${shortDate(s.date)} aus dem Verkaufsbuch löschen?`)) return;
                        remove(s.id);
                        delete box.dataset.sig;
                        scan();
                    },
                }, 'Löschen'))),
            el('div', { className: 'kpw-vb-row' },
                el('button', {
                    type: 'button',
                    onclick: () => edit({ adId: info.adId, url: info.url, title: info.title, price: priceValue(info.price) }),
                }, mine.length ? 'Noch eins verkauft …' : 'Verkauft …')));
    }

    function scan() {
        const cards = [...document.querySelectorAll(CONFIG.cardSelector)];
        if (!cards.length) return;
        ensureStyle();
        const sales = loadSales();
        for (const card of cards) {
            const info = readCard(card);
            if (!info) continue;
            let box = card.querySelector('.kpw-vb');
            if (!box) {
                box = el('div', { className: 'kpw-vb', 'data-kpw-ui': '' });
                const anchor = card.querySelector('.kpw-ma') || (info.stats && (info.stats.closest('section') || info.stats.parentElement));
                if (anchor && anchor !== card) anchor.after(box);
                else (card.querySelector('h3')?.parentElement || card).appendChild(box);
            }
            renderCard(box, info, sales);
        }
        const list = document.querySelector(CONFIG.listSelector);
        if (list && !document.querySelector('.kpw-vb-bar')) {
            const sum = list.previousElementSibling && list.previousElementSibling.classList.contains('kpw-ma-sum') ? list.previousElementSibling : list;
            sum.before(el('div', { className: 'kpw-vb-bar', 'data-kpw-ui': '' },
                el('button', { type: 'button', onclick: openBook }, '📒 Verkaufsbuch')));
        }
    }

    // ------------------------------------------------------------------
    // Übersicht
    // ------------------------------------------------------------------

    let book = null; // { overlay, box, year, adding: false | true | Vorlage, onSaved }

    function closeBook() {
        if (!book) return;
        document.removeEventListener('keydown', book.onKey, true);
        book.overlay.remove();
        book = null;
        scan();
    }

    function openBook() {
        closeBook();
        KS.ensureStyles();
        ensureStyle();
        const box = el('div', { className: 'ks-panel kpw-book', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Verkaufsbuch' });
        const overlay = el('div', { className: 'ks-overlay', 'data-kpw-ui': '' }, box);
        overlay.addEventListener('pointerdown', e => { if (e.target === overlay) closeBook(); });
        // Esc schließt das Verkaufsbuch, in einem offenen Formular nur das Formular
        const onKey = (e) => {
            if (e.key !== 'Escape' || (e.target.closest && e.target.closest('.kpw-vb-form'))) return;
            e.stopPropagation();
            closeBook();
        };
        document.addEventListener('keydown', onKey, true);
        book = { overlay, box, onKey, year: new Date().getFullYear(), adding: false };
        document.body.appendChild(overlay);
        renderBook();
    }

    function stat(label, value, hint) {
        return el('div', { className: 'kpw-stat' }, el('span', { className: 'ks-muted' }, label), el('b', {}, value), hint ? el('span', { className: 'ks-muted' }, hint) : null);
    }

    function meter(part, whole) {
        return el('div', { className: 'kpw-meter' }, el('span', { style: `width: ${Math.min(100, Math.round(part / whole * 100))}%` }));
    }

    function renderBook() {
        if (!book) return;
        const { box } = book;
        const scrollTop = box.scrollTop;
        const all = loadSales();
        const years = [...new Set([new Date().getFullYear(), ...all.map(s => Number(s.date.slice(0, 4)))])].sort((a, b) => b - a);
        const year = book.year;
        const sales = all.filter(s => s.date.startsWith(`${year}-`));
        const sum = (list) => list.reduce((a, s) => a + s.price, 0);
        const withEk = sales.filter(s => s.ek !== null);
        const profit = withEk.reduce((a, s) => a + s.price - s.ek, 0);
        const platform = sales.filter(s => s.pay === 'kleinanzeigen');
        const pCount = platform.length;
        const pSum = sum(platform);
        const level = pCount >= CONFIG.limitCount || pSum > CONFIG.limitAmount ? 'over'
            : pCount >= CONFIG.limitCount * 0.8 || pSum >= CONFIG.limitAmount * 0.8 ? 'near' : 'ok';

        const months = MONTHS.map((name, i) => {
            const list = sales.filter(s => Number(s.date.slice(5, 7)) === i + 1);
            const ek = list.filter(s => s.ek !== null);
            return { name, n: list.length, sum: sum(list), profit: ek.length ? ek.reduce((a, s) => a + s.price - s.ek, 0) : null };
        }).filter(m => m.n);

        const del = (s) => {
            if (!window.confirm(`Verkauf „${s.title || 'ohne Titel'}“ vom ${shortDate(s.date)} löschen?`)) return;
            remove(s.id);
            renderBook();
        };

        setChildren(box,
            el('div', { className: 'ks-head' },
                el('span', { className: 'ks-title' }, 'Verkaufsbuch'),
                el('select', {
                    className: 'ks-input', 'aria-label': 'Jahr',
                    onchange: (e) => { book.year = Number(e.target.value); renderBook(); },
                }, years.map(y => el('option', { value: y, selected: y === year }, String(y)))),
                el('button', { type: 'button', className: 'ks-icon-btn', 'aria-label': 'Schließen', title: 'Schließen', onclick: closeBook }, '×')),
            el('div', { className: 'ks-body' },
                el('div', { className: 'kpw-stats' },
                    stat('Verkäufe', String(sales.length)),
                    stat('Umsatz', euro(sum(sales))),
                    stat('Gewinn', withEk.length ? euro(profit) : '–', withEk.length ? `bei ${withEk.length} von ${sales.length} mit Einkaufspreis` : 'Einkaufspreis eintragen')),
                el('div', { className: 'kpw-limit', dataset: { level } },
                    el('strong', {}, `Über Kleinanzeigen bezahlt: ${pCount} ${pCount === 1 ? 'Verkauf' : 'Verkäufe'}, ${euro(pSum)}`),
                    el('span', {}, `${pCount} von ${CONFIG.limitCount} Verkäufen`), meter(pCount, CONFIG.limitCount),
                    el('span', {}, `${euro(pSum)} von ${euro(CONFIG.limitAmount)}`), meter(pSum, CONFIG.limitAmount),
                    el('span', {}, 'Plattformen melden Verkäufer ans Bundeszentralamt für Steuern, wenn sie in einem Jahr 30 Verkäufe oder mehr als 2.000 € erreichen (DAC7). '
                        + 'Kleinanzeigen zählt nach eigener Aussage nur Verkäufe über das eigene Bezahlsystem. Maßgeblich ist die „Verkaufsübersicht“ in deinem Profil; '
                        + 'hier zählt nur, was du selbst eingetragen hast. Eine Meldung heißt nicht, dass Steuern fällig sind. Keine Steuerberatung.')),
                months.length ? el('section', { className: 'ks-section' },
                    el('h3', {}, 'Nach Monaten'),
                    el('table', {},
                        el('thead', {}, el('tr', {}, el('th', {}, 'Monat'), el('th', {}, 'Verkäufe'), el('th', {}, 'Umsatz'), el('th', {}, 'Gewinn'))),
                        el('tbody', {}, months.map(m => el('tr', {}, el('td', {}, m.name), el('td', {}, String(m.n)), el('td', {}, euro(m.sum)), el('td', {}, m.profit === null ? '–' : euro(m.profit))))))) : null,
                el('section', { className: 'ks-section' },
                    el('h3', {}, `Verkäufe ${year}`),
                    sales.length ? el('table', {},
                        el('thead', {}, el('tr', {},
                            el('th', {}, 'Datum'), el('th', { className: 'kpw-l' }, 'Artikel'), el('th', {}, 'Preis'), el('th', { className: 'kpw-l' }, 'Bezahlt'),
                            el('th', { className: 'kpw-l' }, 'Übergabe'), el('th', {}, 'EK'), el('th', {}, ''))),
                        el('tbody', {}, [...sales].reverse().map(s => el('tr', {},
                            el('td', {}, shortDate(s.date)),
                            el('td', { className: 'kpw-l' }, s.url
                                ? el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title || 'ohne Titel')
                                : (s.title || 'ohne Titel'), s.note ? el('div', { className: 'ks-muted' }, s.note) : null),
                            el('td', {}, euro(s.price)),
                            el('td', { className: 'kpw-l' }, PAY[s.pay]),
                            el('td', { className: 'kpw-l' }, SHIP[s.ship]),
                            el('td', {}, s.ek === null ? '–' : euro(s.ek)),
                            el('td', {}, el('button', { type: 'button', className: 'ks-icon-btn', 'aria-label': 'Löschen', title: 'Löschen', onclick: () => del(s) }, '🗑'))))),
                        el('tfoot', {}, el('tr', {}, el('td', {}, 'Summe'), el('td', {}), el('td', {}, euro(sum(sales))), el('td', {}), el('td', {}), el('td', {}), el('td', {}))))
                        : el('p', { className: 'ks-hint' }, 'Noch keine Verkäufe in diesem Jahr. Unter „Meine Anzeigen“ steht an jeder Anzeige „Verkauft …“.'),
                    book.adding
                        ? saleForm(book.adding === true ? {} : book.adding, (saved) => {
                            const cb = book.onSaved;
                            book.adding = false;
                            book.onSaved = null;
                            renderBook();
                            if (saved && cb) cb();
                        }, true)
                        : el('div', { className: 'ks-row' },
                            el('button', { type: 'button', className: 'ks-action', onclick: () => { book.adding = true; renderBook(); } }, '+ Verkauf ohne Anzeige eintragen'),
                            el('span', { className: 'ks-spacer' }),
                            el('button', { type: 'button', className: 'ks-action', disabled: !all.length, onclick: () => csv(all) }, 'Alle als CSV exportieren'))),
                el('p', { className: 'ks-hint' }, 'Das Verkaufsbuch liegt nur in deinem Browser. Für eine Sicherung regelmäßig als CSV exportieren.')));
        box.scrollTop = scrollTop;
    }

    function csv(sales) {
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const n = (v) => (v === null ? '' : v.toFixed(2).replace('.', ','));
        const lines = [['Datum', 'Artikel', 'Anzeigen-Nr.', 'Preis', 'Bezahlt', 'Übergabe', 'Einkaufspreis', 'Gewinn', 'Notiz'].map(q).join(';')];
        for (const s of sales) {
            lines.push([shortDate(s.date), s.title, s.adId, n(s.price), PAY[s.pay], SHIP[s.ship], n(s.ek), n(s.ek === null ? null : s.price - s.ek), s.note].map(q).join(';'));
        }
        const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        const a = el('a', { href: url, download: `verkaufsbuch-${today()}.csv` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------

    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('PowerSeller: Verkaufsbuch', openBook);

    // Für andere Module (Interessenten: „Gekauft“): Verkaufsbuch mit vorausgefülltem Verkauf öffnen.
    // prefill: { adId, url, title, price, note }; onSaved wird nach dem Speichern aufgerufen.
    KS.recordSale = (prefill, onSaved) => {
        openBook();
        book.adding = isObj(prefill) ? prefill : true;
        book.onSaved = typeof onSaved === 'function' ? onSaved : null;
        renderBook();
    };

    KS.addSettings('verkaufsbuch', () => {
        const n = loadSales().length;
        return [
            el('h3', {}, 'Verkaufsbuch'),
            el('p', { className: 'ks-hint' }, `${n} ${n === 1 ? 'Verkauf' : 'Verkäufe'} eingetragen, nur in deinem Browser.`),
            el('div', { className: 'ks-row' },
                el('button', { type: 'button', className: 'ks-action', onclick: () => { KS.closeSettings(); openBook(); } }, 'Verkaufsbuch öffnen')),
        ];
    });

    if (!CONFIG.path.test(window.location.pathname)) return;

    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, CONFIG.scanDelayMs); };
    const onlyOurs = (r) => (r.target.nodeType === 1 && r.target.closest('[data-kpw-ui]'))
        || r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute('data-kpw-ui'));
    new MutationObserver((records) => { if (!records.every(onlyOurs)) schedule(); })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
    KS.onRemoteChange(CONFIG.keys.sales, () => {
        document.querySelectorAll('.kpw-vb').forEach(b => delete b.dataset.sig);
        schedule();
        renderBook();
    });
    scan();
})();
});

// ========================================================================
// Modul „Interessenten“: src/interessenten.js
// ========================================================================
KS.module("interessenten", {"label":"Interessenten","version":"0.5.0","description":"Warteliste pro Anzeige mit Status und Notiz, Hinweis bei Namen, die schon einmal nicht erschienen sind; Notiz und Warteliste neben Anzeigen-Links in den Nachrichten."}, function () {
/*
 * Modul: Interessenten
 * --------------------
 * Warteliste pro Anzeige: Wer hat gefragt, in welcher Reihenfolge, was ist abgesprochen?
 *
 * - Unter „Meine Anzeigen“ an jeder Anzeige: Interessenten mit Name, Status (wartet,
 *   reserviert, gekauft, abgesagt, nicht erschienen) und Notiz („bietet 40 €, kommt Sa“).
 *   Die Reihenfolge ist die Warteliste; „Als Nächstes“ zeigt, wer dran ist, wenn jemand
 *   abspringt.
 * - Nicht erschienen: Taucht ein Name auf, der schon einmal nicht erschienen ist (auch bei
 *   einer anderen Anzeige), steht ein Hinweis dabei.
 * - Nachrichten: Unter dem Kopf der geöffneten Unterhaltung stehen die Notiz der Anzeige
 *   (Modul Meine Anzeigen) und die Warteliste. Das Gegenüber lässt sich mit einem Klick auf
 *   die Warteliste setzen; Status und Notiz lassen sich dort direkt ändern.
 *
 * Namen und Notizen liegen nur im Browser. Es wird nichts an Kleinanzeigen geschickt.
 */

(function () {
    'use strict';

    const CONFIG = {
        keys: {
            people: 'kpw-interessenten',            // { <adId>: [{ id, name, uid, status, note, added }] }
            titles: 'kpw-interessenten-titel',      // { <adId>: Titel } für die Liste der Unterhaltungen
        },
        foreign: { ads: 'kpw-anzeigen', sales: 'kpw-verkaeufe' },
        pages: { anzeigen: /^\/m-meine-anzeigen/, nachrichten: /^\/m-nachrichten/ },
        // Stand 10/2026, wie im Modul Meine Anzeigen
        cardSelector: 'li[data-testid="ad-card"][data-adid]',
        featureSection: '#feature-offer-section',
        visitorsRe: /^[\d.]+\s+Besucher$/,
        // Nachrichten (Stand 10/2026): Unterhaltung, Link zur Anzeige im Kopf (/zur-anzeige/<nummer>,
        // ersatzweise /s-anzeige/…/<nummer>-…), markierter Eintrag der Liste
        conversationSelector: '[data-testid="conversation-wrapper"]',
        adLinkRe: /\/(?:zur-anzeige\/|s-anzeige\/(?:[^/?#]+\/)?)(\d{6,})/,
        activeItemName: '.ConversationListItem.is-highlighted header span span',
        listItem: '.ConversationListItem',
        perAd: 50,
        nameMax: 40,
        noteMax: 200,
        scanDelayMs: 300,
    };

    const STATUS = {
        wartet: 'Wartet',
        reserviert: 'Reserviert',
        gekauft: 'Gekauft',
        abgesagt: 'Abgesagt',
        noshow: 'Nicht erschienen',
    };

    const path = window.location.pathname;
    const page = CONFIG.pages.anzeigen.test(path) ? 'anzeigen' : CONFIG.pages.nachrichten.test(path) ? 'nachrichten' : null;
    if (!page) return;

    const { el, setChildren, load, save, isObj } = KS;

    // ------------------------------------------------------------------
    // Daten
    // ------------------------------------------------------------------

    const newId = () => Math.random().toString(36).slice(2, 10);
    const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
    const text = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
    const nameKey = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

    function loadPeople() {
        const raw = load(CONFIG.keys.people, {});
        const out = {};
        if (!isObj(raw)) return out;
        for (const [adId, list] of Object.entries(raw)) {
            if (!/^\d+$/.test(adId) || !Array.isArray(list)) continue;
            const clean = list.filter(isObj).map(p => ({
                id: typeof p.id === 'string' && p.id ? p.id : newId(),
                name: str(p.name, CONFIG.nameMax),
                status: Object.hasOwn(STATUS, p.status) ? p.status : 'wartet',
                note: str(p.note, CONFIG.noteMax),
                uid: typeof p.uid === 'string' && /^\d+$/.test(p.uid) ? p.uid : '',
                added: typeof p.added === 'number' ? p.added : 0,
            })).filter(p => p.name).slice(0, CONFIG.perAd);
            if (clean.length) out[adId] = clean;
        }
        return out;
    }

    // Liste einer Anzeige ändern: frisch laden, ändern, speichern (andere Tabs bleiben aktuell)
    function update(adId, fn) {
        const all = loadPeople();
        const list = all[adId] || [];
        fn(list);
        if (list.length) all[adId] = list.slice(0, CONFIG.perAd); else delete all[adId];
        save(CONFIG.keys.people, all);
    }

    // Wer ist als Nächstes dran? Der erste Wartende, solange niemand reserviert oder gekauft hat
    function nextUp(list) {
        if (list.some(p => p.status === 'reserviert' || p.status === 'gekauft')) return null;
        return list.find(p => p.status === 'wartet') || null;
    }

    // Namen, die schon einmal nicht erschienen sind: Name -> Anzahl
    function noShows(all) {
        const map = new Map();
        for (const list of Object.values(all)) {
            for (const p of list) if (p.status === 'noshow') map.set(nameKey(p.name), (map.get(nameKey(p.name)) || 0) + 1);
        }
        return map;
    }

    function adInfo(adId) {
        const ads = load(CONFIG.foreign.ads, {});
        return isObj(ads) && isObj(ads[adId]) ? ads[adId] : {};
    }

    // Titel merken, damit die Liste der Unterhaltungen (dort stehen nur Name und Titel) passt
    function loadTitles() { const m = load(CONFIG.keys.titles, {}); return isObj(m) ? m : {}; }
    function rememberTitle(adId, title) {
        if (!title) return;
        const map = loadTitles();
        if (map[adId] === title) return;
        map[adId] = title.slice(0, 120);
        save(CONFIG.keys.titles, map);
    }

    // Verkaufsbuch: Gibt es zu dieser Person schon einen Verkauf? (Notiz „Käufer: Kai“)
    function loadSales() { const s = load(CONFIG.foreign.sales, []); return Array.isArray(s) ? s.filter(isObj) : []; }
    const hasSale = (sales, adId, name) => sales.some(s => s.adId === adId && typeof s.note === 'string' && nameKey(s.note).includes(nameKey(name)));

    // „Ins Verkaufsbuch“ bei „Gekauft“, solange dort noch kein Verkauf an diese Person steht
    function saleButton(adId, p, ad, sales, onSaved) {
        if (p.status !== 'gekauft' || typeof KS.recordSale !== 'function' || hasSale(sales, adId, p.name)) return null;
        const info = adInfo(adId);
        const m = String(info.price || '').match(/(\d[\d.]*)(?:,(\d{1,2}))?\s*€/);
        const price = m ? Number(m[1].replace(/\./g, '')) + (m[2] ? Number(m[2]) / 100 : 0) : null;
        return el('button', {
            type: 'button', className: 'kpw-in-sale',
            onclick: () => KS.recordSale({ adId, url: ad.url || '', title: ad.title || info.title || '', price, note: `Käufer: ${p.name}` }, onSaved),
        }, '📒 Im Verkaufsbuch eintragen');
    }

    function adNote(adId) {
        const ads = load(CONFIG.foreign.ads, {});
        return isObj(ads) && isObj(ads[adId]) ? str(ads[adId].note, 300) : '';
    }

    // ------------------------------------------------------------------
    // Styles
    // ------------------------------------------------------------------

    const style = el('style', { 'data-kpw-ui': '' }, `
        .kpw-in { margin: 6px 0 0; display: grid; gap: 4px; font: 13px/1.4 system-ui, sans-serif !important; color: #3d3d3d; text-align: left; }
        .kpw-in * { font-family: system-ui, sans-serif !important; }
        .kpw-in button { border: 0; background: none; padding: 0; font: inherit; color: #1e1e1e; cursor: pointer; }
        .kpw-in-head { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
        .kpw-in-head > button { text-decoration: underline; }
        .kpw-in-next { padding: 1px 8px; border-radius: 6px; background: #e3f2fd; color: #0d3c61; }
        .kpw-in-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
        .kpw-in-row { display: grid; grid-template-columns: 1.4em minmax(4em, 1fr) auto auto auto auto; gap: 4px; align-items: center; }
        .kpw-in-row input, .kpw-in-row select, .kpw-in-add input {
            box-sizing: border-box; width: 100%; padding: 3px 6px; border: 1px solid #c9c7c2; border-radius: 6px;
            background: #fff; color: #1e1e1e; font: 13px/1.4 system-ui, sans-serif; height: auto; min-height: 0;
        }
        .kpw-in-row .kpw-in-note { grid-column: 2 / -1; }
        .kpw-in-row select { width: auto; max-width: none; }
        .kpw-in-row[data-status="abgesagt"] .kpw-in-name, .kpw-in-row[data-status="noshow"] .kpw-in-name { text-decoration: line-through; color: #8a8a8a; }
        .kpw-in-row[data-status="gekauft"] .kpw-in-name { color: #1b5e20; font-weight: 600; }
        .kpw-in-row[data-status="reserviert"] .kpw-in-name { color: #0d3c61; font-weight: 600; }
        .kpw-in-pos { color: #6b6b6b; text-align: right; }
        .kpw-in-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kpw-in-icon { width: 20px; height: 24px; border-radius: 6px !important; text-align: center !important; }
        .kpw-in-icon:hover:not(:disabled) { background: #f2f1ee !important; }
        .kpw-in-icon:disabled { opacity: .35; cursor: default; }
        .kpw-in-warn { grid-column: 2 / -1; color: #8e1c1c; font-size: 12px; }
        .kpw-in-add { display: grid; grid-template-columns: minmax(6em, 1fr) 2fr auto; gap: 6px; }
        .kpw-in-add button { padding: 3px 12px; border: 1px solid #c9c7c2; border-radius: 999px; background: #fff; font-weight: 600; }
        .kpw-in-hint { color: #6b6b6b; font-size: 12px; }
        :root[data-kpw-theme="rainbow"] .kpw-in { padding-left: 10px; background: var(--kpw-rainbow-v) left / 3px 100% no-repeat; }
        .kpw-in-bar { margin: 0; padding: 6px 12px; background: #fff; border-bottom: 1px solid #e3e1dc; }
        :root[data-kpw-theme="rainbow"] .kpw-in-bar { padding-left: 14px; background: var(--kpw-rainbow-v) left / 4px 100% no-repeat, #fff; }
        .kpw-in-bar select, .kpw-in-bar input {
            box-sizing: border-box; padding: 3px 6px; border: 1px solid #c9c7c2; border-radius: 6px;
            background: #fff; color: #1e1e1e; font: 13px/1.4 system-ui, sans-serif; height: auto; min-height: 0;
        }
        .kpw-in-bar input { flex: 1; min-width: 160px; }
        .kpw-in-badge {
            flex: none; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: #e3f2fd; color: #0d3c61;
            font: 600 11px/1.6 system-ui, sans-serif !important; white-space: nowrap;
        }
        .kpw-in-badge[data-status="reserviert"] { background: #e8eaf6; color: #283593; }
        .kpw-in-badge[data-status="gekauft"] { background: #e8f5e9; color: #1b5e20; }
        .kpw-in-badge[data-status="noshow"] { background: #fdecea; color: #8e1c1c; }
        .kpw-in-badge[data-status="abgesagt"] { background: #eeeeee; color: #555; }
        .kpw-in-sale { grid-column: 2 / -1; justify-self: start; text-decoration: underline; }
        .kpw-in-note-chip { padding: 1px 8px; border-radius: 6px; background: #eef4fb; color: #1d3a5c; }
        .kpw-in-addbtn { text-decoration: none !important; padding: 3px 12px !important; border: 1px solid #c9c7c2 !important; border-radius: 999px; background: #fff !important; font-weight: 600 !important; }
        :root[data-kpw-theme="rainbow"] .kpw-in-addbtn {
            border: 2px solid transparent !important; color: #fff !important;
            background: linear-gradient(#141418, #141418) padding-box, var(--kpw-rainbow) border-box !important;
        }
    `);
    const ensureStyle = () => { if (!style.isConnected) (document.head || document.documentElement).appendChild(style); };

    // ------------------------------------------------------------------
    // Meine Anzeigen: Warteliste an jeder Anzeige
    // ------------------------------------------------------------------

    const open = new Set();         // aufgeklappte Anzeigen

    function iconBtn(label, sym, onclick, disabled) {
        return el('button', { type: 'button', className: 'kpw-in-icon', 'aria-label': label, title: label, onclick, disabled }, sym);
    }

    function renderCard(box, adId, all, shows, ad, sales) {
        const list = all[adId] || [];
        const sold = list.map(p => hasSale(sales, adId, p.name));
        const sig = JSON.stringify([list, open.has(adId), list.map(p => shows.get(nameKey(p.name)) || 0), sold]);
        if (box.dataset.sig === sig || box.contains(document.activeElement)) return;
        box.dataset.sig = sig;
        const next = nextUp(list);
        const active = list.filter(p => p.status === 'wartet' || p.status === 'reserviert').length;
        // Neu zeichnen; vorher den Fokus aus der Box nehmen, sonst wartet renderCard aufs Tippen
        const refresh = () => {
            if (box.contains(document.activeElement)) document.activeElement.blur();
            delete box.dataset.sig;
            scan();
        };
        const toggle = () => { open.has(adId) ? open.delete(adId) : open.add(adId); refresh(); };

        const head = el('div', { className: 'kpw-in-head' },
            el('button', { type: 'button', 'aria-expanded': String(open.has(adId)), onclick: toggle },
                list.length ? `Interessenten: ${list.length}${active !== list.length ? ` (${active} offen)` : ''}` : '+ Interessent'),
            next ? el('span', { className: 'kpw-in-next' }, `Als Nächstes: ${next.name}`) : null,
            list.some(p => p.status === 'reserviert') ? el('span', { className: 'kpw-in-next' },
                `Reserviert für ${list.find(p => p.status === 'reserviert').name}`) : null);

        if (!open.has(adId)) return void setChildren(box, head);

        const rows = list.map((p, i) => {
            const count = shows.get(nameKey(p.name)) || 0;
            const earlier = count - (p.status === 'noshow' ? 1 : 0);
            return el('li', { className: 'kpw-in-row', dataset: { status: p.status } },
                el('span', { className: 'kpw-in-pos' }, `${i + 1}.`),
                el('span', { className: 'kpw-in-name', title: p.name }, p.name),
                el('select', {
                    'aria-label': `Status von ${p.name}`,
                    onchange: (e) => { update(adId, l => { const x = l.find(y => y.id === p.id); if (x) x.status = e.target.value; }); refresh(); },
                }, Object.entries(STATUS).map(([v, t]) => el('option', { value: v, selected: p.status === v }, t))),
                iconBtn('Nach oben', '↑', () => { update(adId, l => { const j = l.findIndex(y => y.id === p.id); if (j > 0) [l[j - 1], l[j]] = [l[j], l[j - 1]]; }); refresh(); }, i === 0),
                iconBtn('Nach unten', '↓', () => { update(adId, l => { const j = l.findIndex(y => y.id === p.id); if (j >= 0 && j < l.length - 1) [l[j + 1], l[j]] = [l[j], l[j + 1]]; }); refresh(); }, i === list.length - 1),
                iconBtn('Entfernen', '🗑', () => {
                    if (!window.confirm(`${p.name} von der Liste nehmen?`)) return;
                    update(adId, l => { const j = l.findIndex(y => y.id === p.id); if (j >= 0) l.splice(j, 1); });
                    refresh();
                }),
                el('input', {
                    className: 'kpw-in-note', value: p.note, maxLength: CONFIG.noteMax, placeholder: 'Notiz, z. B. bietet 40 €, kommt Sa',
                    'aria-label': `Notiz zu ${p.name}`,
                    onchange: (e) => { update(adId, l => { const x = l.find(y => y.id === p.id); if (x) x.note = str(e.target.value, CONFIG.noteMax); }); },
                    onblur: refresh,
                    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
                }),
                earlier > 0 ? el('span', { className: 'kpw-in-warn' },
                    `⚠ ${earlier === 1 ? 'Ist schon einmal' : `Ist schon ${earlier}-mal`} nicht erschienen`) : null,
                saleButton(adId, p, ad, sales, refresh));
        });

        const name = el('input', { maxLength: CONFIG.nameMax, placeholder: 'Name', 'aria-label': 'Name des Interessenten' });
        const note = el('input', { maxLength: CONFIG.noteMax, placeholder: 'Notiz (optional)', 'aria-label': 'Notiz' });
        const add = () => {
            const n = str(name.value, CONFIG.nameMax);
            if (!n) return void name.focus();
            update(adId, l => l.push({ id: newId(), name: n, status: 'wartet', note: str(note.value, CONFIG.noteMax), added: Date.now() }));
            delete box.dataset.sig;
            name.blur();
            note.blur();
            scan();
            box.querySelector('.kpw-in-add input')?.focus();
        };
        const enter = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
        name.addEventListener('keydown', enter);
        note.addEventListener('keydown', enter);

        setChildren(box, head,
            rows.length ? el('ol', { className: 'kpw-in-list' }, rows) : null,
            list.length < CONFIG.perAd ? el('div', { className: 'kpw-in-add' }, name, note, el('button', { type: 'button', onclick: add }, 'Hinzufügen')) : null,
            el('span', { className: 'kpw-in-hint' }, 'Reihenfolge = Warteliste. Namen und Notizen bleiben in deinem Browser.'));
    }

    function scanAnzeigen() {
        const cards = [...document.querySelectorAll(CONFIG.cardSelector)];
        if (!cards.length) return;
        ensureStyle();
        const all = loadPeople();
        const shows = noShows(all);
        const sales = loadSales();
        for (const card of cards) {
            const adId = card.getAttribute('data-adid');
            if (!/^\d+$/.test(adId || '')) continue;
            const img = card.querySelector('img[data-testid="ad-image"]');
            const link = card.querySelector('a[href*="/s-anzeige/"]');
            const ad = { title: (img && img.getAttribute('alt')) || '', url: link ? link.href : '' };
            rememberTitle(adId, ad.title);
            let box = card.querySelector('.kpw-in');
            if (!box) {
                box = el('div', { className: 'kpw-in', 'data-kpw-ui': '' });
                let anchor = card.querySelector('.kpw-vb') || card.querySelector('.kpw-ma');
                if (!anchor) {
                    const stats = [...card.querySelectorAll('li')].find(li => !li.closest(CONFIG.featureSection) && CONFIG.visitorsRe.test(text(li)));
                    anchor = stats && (stats.closest('section') || stats.parentElement);
                }
                if (anchor && anchor !== card) anchor.after(box);
                else (card.querySelector('h3')?.parentElement || card).appendChild(box);
            }
            renderCard(box, adId, all, shows, ad, sales);
        }
    }

    // ------------------------------------------------------------------
    // Nachrichten: Leiste in der geöffneten Unterhaltung
    // ------------------------------------------------------------------

    // Anzeige, Name und Nutzer-Nummer des Gegenübers aus der geöffneten Unterhaltung
    function readConversation() {
        const wrap = document.querySelector(CONFIG.conversationSelector);
        if (!wrap) return null;
        const header = wrap.querySelector('header');
        const link = [...wrap.querySelectorAll('a[href]')].find(a => text(a) && CONFIG.adLinkRe.test(a.getAttribute('href')));
        if (!header || !link) return null;
        const adId = link.getAttribute('href').match(CONFIG.adLinkRe)[1];
        // „Über Kai“ im Kasten über den Nachrichten; sonst der markierte Eintrag der Liste
        let name = '';
        for (const node of wrap.querySelectorAll('div, span')) {
            if (node.children.length || node.closest('a, .sr-only, [data-kpw-ui]')) continue;
            const m = text(node).match(/^Über (.{1,40})$/);
            if (m) { name = m[1]; break; }
        }
        if (!name) name = text(document.querySelector(CONFIG.activeItemName));
        const user = wrap.querySelector('a[href*="userId="]');
        const uid = user ? (user.getAttribute('href').match(/userId=(\d+)/) || [])[1] || '' : '';
        return { wrap, header, adId, title: text(link), url: link.href, name: str(name, CONFIG.nameMax), uid };
    }

    function findPerson(list, conv) {
        return list.find(p => conv.uid && p.uid === conv.uid)
            || list.find(p => !p.uid && conv.name && nameKey(p.name) === nameKey(conv.name)) || null;
    }

    function renderBar(bar, conv, all, shows, sales) {
        const list = all[conv.adId] || [];
        const me = findPerson(list, conv);
        const note = adNote(conv.adId);
        const sig = JSON.stringify([conv.adId, conv.name, conv.uid, list, note, me ? hasSale(sales, conv.adId, me.name) : null]);
        if (bar.dataset.sig === sig || bar.contains(document.activeElement)) return;
        bar.dataset.sig = sig;
        const refresh = () => {
            if (bar.contains(document.activeElement)) document.activeElement.blur();
            delete bar.dataset.sig;
            scan();
        };
        const reserved = list.find(p => p.status === 'reserviert');
        const next = nextUp(list);
        const waiting = list.filter(p => p.status === 'wartet').length;
        const earlier = conv.name ? (shows.get(nameKey(conv.name)) || 0) - (me && me.status === 'noshow' ? 1 : 0) : 0;

        const summary = [
            note ? el('span', { className: 'kpw-in-note-chip' }, `📝 ${note}`) : null,
            reserved ? el('span', { className: 'kpw-in-next' }, `Reserviert für ${reserved.name}`) : null,
            next ? el('span', { className: 'kpw-in-next' }, `Als Nächstes: ${next.name}`) : null,
            waiting ? el('span', {}, `${waiting} ${waiting === 1 ? 'wartet' : 'warten'}`) : null,
        ];

        let mine;
        if (!conv.name) {
            mine = null;
        } else if (me) {
            const pos = list.indexOf(me) + 1;
            mine = el('div', { className: 'kpw-in-head' },
                el('strong', {}, `${me.name}: Platz ${pos} von ${list.length}`),
                el('select', {
                    'aria-label': `Status von ${me.name}`,
                    onchange: (e) => { update(conv.adId, l => { const x = l.find(y => y.id === me.id); if (x) x.status = e.target.value; }); refresh(); },
                }, Object.entries(STATUS).map(([v, t]) => el('option', { value: v, selected: me.status === v }, t))),
                el('input', {
                    value: me.note, maxLength: CONFIG.noteMax, placeholder: 'Notiz, z. B. bietet 40 €, kommt Sa', 'aria-label': `Notiz zu ${me.name}`,
                    onchange: (e) => { update(conv.adId, l => { const x = l.find(y => y.id === me.id); if (x) x.note = str(e.target.value, CONFIG.noteMax); }); },
                    onblur: refresh,
                    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
                }),
                saleButton(conv.adId, me, conv, sales, refresh));
        } else {
            mine = el('div', { className: 'kpw-in-head' },
                el('button', {
                    type: 'button', className: 'kpw-in-addbtn',
                    onclick: () => {
                        update(conv.adId, l => l.push({ id: newId(), name: conv.name, uid: conv.uid, status: 'wartet', note: '', added: Date.now() }));
                        refresh();
                    },
                }, `+ ${conv.name} auf die Warteliste`),
                list.length ? null : el('span', { className: 'kpw-in-hint' }, 'Noch niemand auf der Warteliste für diese Anzeige.'));
        }

        setChildren(bar,
            summary.some(Boolean) ? el('div', { className: 'kpw-in-head' }, summary) : null,
            mine,
            earlier > 0 ? el('div', { className: 'kpw-in-warn' }, `⚠ ${conv.name} ${earlier === 1 ? 'ist schon einmal' : `ist schon ${earlier}-mal`} nicht erschienen`) : null);
    }

    // Kennzeichen in der Liste der Unterhaltungen: Status des Gegenübers für diese Anzeige
    function badgeList(all, shows) {
        const titles = loadTitles();
        for (const item of document.querySelectorAll(CONFIG.listItem)) {
            const name = text(item.querySelector('header > span > span'));
            let title = text(item.querySelector('h3'));
            if (title.includes('•')) title = title.split('•').pop().trim();     // „Gelöscht • …“
            let label = '', status = '';
            for (const id of Object.keys(titles).filter(k => titles[k] === title)) {
                const list = all[id] || [];
                const p = name && list.find(x => nameKey(x.name) === nameKey(name));
                if (!p) continue;
                status = p.status;
                label = p.status === 'wartet' ? `Wartet, Platz ${list.indexOf(p) + 1}` : p.status === 'noshow' ? '⚠ Nicht erschienen' : STATUS[p.status];
                break;
            }
            if (!label && name && shows.get(nameKey(name))) { label = '⚠ War schon einmal nicht da'; status = 'noshow'; }
            const host = item.querySelector('section header') || item.querySelector('header');
            let badge = item.querySelector('.kpw-in-badge');
            if (!label || !host) { if (badge) badge.remove(); continue; }
            if (!badge) {
                badge = el('span', { className: 'kpw-in-badge', 'data-kpw-ui': '', title: 'PowerSeller: Status auf deiner Warteliste' });
                host.appendChild(badge);
            }
            if (badge.textContent !== label) badge.textContent = label;
            badge.dataset.status = status;
        }
    }

    function scanNachrichten() {
        const all = loadPeople();
        const shows = noShows(all);
        if (document.querySelector(CONFIG.listItem)) { ensureStyle(); badgeList(all, shows); }
        const conv = readConversation();
        const old = document.querySelector('.kpw-in-bar');
        if (!conv) { if (old) old.remove(); return; }
        ensureStyle();
        rememberTitle(conv.adId, conv.title);
        let bar = old;
        if (!bar || bar.previousElementSibling !== conv.header) {
            if (bar) bar.remove();
            bar = el('div', { className: 'kpw-in kpw-in-bar', 'data-kpw-ui': '', role: 'region', 'aria-label': 'PowerSeller: Warteliste' });
            conv.header.after(bar);
        }
        renderBar(bar, conv, all, shows, loadSales());
    }

    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------

    const scan = page === 'anzeigen' ? scanAnzeigen : scanNachrichten;
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, CONFIG.scanDelayMs); };
    const onlyOurs = (r) => (r.target.nodeType === 1 && r.target.closest('[data-kpw-ui]'))
        || r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute('data-kpw-ui'));
    new MutationObserver((records) => { if (!records.every(onlyOurs)) schedule(); })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
    const resign = () => { document.querySelectorAll('.kpw-in').forEach(b => delete b.dataset.sig); schedule(); };
    KS.onRemoteChange(CONFIG.keys.people, resign);
    KS.onRemoteChange(CONFIG.foreign.ads, resign);
    KS.onRemoteChange(CONFIG.foreign.sales, resign);
    scan();
})();
});
})();
