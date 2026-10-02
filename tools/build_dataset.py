# -*- coding: utf-8 -*-
"""
Build src/data/mef-data.js from the official sources of the Italian Ministry of
Economy and Finance (MEF, Dipartimento delle Finanze):
  - addcomYYYY.csv          municipal surcharge resolutions, one file per year
  - reg_NN_YYYY.html        regional surcharge rates, one page per region and year

Usage:
    python tools/build_dataset.py            # use cached sources, rebuild if needed
    python tools/build_dataset.py --refresh  # download the sources again first
    python tools/build_dataset.py --check    # do not write, only say if it changed

Exit code 0 when the data module is already up to date, 10 when it changed
(or would change, with --check). The data workflow uses it to open a pull
request only when the MEF has published something new.
"""
import csv
import datetime
import html
import io
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
OUTPUT = os.path.join(ROOT, 'src', 'data', 'mef-data.js')
README = os.path.join(ROOT, 'README.md')

MEF = 'https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale'
# 2024 is only a fallback: where the 2025 resolution is missing or was adopted
# after the deadline, the rates of the previous year stay in force.
MUNICIPAL_YEARS = ('2024', '2025', '2026')
# Regional rates change from one year to the next (Puglia, Piemonte and
# Emilia-Romagna between 2025 and 2026): every tax year has its own page.
REGIONAL_YEARS = ('2025', '2026')

SOURCES = {'addcom%s.csv' % y: MEF + '/nuova_addcomirpef/download/download.php?anno=' + y
           for y in MUNICIPAL_YEARS}
for year in REGIONAL_YEARS:
    for code in ['%02d' % n for n in range(1, 22)]:
        SOURCES['reg_%s_%s.html' % (code, year)] = MEF + '/addregirpef/addregirpef.php?reg=%s&anno=%s' % (code, year)

REGION_NAMES = {
    '01': 'Abruzzo', '02': 'Basilicata', '03': 'Bolzano', '04': 'Calabria',
    '05': 'Campania', '06': 'Emilia-Romagna', '07': 'Friuli-Venezia Giulia',
    '08': 'Lazio', '09': 'Liguria', '10': 'Lombardia', '11': 'Marche',
    '12': 'Molise', '13': 'Piemonte', '14': 'Puglia', '15': 'Sardegna',
    '16': 'Sicilia', '17': 'Toscana', '18': 'Trento', '19': 'Umbria',
    '20': "Valle d'Aosta", '21': 'Veneto'
}


def cached(name):
    return os.path.join(CACHE, name)


