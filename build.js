#!/usr/bin/env node
/*
 * Baut powerseller.user.js aus src/.
 *
 *   node build.js          bauen
 *   node build.js --check  nur prüfen, ob powerseller.user.js zum Quellstand passt (z. B. vor einem Commit)
 *
 * Aufbau wie beim Superscript: Kern (src/core.js), dann gemeinsame Helfer (LIBS), dann die
 * Module, jedes in KS.module(…) verpackt. So lassen sich die Module später auch ins
 * Superscript übernehmen. Ohne Abhängigkeiten, Node 18 oder neuer.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VERSION = '0.1.1';
const OUT = 'powerseller.user.js';
const REPO = 'https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript';

// Gemeinsame Helfer ohne Seitenzugriff, auch in Node testbar
const LIBS = ['src/regeln.js'];

const MODULES = [
    {
        id: 'bausteine',
        file: 'src/bausteine.js',
        label: 'Antwort-Bausteine',
        description: 'Button „Bausteine“ am Nachrichtenfeld: fertige Antworten mit Platzhaltern per Klick einfügen.',
    },
    {
        id: 'warnung',
        file: 'src/warnung.js',
        label: 'Betrugswarnung',
        description: 'Markiert Nachrichten mit typischen Maschen: falsche Bezahl- und Versandlinks, „Geld freigeben“, Kurier, Codes, Überzahlung.',
    },
];

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

// Zeilen mit // @@NODE@@ sind nur für die Tests und kommen nicht ins Userscript
const stripNode = (code) => code.split('\n').filter(l => !l.includes('// @@NODE@@')).join('\n');
const trim = (code) => code.replace(/^\s+/, '').replace(/\s+$/, '');

function build() {
    const meta = read('src/meta.js').replace(/@@VERSION@@/g, VERSION).replace(/@@REPO@@/g, REPO);
    const core = read('src/core.js').replace(/@@VERSION@@/g, VERSION).replace(/@@REPO@@/g, REPO);
    if (!core.includes('/* @@MODULES@@ */')) throw new Error('src/core.js: Platzhalter /* @@MODULES@@ */ fehlt');

    const line = '// ' + '='.repeat(72);
    const libs = LIBS.map(file => [line, `// Helfer: ${file}`, line, trim(stripNode(read(file)))].join('\n'));
    const parts = MODULES.map(m => {
        const info = { label: m.label, version: VERSION, description: m.description };
        return [
            line,
            `// Modul „${m.label}“: ${m.file}`,
            line,
            `KS.module(${JSON.stringify(m.id)}, ${JSON.stringify(info)}, function () {`,
            trim(stripNode(read(m.file))),
            '});',
        ].join('\n');
    });

    return meta + '\n' + core.replace('/* @@MODULES@@ */', () => [...libs, ...parts].join('\n\n'));
}

try {
    const out = build();
    const outPath = path.join(__dirname, OUT);
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
        if (current !== out) {
            console.error(`${OUT} ist veraltet. Bitte \`node build.js\` ausführen.`);
            process.exit(1);
        }
        console.log(`${OUT} ist aktuell.`);
    } else {
        fs.writeFileSync(outPath, out);
        console.log(`${OUT} gebaut (PowerSeller ${VERSION}, ${MODULES.map(m => m.id).join(', ')}).`);
    }
} catch (e) {
    console.error(e.message || e);
    process.exit(1);
}
