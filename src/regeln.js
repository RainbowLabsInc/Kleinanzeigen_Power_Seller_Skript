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
            re: /\b(sms-?code|bestaetigungscode|verifizierungscode|verifikationscode|einmalcode|freigabecode)\b|(?<!qr-)\bcode\b[^.!?]{0,40}\b(schick|send|nenn|mitteil|weiterleit|gib)|\b(schick|send|nenn|mitteil|weiterleit|gib)\w*\b[^.!?]{0,40}(?<!qr-)\bcode\b/,
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
        // Ergänzt 10/2026 nach Warnungen von Polizei und Verbraucherzentralen
        {
            id: 'qr-zahlung', level: 'hoch',
            label: 'Soll einen QR-Code scannen, um Geld zu bekommen oder zu bestätigen („Quishing“)',
            re: /\bqr(-?code\w*)?\b[^.!?]{0,80}\b(zahl\w*|geld|bestaetig\w*|erhalt\w*|empfang\w*|auszahl\w*|sicher bezahlen)|\b(zahl\w*|geld|bestaetig\w*|erhalt\w*|empfang\w*|auszahl\w*)\b[^.!?]{0,80}\bqr(-?code\w*)?\b/,
        },
        {
            id: 'qr', level: 'hinweis',
            label: 'Erwähnt einen QR-Code',
            re: /\bqr(-?code\w*)?\b/,
        },
        {
            id: 'verifizierung', level: 'hoch',
            label: 'Verlangt Geld für eine „Verifizierung“ oder Freischaltung',
            re: /\b(verifizierungs|freischalt|aktivierungs|bestaetigungs)(gebuehr|betrag|zahlung)\w*|\bverifizier\w*\b[^.!?]{0,60}\b(ueberweis\w*|zahl\w*|betrag|gebuehr\w*|euro)\b|\b(ueberweis\w*|zahl\w*)\b[^.!?]{0,60}\bverifizier\w*/,
        },
        {
            id: 'vorstrecken', level: 'hoch',
            label: 'Du sollst Kosten vorstrecken (Transport, Versand, Zoll)',
            re: /\b(transport|versand|speditions|zoll|versicherungs)\w*\b[^.!?]{0,60}\b(vorstreck\w*|auslegen|vorab (ueberweis|zahl|bezahl)\w*)|\b(vorstreck\w*|auslegen)\b[^.!?]{0,60}\b(transport|versand|spedition|zoll)\w*/,
        },
        {
            id: 'email', level: 'hinweis',
            label: 'Verweist auf eine E-Mail statt auf die Nachrichten bei Kleinanzeigen',
            re: /\b(schau|guck|pruef|check|oeffne)\w*\b[^.!?]{0,30}\b(dein|deine|ihr|ihre)\w*\b[^.!?]{0,15}\b(e-?mails?|postfach|posteingang|spam\w*)\b/,
        },
        {
            id: 'support', level: 'hinweis',
            label: 'Beruft sich auf einen „Kundenservice“ oder „Support“',
            re: /\b(kundenservice|kundendienst|kundensupport|support(-?(mitarbeiter|team|chat))?|kleinanzeigen-?(team|support))\b/,
        },
        {
            id: 'fehlgeschlagen', level: 'hinweis',
            label: 'Behauptet, die Zahlung sei fehlgeschlagen',
            re: /\bzahlung\w*\b[^.!?]{0,30}\b(fehlgeschlagen|abgelehnt|nicht durchgegangen|nicht moeglich)/,
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
    const LURE = /kleinanzeig|ebay|dhl|hermes|dpd|gls|ups|paypal|post|paket|versand|liefer|sicher|safe|secure|pay|zahlung|bezahl|kaeufer|verkaeufer|deal|transaktion|treuhand|verif|checkout|confirm|refund|erstatt/;

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
        // Der allgemeine QR-Hinweis entfällt, wenn schon die Warnung mit Zahlung greift
        if (hits.some(h => h.id === 'qr-zahlung')) hits.splice(hits.findIndex(h => h.id === 'qr'), 1);
        const links = linkHits(norm);
        hits.push(...links);
        let level = hits.some(h => h.level === 'hoch') ? 'hoch' : hits.length ? 'hinweis' : null;
        // Fremder Link plus eine weitere Auffälligkeit: das typische Muster der Maschen
        if (level === 'hinweis' && links.length && hits.length > links.length) level = 'hoch';
        return { level, hits };
    }

    return { normalize, check, RULES };
})();

if (typeof module === 'object' && module.exports) module.exports = KPW_REGELN; // @@NODE@@