def download_sources(refresh):
    """Download the missing sources. Files already in the cache are kept
    unless --refresh asks for a fresh copy."""
    os.makedirs(CACHE, exist_ok=True)
    for name, url in SOURCES.items():
        if os.path.exists(cached(name)) and not refresh:
            continue
        print('downloading', name, '...')
        request = urllib.request.Request(url, headers={'User-Agent': 'calcolatore-ral-netto/1.0'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
        if name.endswith('.csv') and not data.startswith(b'CODICE_CATASTALE'):
            raise SystemExit('Unexpected content for %s: the MEF format or address has changed.' % name)
        open(cached(name), 'wb').write(data)


# ------------------------------------------------------------- numbers
def to_number(s):
    """'1.234,56' / ',8' / '0,38' -> float."""
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


# Amounts in the MEF file come in many shapes: "15.000,00", "15000",
# "28.000,000", "15000.00", sometimes after a badly encoded euro sign.
AMOUNT = re.compile(r'\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+\.\d{2}(?!\d)|\d+(?:,\d+)?')

# Legal references and dates inside exemption texts: without removing them
# "D.P.R. n. 917" became an exemption up to 917 euro.
CITATIONS = re.compile(
    r'\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}\.\d{1,2}\.\d{4}'
    r'|\b(?:art|artt|n|nn|comma|commi|lett|legge|l|d\.?p\.?r|d\.?lgs|t\.?u\.?i\.?r)\.?\s*\d+(?:[/\-]\d+)?'
    r'|\b\d+\s*/\s*\d{4}\b',
    re.I)

# Exemptions that do not concern an ordinary employee: other categories
# (pensioners, self-employed) or conditions the calculator does not ask
# about (disability, family composition, ISEE).
OTHER_CATEGORIES = ('pension', 'autonom', 'impresa', 'sportiv', 'assegni periodic')
# Conditions that exclude the ordinary employee even when the text mentions
# employees: age, social security benefits, family, disability, ISEE.
CONDITIONS = ('handicap', 'disabil', 'invalid', 'accompagnamento', 'nucleo', 'famigli', 'familiar', 'figli',
              'anziani', 'isee', 'sessantacinq', 'ultrasessant', 'compimento', 'anno di et', 'anni di et',
              'cassa integrazione', 'cassa-integrazione', 'mobilit', 'disoccupazion')


def amount(s):
    """Like to_number, but also reads a decimal point ("15000.00")."""
    if re.match(r'^\d+\.\d{2}$', s):
        return float(s)
    return to_number(s)


def amounts(text):
    return [amount(m) for m in AMOUNT.findall(CITATIONS.sub(' ', text))]


def exemption_threshold(text):
    """The threshold is the amount after the word euro; otherwise the largest
    plausible amount in the text (some rows only say "15.000")."""
    clean = CITATIONS.sub(' ', text)
    after_euro = re.search(r'euro\s*(' + AMOUNT.pattern + ')', clean, re.I)
    if after_euro:
        return amount(after_euro.group(1))
    values = [v for v in amounts(text) if v is not None and v >= 1000]
    return max(values) if values else None


def bracket_cap(text):
    """Upper limit of a bracket, None when the bracket is the last one."""
    t = text.lower()
    values = [v for v in amounts(text) if v is not None]
    if not values:
        return None
    if len(values) >= 2:
        return values[-1]
    # A single amount: "fino a X" closes the bracket, "oltre X" and "da X" open the last one.
    if 'oltre' in t or ('da' in t.split() and 'fino' not in t):
        return None
    return values[0]


# --------------------------------------------------------- municipalities
# Municipal brackets follow the IRPEF brackets of the year. When the MEF file
# labels a band with the same upper limit as the band before it (it happened
# in 2026 for Airuno and Bentivoglio: «da 15.000,01 fino a 28.000» written
# where «da 28.000,01 fino a 50.000» was meant), the band is moved to the next
# IRPEF limit and the repair is printed, so that it can be checked by hand.
IRPEF_LIMITS = (15000, 28000, 50000)
REPAIRS = []


def repair_duplicate_caps(brackets, code, name):
    fixed = []
    for rate, cap in brackets:
        previous = fixed[-1][1] if fixed else None
        if cap is not None and previous is not None and cap <= previous:
            following = [limit for limit in IRPEF_LIMITS if limit > previous]
            if following:
                REPAIRS.append('%s %s: band %g%% up to %d moved up to %d' % (code, name, rate, cap, following[0]))
                cap = following[0]
        fixed.append((rate, cap))
    return fixed


def read_municipalities(path):
    out = {}
    with open(path, encoding='latin-1') as f:
        rows = csv.reader(f, delimiter=';')
        next(rows)
        for row in rows:
            if len(row) < 34:
                row = row + [''] * (34 - len(row))
            code, name, province = row[0].strip(), row[1].strip(), row[2].strip()
            if not code:
                continue
            # A resolution adopted after the deadline does not apply to the
            # year: for the MEF the previous rates stay in force.
            if 'INAPPLICABIL' in row[6].upper():
                continue

            resolved = False
            exemption = to_number(row[33]) or 0.0
            flat = None
            brackets = []   # (rate, cap or None)

            for i in range(8, 32, 2):
                raw_rate, band = row[i].strip(), row[i + 1].strip()
                if not raw_rate and not band:
                    continue
                if '*' in raw_rate:          # 0* = no resolution for the year
                    continue
                rate = to_number(raw_rate)
                if rate is None:
                    continue
                resolved = True
                low = band.lower()

                if 'esenzione' in low:
                    for_employees = 'dipendent' in low
                    other = any(x in low for x in OTHER_CATEGORIES)
                    generic = 'imponibil' in low or 'complessiv' in low or 'irpef' in low
                    if other and not for_employees:
                        continue
                    if any(x in low for x in CONDITIONS):
                        continue
                    if not for_employees and not generic and amounts(band) == []:
                        continue
                    value = exemption_threshold(band)
                    if value:
                        exemption = max(exemption, value)
                elif 'unica' in low or band == '':
                    if rate > 0:
                        flat = rate
                elif amounts(band):
                    brackets.append((rate, bracket_cap(band)))
                else:
                    if rate > 0 and flat is None and not brackets:
                        flat = rate

            if not resolved:
                continue

            if brackets:
                # by increasing cap, the open bracket last
                brackets.sort(key=lambda b: (b[1] is None, b[1] or 0))
                brackets = repair_duplicate_caps(brackets, code, name)
                spec = ','.join(('%g' % r) + (':%d' % int(c) if c else '') for r, c in brackets)
            elif flat is not None:
                spec = '%g' % flat
            else:
                spec = '0'

            out[code] = (name, province, int(exemption), spec)
    return out


# --------------------------------------------------------------- regions
def read_region(path):
    page = open(path, encoding='latin-1').read()
    table = ''
    for tb in re.findall(r'<table.*?</table>', page, flags=re.S):
        txt = html.unescape(re.sub(r'<[^>]+>', '|', tb))
        txt = re.sub(r'\s+', ' ', re.sub(r'\|+', '|', txt))
        if 'liquot' in txt:
            table = txt

    # The regional MEF tables use a decimal point ("1.23", "15000.00"),
    # unlike the municipal CSV, which uses a comma.
    def dot_number(s):
        return float(s) if re.match(r'^\d+(?:\.\d+)?$', s.strip()) else None

    def dot_cap(s):
        m = re.findall(r'(\d+(?:\.\d+)?)\s*euro', s)
        return float(m[-1]) if m else None

    cells = [c.strip() for c in table.split('|') if c.strip()]
    brackets = []
    i = 0
    while i < len(cells) - 1:
        rate = dot_number(cells[i])
        if rate is not None:
            band = cells[i + 1].lower()
            if 'unica' in band or ('oltre' in band and 'fino' not in band):
                brackets.append([rate, None])
            else:
                brackets.append([rate, dot_cap(band)])
            i += 2
        else:
            i += 1
    brackets.sort(key=lambda b: (b[1] is None, b[1] or 0))
    return brackets


def regions_js(regions):
    parts = []
    for name, brackets in sorted(regions.items()):
        s = ','.join('[%g,%s]' % (r, int(c) if c else 'null') for r, c in brackets)
        parts.append('%s:[%s]' % (json.dumps(name, ensure_ascii=False), s))
    return '{' + ','.join(parts) + '}'


# ----------------------------------------------------------------- build
def build():
    by_year = {y: read_municipalities(cached('addcom%s.csv' % y)) for y in MUNICIPAL_YEARS}
    m24, m25, m26 = by_year['2024'], by_year['2025'], by_year['2026']

    # Full registry: municipalities without a resolution need a name too.
    registry = {}
    for path in ('addcom2026.csv', 'addcom2025.csv'):
        with open(cached(path), encoding='latin-1') as f:
            rows = csv.reader(f, delimiter=';')
            next(rows)
            for row in rows:
                if row and row[0].strip():
                    registry.setdefault(row[0].strip(), (row[1].strip(), row[2].strip()))

    # Merge: the 2026 resolution wins; without one, the 2025 rates stay in
    # force. Compact encoding: the registry is written once, the rates by
    # position, and 2026 as a diff over 2025.
    names, rates2025, diff2026, resolved2026 = [], [], [], []
    stats = {'resolved_2026': 0, 'inherited': 0, 'none': 0}
    for idx, (code, (name, province)) in enumerate(sorted(registry.items(), key=lambda kv: kv[1][0])):
        r25 = m25.get(code) or m24.get(code) or (name, province, 0, '0')
        if code in m26:
            r26 = m26[code]
            stats['resolved_2026'] += 1
            resolved2026.append(idx)
        elif code in m25 or code in m24:
            r26 = r25
            stats['inherited'] += 1
        else:
            r26 = (name, province, 0, '0')
            stats['none'] += 1
        names.append('%s|%s|%s' % (code, name, province))
        t25 = '%d;%s' % (r25[2], r25[3])
        t26 = '%d;%s' % (r26[2], r26[3])
        rates2025.append(t25)
        if t26 != t25:
            diff2026.append('%d=%s' % (idx, t26))

    regional = {y: {name: read_region(cached('reg_%s_%s.html' % (code, y)))
                    for code, name in sorted(REGION_NAMES.items())} for y in REGIONAL_YEARS}

    body = ('export const REGIONAL_RATES_BY_YEAR = {%s};\n\n' % ','.join(
                '"%s":%s' % (y, regions_js(regional[y])) for y in REGIONAL_YEARS)
            + 'export const MUNICIPALITY_REGISTRY = `%s`;\n\n' % '\n'.join(names)
            + 'export const MUNICIPALITY_RATES_2025 = `%s`;\n\n' % '\n'.join(rates2025)
            + 'export const MUNICIPALITY_DIFF_2026 = `%s`;\n\n' % '\n'.join(diff2026)
            # Positions of the municipalities with a 2026 resolution, even when it
            # only confirms the 2025 rates: the page must not say they have none.
            + 'export const MUNICIPALITIES_RESOLVED_2026 = "%s";\n' % ','.join(str(i) for i in resolved2026))
    print('municipalities in registry :', len(registry))
    print('with a 2026 resolution     :', stats['resolved_2026'])
    print('inheriting earlier rates   :', stats['inherited'])
    print('without any resolution     :', stats['none'])
    for repair in REPAIRS:
        print('repaired source label      :', repair)
    for name in ('Lombardia', 'Lazio', 'Campania', 'Friuli-Venezia Giulia', 'Molise'):
        print('%-26s %s' % (name, regional[REGIONAL_YEARS[-1]][name]))
    return body, len(registry)


HEADER = ('/* Generated by tools/build_dataset.py from the MEF sources (Dipartimento delle\n'
          '   Finanze: municipal resolutions and regional rates). Do not edit by hand. */\n')


def main():
    refresh = '--refresh' in sys.argv
    check = '--check' in sys.argv
    download_sources(refresh)
    body, count = build()

    current = io.open(OUTPUT, encoding='utf-8').read() if os.path.exists(OUTPUT) else ''
    # The date is not a change in the data: compare without it.
    without_date = lambda s: re.sub(r'export const DATASET_UPDATED = "[^"]*";\n\n', '', s)
    new = HEADER + 'export const DATASET_UPDATED = "%s";\n\n' % datetime.date.today().isoformat() + body
    if without_date(current) == without_date(new):
        print('Data already up to date: no new resolutions.')
        return 0
    if check:
        print('The data changed: an update is needed.')
        return 10
    io.open(OUTPUT, 'w', encoding='utf-8', newline='\n').write(new)
    print('src/data/mef-data.js updated.')
    sync_readme_count(count)
    return 10


def sync_readme_count(count):
    """Keep the number of municipalities quoted in the README in step."""
    if not os.path.exists(README):
        return
    formatted = '{:,}'.format(count).replace(',', '.')
    text = io.open(README, encoding='utf-8').read()
    updated = re.sub(r'\b\d{1,2}\.\d{3} comuni\b', formatted + ' comuni', text)
    if updated != text:
        io.open(README, 'w', encoding='utf-8').write(updated)
        print('README.md: number of municipalities updated.')


if __name__ == '__main__':
    raise SystemExit(main())
