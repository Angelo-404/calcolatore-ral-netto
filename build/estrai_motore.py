"""Estrae il motore di calcolo da index.html e lo rende un modulo Node.

Serve a rieseguire gli stessi calcoli fuori dal browser senza modificare una
riga del codice: il taglio cade prima del primo accesso al DOM, quindi cio'
che resta sono soltanto costanti, funzioni pure e orchestratori. Se il file
cambiasse struttura lo script si ferma, invece di produrre un modulo monco.

    python build/estrai_motore.py
    node -e "const m=require('./build/motore_estratto.js'); console.log(m.calcolaBase(30000).nettoAnnuo)"
"""
import io
import re
import sys

SORGENTE = 'index.html'
USCITA = 'build/motore_estratto.js'
PRIMO_DOM = "const el = (id) => document.getElementById(id);"
ESPORTAZIONI = ('calcolaBase', 'calcolaPremium', 'calcolaAutonomo', 'invertiNetto',
                'COSTANTI', 'ANNI', 'COMUNI', 'REGIONI', 'PROFILI_CONTRIBUTIVI',
                'GESTIONI_PREVIDENZIALI')

pagina = io.open(SORGENTE, encoding='utf-8').read()
blocchi = re.findall(r'<script>(.*?)</script>', pagina, re.S)
if not blocchi:
    sys.exit('Nessun blocco <script> trovato in %s.' % SORGENTE)

script = blocchi[-1]
if PRIMO_DOM not in script:
    sys.exit("Punto di taglio non trovato: index.html e' cambiato, aggiorna PRIMO_DOM.")

motore = script[:script.index(PRIMO_DOM)]
mancanti = [nome for nome in ESPORTAZIONI if nome not in motore]
if mancanti:
    sys.exit('Simboli non presenti prima del taglio: %s' % ', '.join(mancanti))

motore += '\nmodule.exports = { %s };\n' % ', '.join(ESPORTAZIONI)
io.open(USCITA, 'w', encoding='utf-8').write(motore)
print('%s scritto: %d KB, %d simboli esportati'
      % (USCITA, len(motore.encode('utf-8')) / 1024, len(ESPORTAZIONI)))
