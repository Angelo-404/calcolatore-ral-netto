# Calcolatore RAL → Netto

Calcola lo stipendio netto, mensile e annuo, a partire dalla RAL, e il percorso inverso: quale RAL serve per arrivare
a una cifra netta. Una seconda scheda fa lo stesso conto per chi lavora con partita IVA, in regime ordinario o
forfettario. Le regole sono quelle del 2025 e del 2026; le addizionali regionali e comunali vengono dai dati ufficiali
del Ministero dell'Economia e delle Finanze per tutti i 7.897 comuni italiani.

Online: <https://calcolatore-ral-netto.vercel.app/>

Il risultato è una **stima a scopo informativo**. Non è una consulenza fiscale, del lavoro o previdenziale e non
sostituisce il cedolino né il parere di un professionista.

## Che cosa calcola

**Dipendente.** Dalla RAL al netto, passando per contributi INPS, IRPEF, detrazioni, taglio del cuneo fiscale,
trattamento integrativo e addizionali. Si possono indicare il tipo di contratto (tempo indeterminato o determinato,
apprendistato, collaborazione, tirocinio), il settore, l'inquadramento e la dimensione dell'azienda, la durata del
rapporto e il part-time, i carichi di famiglia, il comune di residenza, il welfare (fringe benefit e buoni pasto), il
premio di risultato, gli aumenti 2026 da rinnovo del contratto nazionale, le maggiorazioni per lavoro notturno, festivo e a turni, la previdenza complementare, i regimi
agevolati (impatriati, ricercatori, frontalieri) e gli esoneri contributivi all'assunzione. Ogni voce del dettaglio
ha un pulsante «i» che mostra il conto fatto sui numeri della simulazione.

**Dal netto alla RAL.** Trova la RAL più bassa che produce il netto richiesto. Dove la legge crea un salto (per
esempio quando scatta il trattamento integrativo) lo dice, invece di dare un numero che non esiste.

**Partita IVA.** Regime ordinario e forfettario al 15% o al 5%, con la Gestione separata INPS o le gestioni artigiani e
commercianti, i coefficienti di redditività per codice ATECO e la riduzione contributiva del 35% per i forfettari.
Mostra il confronto fra i tre regimi per lo stesso fatturato, senza verificare se si hanno i requisiti per accedervi.

**Per chi assume.** Costo azienda, confronto fra due scenari e un calcolo di come cambia il costo se parte del valore
arriva come welfare esente. Sono confronti di calcolo, non indicazioni su come impostare una retribuzione.

## Fonti

Aliquote e soglie sono prese da leggi, circolari e dati pubblicati da enti ufficiali, citati qui sotto; i dati comunali
e regionali sono quelli del MEF, con le correzioni descritte nei limiti. Le fonti principali:

| Regola | Fonte |
|---|---|
| Scaglioni IRPEF: 23 / 35 / 43% nel 2025, 23 / 33 / 43% dal 2026 | TUIR, art. 11; L. 207/2024; L. 199/2025, art. 1, c. 3 |
| Detrazione per lavoro dipendente, pavimento sui rapporti brevi, correttivo di 65 € | TUIR, art. 13 |
| Detrazioni per carichi di famiglia (figli al 50% fra i genitori salvo accordo o coniuge a carico) | TUIR, art. 12 |
| Taglio del cuneo fiscale: somma esente fino a 20.000 € e ulteriore detrazione fino a 40.000 € | L. 207/2024, art. 1, c. 4-9; Agenzia delle Entrate, circolare 4/E del 16/05/2025 |
| Trattamento integrativo e taglio di 75 € ai fini della capienza | D.L. 3/2020; L. 207/2024, art. 1, c. 3; circolare 4/E/2025 |
| Addizionali dovute solo se è dovuta l'IRPEF netta | D.Lgs. 446/1997, art. 50; D.Lgs. 360/1998, art. 1, c. 4 |
| Addizionali regionali per anno, con le «disposizioni particolari» | MEF, Dipartimento delle Finanze, pagine delle aliquote regionali per anno |
| Addizionali comunali | MEF, Dipartimento delle Finanze, anagrafe delle delibere (file per anno) |
| Contributi, massimale 122.295 €, prima fascia 56.224 €, aliquota aggiuntiva 1% | INPS, circolare n. 6/2026; art. 3-ter D.L. 384/1992 |
| Aliquote per settore, qualifica e dimensione | Tabelle INPS delle aliquote contributive, edizione 2026 |
| Gestione separata e gestioni artigiani e commercianti, 2025 e 2026 | INPS, circolari n. 27 e 38 del 2025, n. 8 e 14 del 2026 |
| Fringe benefit 1.000 € (2.000 € con figli a carico) | TUIR, art. 51, c. 3; L. 207/2024, art. 1, c. 390 |
| Buoni pasto esenti | TUIR, art. 51, c. 2, lett. c); L. 199/2025, art. 1, c. 14 |
| Premio di risultato | L. 208/2015, art. 1, c. 182-189; L. 199/2025, art. 1, c. 9 |
| Maggiorazioni per notturno, festivo e turni al 15% entro 1.500 € (solo 2026) | L. 199/2025, art. 1, c. 10-11 |
| Detrazione per lavoro autonomo (con i 50 € del comma 5-ter) | TUIR, art. 13, c. 5 e 5-ter |
| Regime forfettario e coefficienti di redditività | L. 190/2014, art. 1, c. 54-89; tabella dei coefficienti nell'allegato 2 alla L. 145/2018 |
| Impatriati e ricercatori | D.Lgs. 209/2023, art. 5; D.L. 78/2010, art. 44 |
| Previdenza complementare deducibile fino a 5.164,57 € (5.300 € dal 2026), Previndai compreso | D.Lgs. 252/2005, art. 8, c. 4; L. 199/2025, art. 1, c. 201; Previndai, pagina «Contribuzione» |
| Aumenti da rinnovo contrattuale 2026 al 5% | L. 199/2025, art. 1, c. 7; Agenzia delle Entrate, circolare 2/E del 24/02/2026 |

