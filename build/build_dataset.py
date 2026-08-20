# -*- coding: latin-1 -*-
"""
Costruisce il dataset delle addizionali IRPEF a partire dalle fonti ufficiali
del Dipartimento delle Finanze (MEF):
  - addcom2025.csv / addcom2026.csv : anagrafe delle delibere comunali
  - reg_NN.html                     : tabelle delle aliquote regionali
Output: dataset.js (frammento JavaScript da incorporare in index.html)
"""
import csv, re, glob, html, json, io, os, urllib.request

BASE_DF = 'https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale'
FONTI = {
    'addcom2025.csv': BASE_DF + '/addirpef_newDF/download/download.php?anno=2025',
    'addcom2026.csv': BASE_DF + '/addirpef_newDF/download/download.php?anno=2026',
}
for cod in ['%02d' % n for n in range(1, 22)]:
    FONTI['reg_%s.html' % cod] = BASE_DF + '/addregirpef/addregirpef.php?reg=' + cod


def scarica_fonti():
    """Scarica dal MEF i file mancanti. I file gia presenti non vengono toccati:
    per rigenerare il dataset su una nuova annualita, cancellarli."""
    for nome, url in FONTI.items():
        if os.path.exists(nome):
            continue
        print('scarico', nome, '...')
        with urllib.request.urlopen(url, timeout=60) as risposta:
            open(nome, 'wb').write(risposta.read())


scarica_fonti()

NUM = re.compile(r'[\d]+(?:[.,]\d+)?')

def to_num(s):
    """Converte '1.234,56' / ',8' / '0,38' in float."""
    s = (s or '').strip().replace('*', '')
    if not s:
        return None
    s = s.replace('.', '').replace(',', '.')
    if s.startswith('.'):
        s = '0' + s
    try:
        return float(s)
    except ValueError:
        return None

def euro(s):
    """Estrae un importo in euro da un testo di fascia."""
    m = re.findall(r'([\d]{1,3}(?:\.\d{3})*(?:,\d+)?)', s)
    if not m:
        return None
    return to_num(m[-1])

# ---------------------------------------------------------------- COMUNI
def parse_comuni(path):
    out = {}
    with open(path, encoding='latin-1') as f:
        r = csv.reader(f, delimiter=';')
        next(r)
        for row in r:
            if len(row) < 34:
                row = row + [''] * (34 - len(row))
            cod, nome, pr = row[0].strip(), row[1].strip(), row[2].strip()
            if not cod:
                continue

            deliberato = False
            esenzione = 0.0
            flat = None
            scaglioni = []   # (aliquota, tetto|None)

            for i in range(8, 32, 2):
                raw_a, fascia = row[i].strip(), row[i + 1].strip()
                if not raw_a and not fascia:
                    continue
                if '*' in raw_a:          # 0* = nessuna delibera per l'anno
                    continue
                a = to_num(raw_a)
                if a is None:
                    continue
                deliberato = True
                f_low = fascia.lower()

                if 'esenzione' in f_low:
                    # Alcune delibere esentano categorie che non sono lavoratori
                    # dipendenti: pensionati, lavoro autonomo o impresa, compensi
                    # sportivi. Applicarle a un dipendente sarebbe un errore.
                    altre_categorie = any(x in f_low for x in
                                          ('pension', 'autonom', 'impresa', 'sportiv', 'assegni periodic'))
                    per_dipendenti = 'dipendent' in f_low or 'assimilat' in f_low
                    if altre_categorie and not per_dipendenti:
                        continue
                    v = euro(fascia)
                    if v:
                        esenzione = max(esenzione, v)
                elif 'unica' in f_low or fascia == '':
                    if a > 0:
                        flat = a
                elif 'oltre' in f_low and 'fino' not in f_low:
                    scaglioni.append((a, None))
                elif 'fino' in f_low and ('da euro' in f_low or ' da ' in f_low or ' a euro' in f_low):
                    scaglioni.append((a, euro(fascia)))
                elif 'fino' in f_low:
                    scaglioni.append((a, euro(fascia)))
                else:
                    if a > 0 and flat is None and not scaglioni:
                        flat = a

            if not deliberato:
                continue

            if scaglioni:
                # ordina per tetto crescente, il bracket "oltre" va in fondo
                scaglioni.sort(key=lambda t: (t[1] is None, t[1] or 0))
                spec = ','.join(
                    ('%g' % a) + (':%d' % int(c) if c else '')
                    for a, c in scaglioni
                )
            elif flat is not None:
                spec = '%g' % flat
            else:
                spec = '0'

            out[cod] = (nome, pr, int(esenzione), spec)
    return out

c25 = parse_comuni('addcom2025.csv')
c26 = parse_comuni('addcom2026.csv')

# Anagrafe completa: serve anche il nome dei comuni senza delibera
anagrafe = {}
for path in ('addcom2026.csv', 'addcom2025.csv'):
    with open(path, encoding='latin-1') as f:
        r = csv.reader(f, delimiter=';')
        next(r)
        for row in r:
            if row and row[0].strip():
                anagrafe.setdefault(row[0].strip(), (row[1].strip(), row[2].strip()))

# Merge: la delibera 2026 prevale; in sua assenza resta in vigore quella 2025.
# Encoding compatto: l'anagrafe è scritta una volta sola e le tariffe sono
# posizionali; il 2026 è memorizzato come diff sul 2025.
anag, tar2025, diff2026 = [], [], []
righe_2025, righe_2026 = [], []
stat = {'con_delibera_2026': 0, 'ereditati_2025': 0, 'senza_delibera': 0}

