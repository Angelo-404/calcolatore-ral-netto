# -*- coding: utf-8 -*-
"""
Integrity checks on src/data/mef-data.js.

Runs in CI after every automatic update: if a source changes format or
arrives broken, the pull request must not go unnoticed.
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data', 'mef-data.js')

MUNICIPAL_CAP = 1.20   # municipalities under a rebalancing plan
REGIONAL_CAP = 3.70    # legal maximum plus the deficit surcharges

errors = []


def check(condition, message):
    if not condition:
        errors.append(message)


text = io.open(DATA, encoding='utf-8').read()

# --- Regions ----------------------------------------------------------------
# One table per tax year: every year must have every region, and every
# region at least one bracket.
regional_raw = re.search(r'export const REGIONAL_RATES_BY_YEAR = (\{.*?\});\n', text, re.S)
check(regional_raw is not None, 'REGIONAL_RATES_BY_YEAR not found')
by_year = json.loads(regional_raw.group(1)) if regional_raw else {}
check(len(by_year) >= 2, 'expected at least two years of regional rates, found %d' % len(by_year))
for year, regions in sorted(by_year.items()):
    check(len(regions) == 21, '%s: expected 21 regions and autonomous provinces, found %d' % (year, len(regions)))
    rates = [r for brackets in regions.values() for r, _ in brackets]
    check(all(0 <= r <= REGIONAL_CAP for r in rates),
          '%s: regional rate out of range: max %.2f' % (year, max(rates) if rates else 0))
    check(all(len(brackets) > 0 for brackets in regions.values()), '%s: a region has no brackets' % year)

# --- Municipalities ---------------------------------------------------------
registry = re.search(r'export const MUNICIPALITY_REGISTRY = `(.*?)`;', text, re.S)
rates = re.search(r'export const MUNICIPALITY_RATES_2025 = `(.*?)`;', text, re.S)
check(registry is not None, 'MUNICIPALITY_REGISTRY not found')
check(rates is not None, 'MUNICIPALITY_RATES_2025 not found')

if registry and rates:
    registry_rows = [r for r in registry.group(1).split('\n') if r.strip()]
    rate_rows = [r for r in rates.group(1).split('\n') if r.strip()]
    check(len(registry_rows) == len(rate_rows),
          'registry and rates out of step: %d rows against %d' % (len(registry_rows), len(rate_rows)))
    check(len(registry_rows) > 7500, 'too few municipalities in the dataset: %d' % len(registry_rows))

    # Milan is the default municipality: it must be there with a plausible rule.
    # The values themselves are not pinned, or a legitimate change would fail.
    milan = next((i for i, r in enumerate(registry_rows) if r.startswith('F205|')), None)
    check(milan is not None, 'Milan missing from the registry')
    if milan is not None:
        exemption, spec = rate_rows[milan].split(';')
        check(0 <= int(exemption) <= 50000, 'implausible Milan exemption: %s' % exemption)
        check(spec != '0', 'Milan has no surcharge rate')

    out_of_range = []
    for row in rate_rows:
        _, spec = row.split(';')
        for piece in spec.split(','):
            value = piece.split(':')[0]
            try:
                if float(value) > MUNICIPAL_CAP:
                    out_of_range.append(value)
            except ValueError:
                errors.append('unreadable municipal rate: %r' % value)
    check(not out_of_range, 'municipal rates above the 1.20%% cap: %s' % sorted(set(out_of_range))[:5])

    # Bracket limits must grow: a repeated or falling limit means the source
    # labelled a band wrongly, and the rate of the next band would be applied
    # to the wrong incomes.
    diff = re.search(r'export const MUNICIPALITY_DIFF_2026 = `(.*?)`;', text, re.S)
    specs = [row.split(';')[1] for row in rate_rows]
    if diff:
        specs += [row.split('=', 1)[1].split(';')[1] for row in diff.group(1).split('\n') if '=' in row]
    not_increasing = []
    for spec in specs:
        caps = [float(piece.split(':')[1]) for piece in spec.split(',') if ':' in piece]
        if any(b <= a for a, b in zip(caps, caps[1:])):
            not_increasing.append(spec)
    check(not not_increasing, 'municipal bracket limits not increasing: %s' % not_increasing[:5])

# --- Outcome ----------------------------------------------------------------
if registry:
    print('Municipalities in the dataset : %d' % len([r for r in registry.group(1).split('\n') if r.strip()]))
for year, regions in sorted(by_year.items()):
    print('Regions in %s                : %d' % (year, len(regions)))

if errors:
    print('\nCheck FAILED:')
    for e in errors:
        print('  - %s' % e)
    sys.exit(1)

print('\nCheck passed: the dataset is consistent.')
