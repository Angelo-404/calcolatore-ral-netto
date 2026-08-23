# -*- coding: utf-8 -*-
"""
Riporta dentro index.html il dataset territoriale rigenerato dalle fonti MEF.

Uso:
    python build/aggiorna_index.py            # scarica, ricostruisce, aggiorna
    python build/aggiorna_index.py --verifica # non scrive, dice solo se e' cambiato

Esce con codice 0 se il file e' gia' allineato, 10 se e' stato aggiornato.
Questo permette al workflow di committare solo quando qualcosa e' davvero
cambiato nelle delibere pubblicate dal Dipartimento delle Finanze.
"""
import datetime
import io
import os
import re
import subprocess
import sys

QUI = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(os.path.dirname(QUI), 'index.html')
README = os.path.join(os.path.dirname(QUI), 'README.md')
DATASET = os.path.join(QUI, 'dataset.js')

INIZIO = '/* === INIZIO DATI MEF: rigenerato da build/aggiorna_index.py === */'
FINE = '/* === FINE DATI MEF === */'


def rigenera_dataset():
    """Riscarica le fonti mancanti e ricostruisce dataset.js."""
    for nome in os.listdir(QUI):
        if nome.startswith('addcom') or nome.startswith('reg_'):
            os.remove(os.path.join(QUI, nome))   # forza il riscarico
    esito = subprocess.run([sys.executable, os.path.join(QUI, 'build_dataset.py')],
                           cwd=QUI, capture_output=True, text=True)
    if esito.returncode != 0:
        sys.stderr.write(esito.stdout + esito.stderr)
        raise SystemExit('build_dataset.py ha fallito')
    return esito.stdout


def blocco_nuovo():
    dataset = io.open(DATASET, encoding='utf-8').read()
    # scarta l'intestazione generata: la sostituiamo con la nostra
    dataset = re.sub(r'^/\* Fonte:.*?\*/\n', '', dataset, flags=re.S)
    oggi = datetime.date.today().isoformat()
    return (INIZIO + '\n'
            + 'const DATASET_AGGIORNATO = "%s";\n\n' % oggi
            + '/* Fonte: MEF - Dipartimento delle Finanze, anagrafe delle delibere. */\n'
            + dataset.strip() + '\n'
            + FINE)


def conta_comuni():
    """Quanti comuni contiene il dataset appena ricostruito."""
    dataset = io.open(DATASET, encoding='utf-8').read()
    anagrafe = re.search(r'const COMUNI_ANAGRAFE = `(.*?)`;', dataset, re.S)
    if not anagrafe:
        raise SystemExit("Anagrafe non trovata in dataset.js: formato cambiato.")
    return len(anagrafe.group(1).strip().splitlines())


def allinea_conteggio(quanti):
    """Riporta il numero dei comuni nella documentazione.

    La pagina lo legge dal dataset a ogni caricamento, quindi non puo'
    sbagliarlo. Il README invece e' testo: senza questo passo continuerebbe a
    citare il conteggio del giorno in cui e' stato scritto, e i comuni si
    fondono. Si riscrive solo il numero, non le frasi che lo contengono.
    """
    formattato = '{:,}'.format(quanti).replace(',', '.')
    testo = io.open(README, encoding='utf-8').read()
    nuovo = re.sub(r'\b\d{1,2}\.\d{3} comuni\b', formattato + ' comuni', testo)
    if nuovo == testo:
        return False
    io.open(README, 'w', encoding='utf-8').write(nuovo)
    return True


def main():
    solo_verifica = '--verifica' in sys.argv

    report = rigenera_dataset()
    print(report)

    testo = io.open(INDEX, encoding='utf-8').read()
    a = testo.index(INIZIO)
    b = testo.index(FINE) + len(FINE)

    attuale = testo[a:b]
    nuovo = blocco_nuovo()

    # Il confronto ignora la data: cambia a ogni esecuzione e non e' un
    # aggiornamento normativo.
    senza_data = lambda s: re.sub(r'const DATASET_AGGIORNATO = "[^"]*";', '', s)

    if senza_data(attuale) == senza_data(nuovo):
        print('Dataset gia allineato: nessuna delibera nuova.')
        return 0

    if solo_verifica:
        print('Il dataset e cambiato: serve un aggiornamento.')
        return 10

    io.open(INDEX, 'w', encoding='utf-8').write(testo[:a] + nuovo + testo[b:])
    print('index.html aggiornato con le nuove delibere.')
    if allinea_conteggio(conta_comuni()):
        print('README.md riallineato: il numero dei comuni e cambiato.')
    return 10


if __name__ == '__main__':
    raise SystemExit(main())
