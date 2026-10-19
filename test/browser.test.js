#!/usr/bin/env node
/*
 * Browser-Test an nachgebauten Seiten (test/fixtures/). Braucht Playwright mit Chromium:
 *
 *   node test/browser.test.js
 *
 * Playwright wird nicht mitgeliefert. Ist es nicht installiert, wird der Test übersprungen
 * (z. B. `npm i -g playwright && npx playwright install chromium`, dann NODE_PATH setzen).
 * Die Seiten werden unter ihrer echten Adresse ausgeliefert, damit das Script dort startet.
 * Ohne Tampermonkey speichert das Script im localStorage.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch (e) {
    console.log('browser: übersprungen, Playwright ist nicht installiert.');
    process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'powerseller.user.js'), 'utf8');
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const NACHRICHTEN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Nachrichten</title></head><body>
<header><input id="site-search-query"></header><main><div id="thread">
<div class="msg"><span>Hallo, ist das noch da?</span></div>
<div class="msg"><span>Um das Geld zu erhalten, klicke hier: https://kleinanzeigen-sicher.de/zahlung/8812</span></div>
<div class="msg"><p>Schreib mir lieber auf WhatsApp.</p></div>
</div><textarea id="reply"></textarea></main></body></html>`;

const pad = (n) => String(n).padStart(2, '0');
const day = (ago) => { const d = new Date(); d.setDate(d.getDate() - ago); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const short = (ago) => { const d = new Date(); d.setDate(d.getDate() - ago); return `${d.getDate()}.${d.getMonth() + 1}.`; };

(async () => {
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const pages = {
        '/m-nachrichten.html': NACHRICHTEN,
        '/m-meine-anzeigen.html': fixture('meine-anzeigen.html'),
        '/p-anzeige-aufgeben-schritt2.html': fixture('anzeige-aufgeben.html'),
    };
    await page.route('https://www.kleinanzeigen.de/**', r => {
        const body = pages[new URL(r.request().url()).pathname];
        return body ? r.fulfill({ contentType: 'text/html; charset=utf-8', body }) : r.fulfill({ status: 404, body: '' });
    });
    const open = async (p) => {
        await page.goto('https://www.kleinanzeigen.de' + p);
        await page.addScriptTag({ content: SCRIPT });
        await page.waitForTimeout(500);
    };
    const step = (name) => console.log('·', name);

    // --- Nachrichten
    step('Nachrichten: Warnungen und Bausteine');
    await open('/m-nachrichten.html');
    assert.deepStrictEqual(await page.$$eval('.kpw-warn', ns => ns.map(n => n.dataset.level)), ['hoch', 'hinweis']);
    assert.strictEqual(await page.$eval('html', n => n.dataset.kpwTheme), 'rainbow', 'Regenbogen ist voreingestellt');
    await page.click('#reply');
    await page.click('.kpw-bs-btn');
    const names = await page.$$eval('.kpw-bs-name', ns => ns.map(n => n.textContent));
    assert.ok(names.includes('Noch da') && !names.includes('Privatverkauf'), `Nachrichten-Bausteine: ${names}`);
    await page.keyboard.press('2');
    assert.match(await page.$eval('#reply', t => t.value), /ist leider fest/);

    // --- Anzeige aufgeben, mit Bausteinen aus 0.1 (ohne „wo“), die ergänzt werden
    step('Anzeige aufgeben: Bausteine für Anzeigentexte, Ergänzung alter Listen');
    await page.evaluate(() => {
        localStorage.setItem('kpw-bausteine', JSON.stringify([{ id: 'a', name: 'Eigener', text: 'Mein Text' }]));
        localStorage.removeItem('kpw-bausteine-v');
    });
    await open('/p-anzeige-aufgeben-schritt2.html');
    await page.click('#ad-description');
    await page.keyboard.press('End');
    await page.click('.kpw-bs-btn');
    assert.deepStrictEqual(await page.$$eval('.kpw-bs-name', ns => ns.map(n => n.textContent)), ['Privatverkauf', 'Versand & Abholung']);
    await page.click('.kpw-bs-item >> nth=0');
    assert.strictEqual(await page.$eval('#ad-description', t => t.value),
        '4 Winterreifen auf Stahlfelgen, 6 mm Profil.\n\nPrivatverkauf, daher keine Garantie, Gewährleistung oder Rücknahme.');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-bausteine')));
    assert.deepStrictEqual(stored.map(x => [x.name, x.wo]), [['Eigener', 'nachricht'], ['Privatverkauf', 'anzeige'], ['Versand & Abholung', 'anzeige']]);
    assert.ok(!(await page.$('#ad-title + .kpw-bs-btn')), 'kein Button am Titel');

    // --- Meine Anzeigen: erster Besuch
    step('Meine Anzeigen: erster Besuch');
    await page.evaluate(() => localStorage.removeItem('kpw-anzeigen'));
    await open('/m-meine-anzeigen.html');
    assert.deepStrictEqual(await page.$$eval('.kpw-ma-delta', ns => ns.map(n => n.textContent)), ['Verlauf ab heute', 'Verlauf ab heute', 'Verlauf ab heute']);
    assert.match(await page.$eval('.kpw-ma-sum', n => n.textContent), /3 Anzeigen auf dieser Seite · 1\.174 Besucher · 23 mal gemerkt · Summe der Preise 230 €/);
    const ads = await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-anzeigen')));
    assert.deepStrictEqual(ads['1000000002'].hist, [[day(0), 1034, 17]]);
    assert.strictEqual(ads['1000000001'].title, 'Bosch Turbinenhäcksler AXT 25 TC');
    assert.strictEqual(ads['1000000001'].price, '80 € VB');

    // --- Meine Anzeigen: mit Verlauf aus früheren Tagen
    step('Meine Anzeigen: Verlauf, Ladenhüter, Notiz');
    await page.evaluate(([d9, d1]) => {
        const ads = JSON.parse(localStorage.getItem('kpw-anzeigen'));
        ads['1000000001'].hist = [[d9, 90, 4], [d1, 100, 5]];
        ads['1000000003'].hist = [[d9, 12, 0]];
        localStorage.setItem('kpw-anzeigen', JSON.stringify(ads));
    }, [day(9), day(1)]);
    await open('/m-meine-anzeigen.html');
    const deltas = await page.$$eval('.kpw-ma-delta', ns => ns.map(n => n.textContent));
    assert.deepStrictEqual(deltas, [`+28 Besucher, +1 gemerkt seit ${short(1)}`, 'Verlauf ab heute', `Keine neuen Besucher seit ${short(9)}`]);
    assert.deepStrictEqual(await page.$$eval('.kpw-ma-stale', ns => ns.length), 1);
    assert.match(await page.$eval('.kpw-ma-sum', n => n.textContent), /\(\+28 neu\).*1 ohne neue Besucher seit 7 Tagen/);
    await page.click('.kpw-ma-delta >> nth=0');
    await page.waitForTimeout(100);
    assert.deepStrictEqual(await page.$$eval('.kpw-ma-hist tbody tr', rs => rs.length), 3);
    await page.click('li[data-adid="1000000002"] .kpw-ma-link');
    await page.fill('li[data-adid="1000000002"] .kpw-ma-edit input', 'Keller, Regal 2');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.$eval('li[data-adid="1000000002"] .kpw-ma-note-text', n => n.textContent), '📝 Keller, Regal 2');
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-anzeigen'))['1000000002'].note), 'Keller, Regal 2');
    assert.ok(!(await page.$$eval('.kpw-ma, .kpw-ma-sum', ns => ns.some(n => /null|undefined/.test(n.textContent)))), 'kein „null“ in der Anzeige');

    step('Meine Anzeigen: „Bald Online“ ist kein Ladenhüter');
    await page.evaluate(([d9]) => {
        const ads = JSON.parse(localStorage.getItem('kpw-anzeigen'));
        ads['1000000002'].hist = [[d9, 1034, 17]];
        ads['1000000001'].note = 'Regal 3, EK 20 €';
        localStorage.setItem('kpw-anzeigen', JSON.stringify(ads));
    }, [day(9)]);
    await open('/m-meine-anzeigen.html');
    assert.deepStrictEqual(await page.$$eval('.kpw-ma-stale', ns => ns.map(n => n.closest('li[data-adid]').dataset.adid)), ['1000000003']);

    // --- Verkaufsbuch
    step('Verkaufsbuch: Verkauf an der Anzeige');
    const card1 = 'li[data-adid="1000000001"]';
    await page.click(`${card1} .kpw-vb button`);
    const form = `${card1} .kpw-vb-form`;
    assert.deepStrictEqual(await page.$$eval(`${form} input`, ns => ns.map(n => n.value)), ['80', day(0), '20', '']);
    await page.fill(`${form} input >> nth=0`, '');
    await page.click(`${form} button[type=submit]`);
    assert.match(await page.$eval(`${form} .kpw-vb-error`, n => n.textContent), /Endpreis/);
    await page.fill(`${form} input >> nth=0`, '75');
    await page.selectOption(`${form} select >> nth=0`, 'kleinanzeigen');
    await page.click(`${form} button[type=submit]`);
    await page.waitForTimeout(100);
    assert.strictEqual(await page.$eval(`${card1} .kpw-vb-sold`, n => n.textContent),
        `✓ Verkauft am ${short(0)}${new Date().getFullYear()} für 75 € (Über Kleinanzeigen bezahlt, Abholung)`);
    const sale = await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-verkaeufe'))[0]);
    assert.deepStrictEqual([sale.adId, sale.price, sale.ek, sale.pay, sale.date], ['1000000001', 75, 20, 'kleinanzeigen', day(0)]);
    assert.match(sale.url, /^https:\/\/www\.kleinanzeigen\.de\/s-anzeige\/beispiel\/1000000001/);
    assert.strictEqual(await page.$eval(`${card1} .kpw-vb-row:last-child button`, n => n.textContent), 'Noch eins verkauft …');

    step('Verkaufsbuch: Übersicht und Verkauf ohne Anzeige');
    await page.click('.kpw-vb-bar button');
    const stats = () => page.$$eval('.kpw-book .kpw-stat b', ns => ns.map(n => n.textContent));
    assert.deepStrictEqual(await stats(), ['1', '75 €', '55 €']);
    assert.match(await page.$eval('.kpw-book .kpw-limit', n => n.textContent), /1 Verkauf, 75 €.*1 von 30 Verkäufen.*75 € von 2\.000 €/);
    await page.click('.kpw-book .ks-action >> text=Verkauf ohne Anzeige');
    await page.fill('.kpw-book .kpw-vb-form input >> nth=0', 'Bücherkiste');
    await page.fill('.kpw-book .kpw-vb-form input >> nth=1', '12,50');
    await page.keyboard.press('Escape');
    assert.ok(await page.$('.kpw-book'), 'Esc im Formular lässt das Verkaufsbuch offen');
    await page.click('.kpw-book .ks-action >> text=Verkauf ohne Anzeige');
    await page.fill('.kpw-book .kpw-vb-form input >> nth=0', 'Bücherkiste');
    await page.fill('.kpw-book .kpw-vb-form input >> nth=1', '12,50');
    await page.click('.kpw-book .kpw-vb-form button[type=submit]');
    assert.deepStrictEqual(await stats(), ['2', '87,50 €', '55 €']);
    assert.strictEqual(await page.$$eval('.kpw-book tbody tr', rs => rs.length), 3); // 1 Monat + 2 Verkäufe
    if (process.env.SHOT_BOOK) await page.screenshot({ path: process.env.SHOT_BOOK });
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$('.kpw-book')), 'Esc schließt das Verkaufsbuch');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

    // --- Interessenten
    step('Interessenten: Warteliste, Status, nicht erschienen');
    await open('/m-meine-anzeigen.html');
    const card2 = 'li[data-adid="1000000002"] .kpw-in';
    const addPerson = async (card, name, note) => {
        await page.fill(`${card} .kpw-in-add input >> nth=0`, name);
        await page.fill(`${card} .kpw-in-add input >> nth=1`, note);
        await page.press(`${card} .kpw-in-add input >> nth=1`, 'Enter');
        await page.waitForTimeout(50);
    };
    assert.strictEqual(await page.$eval(`${card2} .kpw-in-head button`, n => n.textContent), '+ Interessent');
    await page.click(`${card2} .kpw-in-head button`);
    await addPerson(card2, 'Tina', 'bietet 140 €');
    await addPerson(card2, 'Max', '');
    const head2 = () => page.$eval(`${card2} .kpw-in-head`, n => n.textContent);
    assert.match(await head2(), /Interessenten: 2.*Als Nächstes: Tina/);
    await page.selectOption(`${card2} .kpw-in-row >> nth=0 >> select`, 'reserviert');
    await page.waitForTimeout(50);
    assert.match(await head2(), /Reserviert für Tina/);
    assert.doesNotMatch(await head2(), /Als Nächstes/);
    await page.selectOption(`${card2} .kpw-in-row >> nth=0 >> select`, 'noshow');
    await page.waitForTimeout(50);
    assert.match(await head2(), /Interessenten: 2 \(1 offen\).*Als Nächstes: Max/);
    await page.click(`${card2} .kpw-in-row >> nth=1 >> button[aria-label="Nach oben"]`);
    await page.waitForTimeout(50);
    assert.deepStrictEqual(await page.$$eval(`${card2} .kpw-in-name`, ns => ns.map(n => n.textContent)), ['Max', 'Tina']);
    const card3 = 'li[data-adid="1000000003"] .kpw-in';
    await page.click(`${card3} .kpw-in-head button`);
    await addPerson(card3, 'tina', '');
    assert.strictEqual(await page.$eval(`${card3} .kpw-in-warn`, n => n.textContent), '⚠ Ist schon einmal nicht erschienen');
    const people = await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-interessenten')));
    assert.deepStrictEqual(people['1000000002'].map(p => [p.name, p.status, p.note]), [['Max', 'wartet', ''], ['Tina', 'noshow', 'bietet 140 €']]);

    // --- Echte Nachrichtenseite (Nachbau)
    step('Nachrichten (Nachbau): Warnung nur bei Nachrichten des Gegenübers');
    pages['/m-nachrichten.html'] = fixture('nachrichten.html');
    await open('/m-nachrichten.html');
    assert.strictEqual(await page.$$eval('.kpw-warn', ns => ns.length), 0, 'kein Fehlalarm bei Sicherheitshinweis und eigenen Nachrichten');
    await page.evaluate(() => {
        const li = document.querySelector('.MessageList li').cloneNode(true);
        li.querySelectorAll('[data-testid="INBOUND"] .whitespace-pre-wrap').forEach(n => {
            n.textContent = 'Mein Kurier holt ab. Bitte bestätige die Zahlung unter kleinanzeigen-sicher.de/zahlung';
        });
        document.querySelector('.MessageList').append(li);
    });
    await page.waitForTimeout(600);
    assert.deepStrictEqual(await page.$$eval('.kpw-warn', ns => ns.map(n => n.dataset.level)), ['hoch']);
    assert.ok(await page.$eval('.kpw-warn', n => !!n.previousElementSibling.matches('[data-testid="INBOUND"]')), 'Warnung direkt unter der Nachricht');

    step('Nachrichten (Nachbau): Bausteine im echten Nachrichtenfeld');
    await page.click('#nachricht');
    await page.click('.kpw-bs-btn');
    await page.keyboard.press('1');
    assert.strictEqual(await page.$eval('#nachricht', t => t.value), 'Mein Text'); // erster Baustein (seit dem Schritt „Anzeige aufgeben“)

    step('Nachrichten (Nachbau): Leiste mit Notiz und Warteliste');
    const bar = '.kpw-in-bar';
    assert.ok(await page.$eval(bar, n => n.previousElementSibling.tagName === 'HEADER'), 'Leiste unter dem Kopf der Unterhaltung');
    assert.match(await page.$eval(bar, n => n.textContent), /📝 Regal 3, EK 20 €/);
    assert.strictEqual(await page.$eval(`${bar} .kpw-in-addbtn`, n => n.textContent), '+ Käufer Kai auf die Warteliste');
    await page.click(`${bar} .kpw-in-addbtn`);
    await page.waitForTimeout(50);
    assert.match(await page.$eval(bar, n => n.textContent), /Als Nächstes: Käufer Kai.*Käufer Kai: Platz 1 von 1/);
    await page.selectOption(`${bar} select`, 'reserviert');
    await page.fill(`${bar} input`, 'kommt Sa 10 Uhr');
    await page.press(`${bar} input`, 'Enter');
    await page.waitForTimeout(50);
    const kai = await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-interessenten'))['1000000001'][0]);
    assert.deepStrictEqual([kai.name, kai.uid, kai.status, kai.note], ['Käufer Kai', '100000001', 'reserviert', 'kommt Sa 10 Uhr']);
    assert.match(await page.$eval(bar, n => n.textContent), /Reserviert für Käufer Kai/);
    await open('/m-meine-anzeigen.html');
    assert.match(await page.$eval('li[data-adid="1000000001"] .kpw-in-head', n => n.textContent), /Reserviert für Käufer Kai/);

    // --- 0.5
    step('Bausteine: {Name}, {Titel}, {Preis} aus Unterhaltung und Formular');
    await page.evaluate(() => {
        localStorage.setItem('kpw-bausteine', JSON.stringify([
            { id: 'n', name: 'Gruß', text: 'Hallo {Name}, {Titel} kostet {Preis}.', wo: 'nachricht' },
            { id: 'a', name: 'Angebot', text: 'Biete {Titel} für {Preis}.', wo: 'anzeige' }]));
        localStorage.setItem('kpw-bausteine-v', '2');
    });
    await open('/m-nachrichten.html');
    await page.fill('#nachricht', '');
    await page.click('#nachricht');
    await page.click('.kpw-bs-btn');
    await page.keyboard.press('1');
    assert.strictEqual(await page.$eval('#nachricht', t => t.value), 'Hallo Käufer Kai, Bosch Turbinenhäcksler AXT 25 TC kostet 80 € VB.');
    await open('/p-anzeige-aufgeben-schritt2.html');
    await page.fill('#ad-description', '');
    await page.click('#ad-description');
    await page.click('.kpw-bs-btn');
    await page.keyboard.press('1');
    assert.strictEqual(await page.$eval('#ad-description', t => t.value), 'Biete Winterreifen 205/55 R16 für 150 €.');

    step('Interessenten: Kennzeichen in der Liste der Unterhaltungen');
    await open('/m-nachrichten.html');
    assert.deepStrictEqual(await page.$$eval('.ConversationListItem .kpw-in-badge', ns => ns.map(n => [n.textContent, n.dataset.status])), [['Reserviert', 'reserviert']]);

    step('Interessenten: „Gekauft“ ins Verkaufsbuch');
    await page.selectOption('.kpw-in-bar select', 'gekauft');
    await page.waitForTimeout(50);
    assert.strictEqual(await page.$eval('.ConversationListItem .kpw-in-badge', n => n.textContent), 'Gekauft');
    await page.click('.kpw-in-bar .kpw-in-sale');
    const bookForm = '.kpw-book .kpw-vb-form';
    await page.waitForSelector(bookForm);
    assert.deepStrictEqual(await page.$$eval(`${bookForm} input`, ns => ns.map(n => n.value)).then(v => [v[0], v[1], v[3], v[4]]),
        ['Bosch Turbinenhäcksler AXT 25 TC', '80', '20', 'Käufer: Käufer Kai']); // EK aus der Notiz „EK 20 €“
    await page.click(`${bookForm} button[type=submit]`);
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.ok(!(await page.$('.kpw-in-bar .kpw-in-sale')), 'Button verschwindet nach dem Eintrag');
    const sale2 = await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-verkaeufe')).find(s => s.note === 'Käufer: Käufer Kai'));
    assert.deepStrictEqual([sale2.adId, sale2.price, sale2.url], ['1000000001', 80, 'https://www.kleinanzeigen.de/zur-anzeige/1000000001']);

    step('Datensicherung: herunterladen, einspielen mit Vorschau');
    const openSettings = async () => {
        await page.click('#nachricht');
        await page.click('.kpw-bs-btn');
        await page.click('.kpw-bs-foot button');
        await page.waitForSelector('.ks-panel');
    };
    await openSettings();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.ks-panel .ks-action >> text=Sicherung herunterladen')]);
    assert.match(download.suggestedFilename(), /^powerseller-sicherung-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.strictEqual(backup.format, 'kleinanzeigen-powerseller-backup');
    assert.strictEqual(backup.data['kpw-verkaeufe'].length, 3);
    assert.ok(backup.data['kpw-interessenten'] && backup.data['kpw-anzeigen'] && backup.data['kpw-bausteine']);
    assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-backup')))).last > 0, 'Zeitpunkt der Sicherung gemerkt');
    await page.evaluate(() => localStorage.setItem('kpw-verkaeufe', '[]'));
    await page.setInputFiles('.ks-panel input[data-kpw-restore]',
        { name: 'kaputt.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"etwas anderes"}') });
    assert.match(await page.$eval('.ks-panel .ks-note[data-kind="error"]', n => n.textContent), /keine Sicherung des PowerSellers/);
    await page.setInputFiles('.ks-panel input[data-kpw-restore]',
        { name: 'sicherung.json', mimeType: 'application/json', buffer: fs.readFileSync(await download.path()) });
    const preview = await page.$$eval('.kpw-restore tbody tr', rs => rs.map(r => [...r.children].map(c => c.textContent)));
    assert.deepStrictEqual(preview.find(r => r[0] === 'Verkäufe'), ['Verkäufe', '3', '0']);
    await page.click('.kpw-restore .ks-action >> text=Übernehmen');
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-verkaeufe')).length), 3);
    assert.match(await page.$eval('.ks-panel .ks-note[data-kind="ok"]', n => n.textContent), /Sicherung übernommen/);
    await page.keyboard.press('Escape');

    step('Datensicherung: Erinnerung nach 30 Tagen');
    await page.evaluate(() => localStorage.setItem('kpw-backup', JSON.stringify({ since: Date.now() - 40 * 864e5 })));
    await open('/m-nachrichten.html');
    await page.waitForSelector('.kpw-remind', { timeout: 5000 });
    assert.match(await page.$eval('.kpw-remind', n => n.textContent), /noch nicht gesichert/);
    await page.click('.kpw-remind button >> text=Später');
    assert.ok(!(await page.$('.kpw-remind')));
    assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('kpw-backup')))).snooze > Date.now() + 6 * 864e5);

    assert.deepStrictEqual(errors, [], 'Fehler auf der Seite');
    await browser.close();
    console.log('browser: alle Schritte bestanden.');
})().catch(e => {
    console.error('✗', e.message);
    process.exit(1);
});