for idx, (cod, (nome, pr)) in enumerate(sorted(anagrafe.items(), key=lambda kv: kv[1][0])):
    d25 = c25.get(cod)
    d26 = c26.get(cod)

    r25 = d25 if d25 else (nome, pr, 0, '0')
    if d26:
        r26 = d26
        stat['con_delibera_2026'] += 1
    elif d25:
        r26 = d25
        stat['ereditati_2025'] += 1
    else:
        r26 = (nome, pr, 0, '0')
        stat['senza_delibera'] += 1

    anag.append('%s|%s|%s' % (cod, nome, pr))
    t25 = '%d;%s' % (r25[2], r25[3])
    t26 = '%d;%s' % (r26[2], r26[3])
    tar2025.append(t25)
    if t26 != t25:
        diff2026.append('%d=%s' % (idx, t26))

    righe_2025.append('%s|%s|%s|%d|%s' % (cod, r25[0], r25[1], r25[2], r25[3]))
    righe_2026.append('%s|%s|%s|%d|%s' % (cod, r26[0], r26[1], r26[2], r26[3]))

# ---------------------------------------------------------------- REGIONI
NOMI = {
    '01': 'Abruzzo', '02': 'Basilicata', '03': 'Bolzano', '04': 'Calabria',
    '05': 'Campania', '06': 'Emilia-Romagna', '07': 'Friuli-Venezia Giulia',
    '08': 'Lazio', '09': 'Liguria', '10': 'Lombardia', '11': 'Marche',
    '12': 'Molise', '13': 'Piemonte', '14': 'Puglia', '15': 'Sardegna',
    '16': 'Sicilia', '17': 'Toscana', '18': 'Trento', '19': 'Umbria',
    '20': "Valle d'Aosta", '21': 'Veneto'
}

regioni = {}
for cod, nome in sorted(NOMI.items()):
    t = open('reg_%s.html' % cod, encoding='latin-1').read()
    tabella = ''
    for tb in re.findall(r'<table.*?</table>', t, flags=re.S):
        txt = html.unescape(re.sub(r'<[^>]+>', '|', tb))
        txt = re.sub(r'\s+', ' ', re.sub(r'\|+', '|', txt))
        if 'liquot' in txt:
            tabella = txt

    # Le tabelle regionali del MEF usano il punto come separatore decimale
    # ("1.23", "15000.00"), a differenza del CSV comunale che usa la virgola.
    def num_dot(s):
        m = re.match(r'^\d+(?:\.\d+)?$', s.strip())
        return float(s) if m else None

    def tetto_dot(s):
        m = re.findall(r'(\d+(?:\.\d+)?)\s*euro', s)
        return float(m[-1]) if m else None

    celle = [c.strip() for c in tabella.split('|') if c.strip()]
    scaglioni = []
    i = 0
    while i < len(celle) - 1:
        a = num_dot(celle[i])
        if a is not None:
            f = celle[i + 1].lower()
            if 'unica' in f or ('oltre' in f and 'fino' not in f):
                scaglioni.append([a, None])
            else:
                scaglioni.append([a, tetto_dot(f)])
            i += 2
        else:
            i += 1

    scaglioni.sort(key=lambda t: (t[1] is None, t[1] or 0))
    regioni[nome] = scaglioni

# ---------------------------------------------------------------- OUTPUT
def js_regioni(d):
    parti = []
    for nome, sc in sorted(d.items()):
        s = ','.join('[%g,%s]' % (a, int(c) if c else 'null') for a, c in sc)
        parti.append('%s:[%s]' % (json.dumps(nome, ensure_ascii=False), s))
    return '{' + ','.join(parti) + '}'

with io.open('dataset.js', 'w', encoding='utf-8') as f:
    f.write('/* Fonte: MEF - Dipartimento delle Finanze. Generato da build_dataset.py */\n')
    f.write('const ADD_REGIONALI = %s;\n\n' % js_regioni(regioni))
    f.write('const COMUNI_ANAGRAFE = `%s`;\n\n' % '\n'.join(anag))
    f.write('const COMUNI_TARIFFE_2025 = `%s`;\n\n' % '\n'.join(tar2025))
    f.write('const COMUNI_DIFF_2026 = `%s`;\n' % '\n'.join(diff2026))

# ---------------------------------------------------------------- REPORT
print('comuni in anagrafe      :', len(anagrafe))
print('con delibera 2026       :', stat['con_delibera_2026'])
print('ereditano il 2025       :', stat['ereditati_2025'])
print('senza alcuna delibera   :', stat['senza_delibera'])
print('regioni/province aut.   :', len(regioni))
print()
for k in ('Lombardia', 'Lazio', 'Campania', 'Friuli-Venezia Giulia', 'Molise'):
    print('%-24s %s' % (k, regioni[k]))
print()
for cod in ('F205', 'H501', 'L219', 'F839'):
    r = [x for x in righe_2026 if x.startswith(cod + '|')]
    print('2026', r[0] if r else '(assente)')
    r = [x for x in righe_2025 if x.startswith(cod + '|')]
    print('2025', r[0] if r else '(assente)')
import os
print()
print('dataset.js:', round(os.path.getsize('dataset.js') / 1024, 1), 'KB')
