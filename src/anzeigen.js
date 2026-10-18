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
