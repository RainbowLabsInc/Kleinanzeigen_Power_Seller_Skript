// ==UserScript==
// @name          Kleinanzeigen - PowerSeller
// @namespace     https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript
// @description   Hilfen für Vielverkäufer auf Kleinanzeigen.de, privat und PRO: Bausteine für Nachrichten und Anzeigentexte, Warnung vor typischen Betrugsmaschen, Besucher-Verlauf und Notizen unter „Meine Anzeigen“. Alles lokal, jedes Modul einzeln abschaltbar.
// @author        RainbowlabsInc
// @copyright     2026, RainbowlabsInc
// @license       MIT
// @version       0.2.0
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
 *
 * Kern und Module sind wie beim Superscript aufgebaut (gleiche KS-Schnittstelle), damit die
 * Module später auch dort laufen können. Gespeichert wird unter eigenen Schlüsseln (kpw-…).
 *
 * powerseller.user.js wird mit `node build.js` aus src/ erzeugt. Änderungen bitte in den
 * Quelldateien vornehmen, nicht in powerseller.user.js.
 */

(function () {
    'use strict';

    const VERSION = '0.2.0';

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

        // --- Einstellungen (Dialog)

        let panel = null; // { overlay, box, changed, cleanup }

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
                    moduleSections,
                    el('p', { className: 'ks-hint' }, `PowerSeller ${VERSION} · Alles wird nur lokal in deinem Browser gespeichert · `,
                        el('a', { href: 'https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript', target: '_blank', rel: 'noopener' }, 'Projektseite'))));
            box.scrollTop = scrollTop;
        }

        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('PowerSeller: Einstellungen', openSettings);
        }

        return { VERSION, isObj, load, save, onRemoteChange, el, setChildren, checkbox, radio, searchKey, module, addSettings, openSettings, ensureStyles };
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
KS.module("bausteine", {"label":"Bausteine","version":"0.2.0","description":"Button „Bausteine“ am Nachrichtenfeld und an der Beschreibung beim Einstellen: eigene Texte mit Platzhaltern per Klick einfügen."}, function () {
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
            ['Noch da', 'Hallo, ja, der Artikel ist noch zu haben. Abholung in {Abholort} nach Absprache.', 'nachricht'],
            ['Preis fest', 'Hallo, danke für dein Interesse. Der Preis ist leider fest.', 'nachricht'],
            ['Versand', 'Versand ist möglich, als {Versand}. Die Versandkosten kommen zum Preis dazu.', 'nachricht'],
            ['Abholung', 'Gern. Wann würde es dir passen? Abholung in {Abholort}.', 'nachricht'],
            ['Reserviert', 'Der Artikel ist im Moment reserviert. Ich melde mich, falls er wieder frei wird.', 'nachricht'],
            ['Verkauft', 'Tut mir leid, der Artikel ist schon verkauft.', 'nachricht'],
            ['Privatverkauf', 'Privatverkauf, daher keine Garantie, Gewährleistung oder Rücknahme.', 'anzeige'],
            ['Versand & Abholung', 'Abholung in {Abholort}. Versand als {Versand} gegen Aufpreis möglich.', 'anzeige'],
        ],
        places: { nachricht: 'Nachrichten', anzeige: 'Anzeigentexte', beide: 'Beides' },
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
                    + 'Platzhalter wie {Abholort} werden durch deine Angaben unten ersetzt. Fehlt eine Angabe, bleibt der Platzhalter stehen und ist markiert.'),
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
KS.module("warnung", {"label":"Betrugswarnung","version":"0.2.0","description":"Markiert Nachrichten mit typischen Maschen: falsche Bezahl- und Versandlinks, „Geld freigeben“, Kurier, Codes, Überzahlung."}, function () {
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
});

// ========================================================================
// Modul „Meine Anzeigen“: src/anzeigen.js
// ========================================================================
KS.module("anzeigen", {"label":"Meine Anzeigen","version":"0.2.0","description":"Verlauf von Besuchern und Merkern, Hinweis auf Ladenhüter, eigene Notiz pro Anzeige, Summen über der Liste."}, function () {
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
        return { id, title: title.slice(0, 120), price, visitors, favorites, statsNode };
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
            stale: !!(old && info.visitors !== null && info.visitors === old[1]),
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
})();
