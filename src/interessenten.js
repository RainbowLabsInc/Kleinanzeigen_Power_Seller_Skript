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
        keys: { people: 'kpw-interessenten' },     // { <adId>: [{ id, name, uid, status, note, added }] }
        foreign: { ads: 'kpw-anzeigen' },
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

    function renderCard(box, adId, all, shows) {
        const list = all[adId] || [];
        const sig = JSON.stringify([list, open.has(adId), list.map(p => shows.get(nameKey(p.name)) || 0)]);
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
                    `⚠ ${earlier === 1 ? 'Ist schon einmal' : `Ist schon ${earlier}-mal`} nicht erschienen`) : null);
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
        for (const card of cards) {
            const adId = card.getAttribute('data-adid');
            if (!/^\d+$/.test(adId || '')) continue;
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
            renderCard(box, adId, all, shows);
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
        return { wrap, header, adId, title: text(link), name: str(name, CONFIG.nameMax), uid };
    }

    function findPerson(list, conv) {
        return list.find(p => conv.uid && p.uid === conv.uid)
            || list.find(p => !p.uid && conv.name && nameKey(p.name) === nameKey(conv.name)) || null;
    }

    function renderBar(bar, conv, all, shows) {
        const list = all[conv.adId] || [];
        const me = findPerson(list, conv);
        const note = adNote(conv.adId);
        const sig = JSON.stringify([conv.adId, conv.name, conv.uid, list, note]);
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
                }));
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

    function scanNachrichten() {
        const conv = readConversation();
        const old = document.querySelector('.kpw-in-bar');
        if (!conv) { if (old) old.remove(); return; }
        ensureStyle();
        let bar = old;
        if (!bar || bar.previousElementSibling !== conv.header) {
            if (bar) bar.remove();
            bar = el('div', { className: 'kpw-in kpw-in-bar', 'data-kpw-ui': '', role: 'region', 'aria-label': 'PowerSeller: Warteliste' });
            conv.header.after(bar);
        }
        const all = loadPeople();
        renderBar(bar, conv, all, noShows(all));
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
    scan();
})();
