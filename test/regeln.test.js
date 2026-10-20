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
    // Ergänzt 10/2026
    ['Ich habe über Sicher bezahlen gezahlt. Scanne bitte den QR-Code, um die Zahlung zu bestätigen.', 'hoch', ['qr-zahlung']],
    ['Hier der QR-Code für den Geldempfang', 'hoch', ['qr-zahlung']],
    ['Kannst du mir den QR-Code fürs DHL-Etikett schicken?', 'hinweis', ['qr']],
    ['Für die Verifizierung deines Kontos musst du einmalig 50 Euro überweisen.', 'hoch', ['verifizierung']],
    ['Es fällt nur eine kleine Freischaltgebühr an.', 'hoch', ['verifizierung']],
    ['Die Spedition holt ab, die Transportkosten musst du bitte vorstrecken, bekommst du zurück.', 'hoch', ['vorstrecken', 'kurier']],
    ['Schau bitte in deine E-Mails, da ist die Zahlungsbestätigung.', 'hinweis', ['email']],
    ['Der Kundenservice hat mir gesagt, du musst die Zahlung bestätigen.', 'hinweis', ['support', 'geld']],
    ['Die Zahlung ist leider fehlgeschlagen, bitte gib deine Daten hier ein: kleinanzeigen-checkout.com/pay', 'hoch', ['fehlgeschlagen', 'link']],
    // Harmlos, darf nicht anschlagen
    ['Die Versandkosten übernehme ich gern.', null, []],
    ['Ich schaue morgen in meine E-Mails und melde mich.', null, []],
    ['Kann ich das Gerät vor Ort prüfen, bevor ich zahle?', null, []],
    ['Bezahlung bar bei Abholung, passt Samstag?', null, []],
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
