# -*- coding: utf-8 -*-
"""
Read the INPS feeds of circulars and messages and flag publications that
may affect the calculation: hiring exemptions, rates, ceilings, taxable bases.

It does not interpret the law and does not change the code: it only says
"something changed here, look at it". Encoding a new rule stays human work,
because exemptions change structure, not only amounts.

Writes report.md and exposes the `found` output for the workflow. Exits
with an error when no feed can be read, so a dead source does not look like
a quiet week.
"""
import io
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

FEEDS = {
    'Circolari': 'https://www.inps.it/it/it.rss.circolari.xml',
    'Messaggi': 'https://www.inps.it/it/it.rss.messaggi.xml',
}

# Words that point to a possible effect on the engine
KEYWORDS = ('esoner', 'decontribuzion', 'sgravi', 'incentiv', 'aliquot',
            'massimal', 'minimal', 'imponibil', 'contribut', 'agevolazion')

# Noise: agreements for collecting union dues, which do not touch the calculation
NOISE = ('convenzione', 'associativi', 'sindacal')

DAYS_WATCHED = 10


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'calcolatore-ral-netto/1.0'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode('utf-8', errors='replace')


def items(xml):
    for block in re.findall(r'<item>(.*?)</item>', xml, re.S):
        def field(name):
            m = re.search(r'<%s>(.*?)</%s>' % (name, name), block, re.S)
            if not m:
                return ''
            text = re.sub(r'<[^>]+>', ' ', m.group(1))
            return re.sub(r'\s+', ' ', text).strip()
        yield {
            'title': field('title'),
            'subject': field('description'),
            'link': field('link'),
            'date': field('pubdate') or field('pubDate'),
        }


def relevant(item):
    text = (item['title'] + ' ' + item['subject']).lower()
    if any(n in text for n in NOISE):
        return False
    return any(k in text for k in KEYWORDS)


def recent(item, limit):
    # Feed dates are RFC 822; without strict parsing the item is kept,
    # because one report too many is better than one too few.
    try:
        when = datetime.strptime(item['date'][:25].strip(), '%a, %d %b %Y %H:%M:%S')
        return when.replace(tzinfo=timezone.utc) >= limit
    except Exception:
        return True


def write_output(value):
    path = os.environ.get('GITHUB_OUTPUT')
    if path:
        with io.open(path, 'a', encoding='utf-8') as f:
            f.write('found=%s\n' % value)


def main():
    limit = datetime.now(timezone.utc) - timedelta(days=DAYS_WATCHED)
    found = []
    readable = 0
    for name, url in FEEDS.items():
        try:
            xml = fetch(url)
            readable += 1
        except Exception as error:
            print('Feed %s unreachable: %s' % (name, error))
            continue
        for item in items(xml):
            if relevant(item) and recent(item, limit):
                found.append((name, item))

    if readable == 0:
        print('No INPS feed could be read.')
        return 1

    if not found:
        print('No relevant publication in the last %d days.' % DAYS_WATCHED)
        write_output('no')
        return 0

    # The report is read by Angelo on GitHub: it stays in Italian.
    lines = ['Il controllo automatico ha trovato pubblicazioni INPS che potrebbero incidere',
             'sul calcolo. **Non sono state applicate modifiche**: servono lettura e valutazione.',
             '',
             'Da verificare in particolare se cambiano gli esoneri codificati in `HIRING_EXEMPTIONS`',
             '(`src/engine/hiring-exemptions.js`), le aliquote contributive o i massimali.',
             '']
    for name, item in found:
        lines.append('- **%s** — %s  ' % (name, item['title']))
        lines.append('  %s  ' % item['subject'][:300])
        lines.append('  %s' % item['link'])
    lines += ['', '---', '',
              'Dopo la verifica, aggiornare `verifiedOn` nelle voci interessate anche se',
              'nulla è cambiato: serve a distinguere un dato confermato da uno dimenticato.']
    io.open('report.md', 'w', encoding='utf-8').write('\n'.join(lines))
    print('Flagged %d publications.' % len(found))
    write_output('yes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
