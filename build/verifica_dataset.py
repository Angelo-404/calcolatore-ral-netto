# -*- coding: utf-8 -*-
"""
Controlli di integrita' sul dataset incorporato in index.html.

Gira in CI dopo ogni aggiornamento automatico: se una fonte cambia formato
o arriva corrotta, la pull request non deve passare inosservata.
"""
import io
import os
import re
import sys

QUI = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(os.path.dirname(QUI), 'index.html')

TETTO_COMUNALE = 1.20   # comuni in piano di riequilibrio
TETTO_REGIONALE = 3.70  # massimo di legge piu' le maggiorazioni per disavanzo

errori = []
avvisi = []


def controlla(condizione, messaggio):
    if not condizione:
        errori.append(messaggio)


testo = io.open(INDEX, encoding='utf-8').read()

# --- Regioni ---------------------------------------------------------------
regioni_raw = re.search(r'const ADD_REGIONALI = (\{.*?\});', testo, re.S)
controlla(regioni_raw is not None, 'blocco ADD_REGIONALI non trovato')

if regioni_raw:
    nomi = re.findall(r'"([^"]+)":\[', regioni_raw.group(1))
    controlla(len(nomi) == 21, 'attese 21 regioni e province autonome, trovate %d' % len(nomi))
    controlla('Lombardia' in nomi, 'Lombardia assente dal dataset regionale')

    aliquote = [float(a) for a in re.findall(r'\[([\d.]+),', regioni_raw.group(1))]
    controlla(all(0 <= a <= TETTO_REGIONALE for a in aliquote),
              'aliquota regionale fuori scala: max %.2f' % (max(aliquote) if aliquote else 0))

    lombardia = re.search(r'"Lombardia":\[(.*?)\]\]', regioni_raw.group(1))
    if lombardia:
        valori = [float(a) for a in re.findall(r'\[([\d.]+),', lombardia.group(1) + ']')]
        controlla(valori[:1] == [1.23],
                  'la prima aliquota lombarda non e piu 1,23: %s' % valori[:1])

# --- Comuni ----------------------------------------------------------------
anagrafe = re.search(r'const COMUNI_ANAGRAFE = `(.*?)`;', testo, re.S)
tariffe = re.search(r'const COMUNI_TARIFFE_2025 = `(.*?)`;', testo, re.S)
controlla(anagrafe is not None, 'blocco COMUNI_ANAGRAFE non trovato')
controlla(tariffe is not None, 'blocco COMUNI_TARIFFE_2025 non trovato')

if anagrafe and tariffe:
    righe_anagrafe = [r for r in anagrafe.group(1).split('\n') if r.strip()]
    righe_tariffe = [r for r in tariffe.group(1).split('\n') if r.strip()]

    controlla(len(righe_anagrafe) == len(righe_tariffe),
              'anagrafe e tariffe disallineate: %d righe contro %d'
              % (len(righe_anagrafe), len(righe_tariffe)))
    controlla(len(righe_anagrafe) > 7500,
              'troppi pochi comuni nel dataset: %d' % len(righe_anagrafe))

    # Milano e' il territorio del profilo standard: deve restare coerente
    indice_milano = next((i for i, r in enumerate(righe_anagrafe) if r.startswith('F205|')), None)
    controlla(indice_milano is not None, 'Milano assente dall anagrafe')
    if indice_milano is not None:
        esenzione, spec = righe_tariffe[indice_milano].split(';')
        controlla(esenzione == '23000',
                  'la soglia di esenzione di Milano non e piu 23.000: %s' % esenzione)
        controlla(spec == '0.8',
                  'l aliquota di Milano non e piu 0,80%%: %s' % spec)

    # Nessuna aliquota oltre il massimo di legge
    fuori_scala = []
    for riga in righe_tariffe:
        _, spec = riga.split(';')
        for pezzo in spec.split(','):
            valore = pezzo.split(':')[0]
            try:
                if float(valore) > TETTO_COMUNALE:
                    fuori_scala.append(valore)
            except ValueError:
                errori.append('aliquota comunale illeggibile: %r' % valore)
    controlla(not fuori_scala,
              'aliquote comunali oltre il tetto dell 1,20%%: %s' % sorted(set(fuori_scala))[:5])

# --- Esito -----------------------------------------------------------------
if anagrafe:
    print('Comuni nel dataset      : %d' % len([r for r in anagrafe.group(1).split('\n') if r.strip()]))
if regioni_raw:
    print('Regioni e province aut. : %d' % len(re.findall(r'"([^"]+)":\[', regioni_raw.group(1))))

for a in avvisi:
    print('AVVISO: %s' % a)

if errori:
    print('\nVerifica FALLITA:')
    for e in errori:
        print('  - %s' % e)
    sys.exit(1)

print('\nVerifica superata: il dataset e integro.')
