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
    await page.click('#reply');
    await page.click('.kpw-bs-btn');
    const names = await page.$$eval('.kpw-bs-name', ns => ns.map(n => n.textContent));
    assert.ok(names.includes('Noch da') && !names.includes('Privatverkauf'), `Nachrichten-Bausteine: ${names}`);
    await page.keyboard.press('2');
    assert.match(await page.$eval('#reply', t => t.value), /Preis ist leider fest/);

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

    assert.deepStrictEqual(errors, [], 'Fehler auf der Seite');
    await browser.close();
    console.log('browser: alle Schritte bestanden.');
})().catch(e => {
    console.error('✗', e.message);
    process.exit(1);
});