La data dell'ultima verifica delle regole e quella dei dati comunali sono scritte in fondo alla pagina.

## Limiti

La pagina li elenca nella sezione «Fonti e limiti». I principali: il netto mensile è l'annuo diviso per le mensilità,
non il cedolino di un mese preciso (le addizionali in busta sono quelle dell'anno prima, a conguaglio); i carichi di
famiglia valgono per l'anno intero; le detrazioni regionali per figli o per disabilità non sono incluse; le casse
professionali non sono coperte; per le soglie di reddito che la legge misura sull'anno precedente si usa l'anno
simulato.

Alcuni casi sono semplificati o non calcolati, e la pagina lo dice dove serve: il regime dei frontalieri applica solo la
franchigia sul reddito; per bar, ristoranti, turismo e terme il trattamento integrativo del 15% su notturno e festivo
(L. 199/2025, art. 1, c. 18) non è calcolato; i fondi di categoria diversi da Previndai vanno indicati a mano. Nei dati MEF
del 2026 due comuni (Airuno e Bentivoglio) hanno una fascia con il limite scritto male: lo script la sposta al limite
IRPEF successivo e lo segnala a ogni aggiornamento.

Dal 1° gennaio 2027 il D.Lgs. 117/2026 riordina il testo unico delle imposte sui redditi: le regole e le citazioni
andranno ricontrollate prima di quella data.

## Privacy

Il calcolo avviene nel browser. Gli importi non vengono inviati né conservati, la pagina non usa cookie, non traccia la
navigazione e non contatta altri server. Lo stato della simulazione sta nell'indirizzo dopo il simbolo «#»: quella
parte non arriva al server, nemmeno aprendo un link condiviso. Chi condivide il link condivide però i parametri
inseriti con chi lo riceve.

## Come è fatto

Una pagina statica con moduli JavaScript nativi, senza framework e senza passaggi di compilazione.

```
index.html              la pagina: struttura, testi fissi, foglio di stile compilato
src/engine/             il motore di calcolo, diviso per argomento (regole nazionali,
                        parametri per anno, esoneri, territorio, dipendente, partita IVA,
                        calcolo inverso, ottimizzazione)
src/data/mef-data.js    le aliquote regionali e comunali, generate dalle fonti MEF
src/texts/it.js         tutti i testi che il codice mostra all'utente
src/ui/                 l'interfaccia
src/tests/suite.js      i controlli sui conti, eseguibili anche dalla pagina
tools/                  aggiornamento dei dati, controlli, foglio di stile, test
```

Il codice è in inglese; i testi per l'utente sono in italiano, in `src/texts/it.js`.

### Provarlo sul proprio computer

I moduli JavaScript non si aprono con un doppio clic sul file: serve un piccolo server locale.

```
python -m http.server 8000
```

Poi aprire <http://localhost:8000/>.

### Controlli

```
node tools/run_tests.mjs          # i controlli sui conti: devono passare tutti
node tools/check_golden.mjs       # 1.892 casi fissi confrontati al centesimo con tools/golden/expected.json
python tools/check_dataset.py     # integrità dei dati regionali e comunali
node tools/build_css.js --check   # il foglio di stile corrisponde alle classi usate
node tools/check_layout.mjs       # la pagina in Chrome, da computer e da telefono: numeri dei riquadri, altezza, netto in vista
```

Il controllo della pagina usa il Chrome già installato e, la prima volta, scarica in `tools/.cache/` la libreria che
lo comanda.

### Aggiornare i dati

```
python tools/build_dataset.py --refresh
```

Riscarica dal MEF le delibere comunali e le aliquote regionali e ricostruisce `src/data/mef-data.js`. Lo stesso
script gira da solo il 1° e il 15 di ogni mese su GitHub e, se qualcosa è cambiato, apre una richiesta di modifica da
controllare prima della pubblicazione. Un secondo controllo automatico legge ogni lunedì le circolari INPS e segnala
quelle che potrebbero cambiare il calcolo.

Le regole nazionali (aliquote, soglie, detrazioni) non si aggiornano da sole: nascono dalle leggi e si ricontrollano a
ogni legge di bilancio.

## Licenza

Il codice è distribuito con licenza MIT (vedi `LICENSE`). La licenza riguarda il codice, non i risultati del calcolo,
che restano una stima.
