# -*- coding: utf-8 -*-
"""
Legge i feed INPS di circolari e messaggi e segnala le pubblicazioni che
potrebbero incidere sul calcolo: esoneri, aliquote, massimali, imponibili.

Non interpreta le norme e non modifica il codice: si limita a dire "qui e'
cambiato qualcosa, guardaci". Codificare una regola nuova resta lavoro
umano, perche' gli esoneri cambiano struttura e non solo importi.

Scrive segnalazione.md ed espone l'output `trovate` per il workflow.
"""
import io
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

FEED = {
    'Circolari': 'https://www.inps.it/it/it.rss.circolari.xml',
    'Messaggi': 'https://www.inps.it/it/it.rss.messaggi.xml',
}

# Parole che indicano un possibile impatto sul motore di calcolo
CHIAVI = ('esoner', 'decontribuzion', 'sgravi', 'incentiv', 'aliquot',
          'massimal', 'minimal', 'imponibil', 'contribut', 'agevolazion')

# Termini che generano rumore: convenzioni per la riscossione di quote
# associative, che non toccano il calcolo
RUMORE = ('convenzione', 'associativi', 'sindacal')

GIORNI_OSSERVATI = 10


def scarica(url):
    richiesta = urllib.request.Request(url, headers={'User-Agent': 'calcolatore-ral-netto/1.0'})
    with urllib.request.urlopen(richiesta, timeout=60) as risposta:
        return risposta.read().decode('utf-8', errors='replace')


def voci(xml):
    for blocco in re.findall(r'<item>(.*?)</item>', xml, re.S):
        def campo(nome):
            m = re.search(r'<%s>(.*?)</%s>' % (nome, nome), blocco, re.S)
            if not m:
                return ''
            testo = re.sub(r'<[^>]+>', ' ', m.group(1))
            return re.sub(r'\s+', ' ', testo).strip()
        yield {
            'titolo': campo('title'),
            'oggetto': campo('description'),
            'link': campo('link'),
            'data': campo('pubdate') or campo('pubDate'),
        }


def rilevante(voce):
    testo = (voce['titolo'] + ' ' + voce['oggetto']).lower()
    if any(r in testo for r in RUMORE):
        return False
    return any(c in testo for c in CHIAVI)


def recente(voce, limite):
    # Le date del feed sono in formato RFC 822; senza parsing rigido si
    # accetta la voce, perche' e' meglio una segnalazione in piu' che una in meno.
    try:
        quando = datetime.strptime(voce['data'][:25].strip(), '%a, %d %b %Y %H:%M:%S')
        return quando.replace(tzinfo=timezone.utc) >= limite
    except Exception:
        return True


def main():
    limite = datetime.now(timezone.utc) - timedelta(days=GIORNI_OSSERVATI)
    trovate = []

    for nome, url in FEED.items():
        try:
            xml = scarica(url)
        except Exception as errore:
            print('Feed %s non raggiungibile: %s' % (nome, errore))
            continue
        for voce in voci(xml):
            if rilevante(voce) and recente(voce, limite):
                trovate.append((nome, voce))

    if not trovate:
        print('Nessuna pubblicazione rilevante negli ultimi %d giorni.' % GIORNI_OSSERVATI)
        scrivi_output('no')
        return 0

    righe = ['Il controllo automatico ha trovato pubblicazioni INPS che potrebbero incidere',
             'sul calcolo. **Non sono state applicate modifiche**: servono lettura e valutazione.',
             '',
             'Da verificare in particolare se cambiano gli esoneri codificati in `ESONERI`,',
             'le aliquote contributive o i massimali.',
             '']
    for nome, voce in trovate:
        righe.append('- **%s** — %s  ' % (nome, voce['titolo']))
        righe.append('  %s  ' % voce['oggetto'][:300])
        righe.append('  %s' % voce['link'])
    righe += ['', '---', '',
              'Dopo la verifica, aggiornare `verificatoIl` nelle voci interessate anche se',
              'nulla e\' cambiato: serve a distinguere un dato confermato da uno dimenticato.']

    io.open('segnalazione.md', 'w', encoding='utf-8').write('\n'.join(righe))
    print('Segnalate %d pubblicazioni.' % len(trovate))
    scrivi_output('si')
    return 0


def scrivi_output(valore):
    percorso = os.environ.get('GITHUB_OUTPUT')
    if percorso:
        with io.open(percorso, 'a', encoding='utf-8') as f:
            f.write('trovate=%s\n' % valore)


if __name__ == '__main__':
    raise SystemExit(main())
