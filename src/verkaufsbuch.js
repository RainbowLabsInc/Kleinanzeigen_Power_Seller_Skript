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
