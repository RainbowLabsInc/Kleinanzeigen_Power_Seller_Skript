#!/usr/bin/env node
/*
 * Tests für src/regeln.js (Betrugswarnung). Ohne Abhängigkeiten: node test/regeln.test.js
 */

'use strict';

const assert = require('assert');
const R = require('../src/regeln.js');

const cases = [
    // [Text, erwartete Stufe, erwartete Regel-IDs (Teilmenge)]
    ['Hallo, ist das noch da? Würde morgen abholen.', null, []],
    ['Was ist letzte Preis?', null, []],
    ['Kann ich mit PayPal Freunde zahlen?', null, []],
    ['Siehe kleinanzeigen.de/s-anzeige/rad/123', null, []],
    ['Handy ist ohne PIN-Sperre?', null, []],
    ['Ich habe über Sicher bezahlen gezahlt. Um das Geld zu erhalten, klicke hier: https://kleinanzeigen-sicher.de/zahlung/8812', 'hoch', ['geld', 'link']],
    ['Mein Kurier holt den Artikel ab, bitte bestätige die Zahlung unter dhl-versand.info/abc', 'hoch', ['kurier', 'geld', 'link']],
    ['Bitte gib deine Kartendaten ein, damit die Auszahlung klappt', 'hoch', ['karte']],
    ['Du bekommst gleich eine SMS, schick mir bitte den Code', 'hoch', ['code']],
    ['Ich habe aus Versehen 200 € zu viel überwiesen, bitte die Differenz zurück', 'hoch', ['ueberzahlung']],
    ['Schreib mir lieber auf WhatsApp', 'hinweis', ['extern']],
    ['Eine Spedition holt das Sofa ab.', 'hinweis', ['kurier']],
    ['Schau mal hier: www.beispiel-shop.com', 'hinweis', ['link']],
    ['Sendungsverfolgung: https://www.dhl.de/de/privatkunden.html', 'hinweis', ['link']],
    ['Link: https://xn--kleinanzeign-xyz.com/pay', 'hoch', ['link']],
    ['Kontakt per WhatsApp, Bezahlung hier: zahlung-schnell.top', 'hoch', ['extern', 'link']],
];

let failed = 0;
for (const [text, level, ids] of cases) {
    const res = R.check(text);
    const got = res.hits.map(h => h.id);
    try {
        assert.strictEqual(res.level, level, `Stufe für „${text}“`);
        for (const id of ids) assert.ok(got.includes(id), `Regel ${id} fehlt für „${text}“ (gefunden: ${got.join(', ') || 'keine'})`);
        if (!ids.length) assert.deepStrictEqual(got, [], `unerwartete Treffer für „${text}“: ${got.join(', ')}`);
    } catch (e) {
        failed++;
        console.error('✗', e.message);
    }
}

assert.strictEqual(R.normalize('  Größe  Übergabe '), 'groesse uebergabe');

if (failed) {
    console.error(`${failed} von ${cases.length} Fällen fehlgeschlagen.`);
    process.exit(1);
}
console.log(`regeln: alle ${cases.length} Fälle bestanden.`);
