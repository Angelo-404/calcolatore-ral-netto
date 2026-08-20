# Calcolatore RAL → Netto — Prototipo tecnico

Single Page Application che calcola la proiezione della **retribuzione netta annuale e mensile** a partire dalla RAL, secondo la normativa fiscale italiana **2025/2026**.

Il progetto è organizzato in due sezioni accessibili dallo stesso URL:

| Sezione | Contenuto |
|---|---|
| **Base** | Lo scenario richiesto, con profilo e assunzioni fissi. Motore di calcolo canonico, anno d'imposta 2025. |
| **Premium** | Motore parametrico completo: anno d'imposta 2025 o 2026, profilo contributivo per settore e qualifica, massimale e aliquota aggiuntiva, fiscalità locale su **tutti i 7.897 comuni italiani** e 21 regioni e province autonome, periodo di lavoro e part-time, carichi di famiglia, welfare, premi di risultato, previdenza complementare e regimi fiscali agevolati. |

La sezione Base è la fonte di verità: la sezione Premium la estende senza modificarne una riga. Sullo stesso scenario, i due motori restituiscono lo stesso identico netto — verificato da un test automatico su tutta la scala retributiva.

I dati territoriali non sono stimati: sono importati dall'**anagrafe ufficiale delle delibere del MEF — Dipartimento delle Finanze**. Il §8 elenca tutte le fonti, il §9 documenta la pipeline di importazione.

---

## Aderenza al brief

| Richiesta del brief | Dove è soddisfatta |
|---|---|
| Input RAL, output netto annuale e mensile | Sezione Base, card di sintesi in alto |
| "quanto sono le tasse che deve pagare" | Card **Tasse e contributi a carico del dipendente**: totale, quota mensile, split tra contributi INPS e imposte (IRPEF netta + addizionali) |
| "mostra tutte le voci trattenute al lordo" | Tabella **Dettaglio del calcolo**: cascata riga per riga da RAL a netto, con valore annuo e quota mensile per ogni voce |
| Pulsante "calcola" | Pulsante **Calcola** sotto il campo RAL (attivabile anche con Invio). Il calcolo è comunque reattivo sull'evento `input`: il pulsante ricalcola in modo esplicito e evidenzia il risultato |
| Caso semplice e standard | Impiegato a tempo indeterminato, Milano, nessuna agevolazione — le tre semplificazioni suggerite dal brief, più quelle dichiarate al §3 |
| Semplificazioni dichiarate e discutibili in interview | §3 (assunzioni), §4.5 (discontinuità), §6 (limiti Premium), §7 (perimetro) |
| Controllo sulle logiche, non output di un tool generativo | Ogni soglia è una costante nominata, ogni regola una funzione pura testabile; §5 documenta 31 test eseguibili dalla pagina e riproducibili in Node |
| "abilità di ricerca delle informazioni rilevanti dalle fonti" | §8 elenca ogni istituto con la sua fonte primaria e le **tre correzioni** che il confronto con le fonti ufficiali ha prodotto; §9 documenta la pipeline che importa i dati dall'anagrafe MEF |

---

## 1. Come si esegue

```bash
# Nessuna installazione, nessun build step, nessun package manager.
# Aprire il file direttamente nel browser:
start index.html      # Windows
open index.html       # macOS
```

Requisito unico: connessione a Internet al primo caricamento, per la CDN di Tailwind CSS.

Il motore di calcolo è esposto in console per ispezione diretta durante la valutazione:

```js
MotoreFiscale.calcolaBase(30000)
// { ral: 30000, inps: 2757, imponibile: 27243, irpefLorda: 6265.89,
//   detrazioniBase: 2044.29, irpefNetta: 3221.60, addReg: 377.94,
//   addCom: 217.94, nettoAnnuo: 23425.52, nettoMensile: 1801.96, … }
```

---

## 2. Architettura

**Scelta: SPA zero-dependencies in un unico file.**

| Vincolo | Decisione | Motivazione |
|---|---|---|
| Distribuzione | Un solo `index.html` | Un valutatore deve poter aprire il file con un doppio click. Nessun `npm install`, nessun ambiente da ricostruire, nessuna versione di Node da allineare. |
| Runtime | JavaScript nativo, ES2020 | Il dominio del problema è aritmetica pura su un input scalare. Un framework aggiungerebbe superficie senza risolvere alcun problema reale. |
| Stile | Tailwind CSS via CDN | Design system coerente senza build step. È l'unica dipendenza esterna e riguarda esclusivamente la presentazione: rimuovendola il motore continua a funzionare. |
| Grafici | SVG generato a runtime | Evita di importare una libreria di charting da centinaia di kB per una singola curva. |
| Stato | Ricalcolo puro su evento `input` | Nessuno stato mutabile condiviso: ogni digitazione produce un ricalcolo completo e deterministico. |

### Separazione delle responsabilità

Il file è organizzato in strati nettamente distinti, nell'ordine:

1. **Costanti normative** (`COSTANTI`, `REGIONI`, `COMUNI`, `PREMIUM`) — ogni soglia e ogni aliquota è una costante nominata, mai un numero magico inline. L'aggiornamento a una nuova legge di bilancio si riduce a modificare questo blocco.
2. **Funzioni pure di dominio** — `calcolaInps`, `calcolaIrpefLorda`, `calcolaDetrazioniBase`, `calcolaBonusCuneo`, `calcolaUlterioreDetrazione`, `calcolaTrattamentoIntegrativo`, `calcolaAddizionaleScaglioni`, `calcolaAddizionaleComunale`. Nessuna tocca il DOM, ognuna è testabile in isolamento.
3. **Orchestratori** — `calcolaBase(ral)` e `calcolaPremium(params)` compongono le funzioni pure e restituiscono un oggetto risultato completo, che include tutti i valori intermedi e non solo il netto finale.
4. **Rendering** — `renderBase`, `renderPremium`, `renderComposizione`, `renderGrafico` consumano l'oggetto risultato. Il calcolo non sa nulla della presentazione.
5. **Binding UI** — listener, validazione dell'input, gestione delle sezioni.

Questa separazione è la ragione per cui il motore è stato validato in Node.js estraendo gli strati 1–3 senza alcuna modifica al codice.

---

## 3. Assunzioni di dominio (sezione Base)

Le assunzioni sono **hardcoded per scelta**, non per semplificazione: lo scenario richiesto è uno scenario preciso, e renderlo esplicito nel codice lo rende verificabile.

| Assunzione | Valore | Effetto sul calcolo |
|---|---|---|
| Inquadramento | Impiegato, tempo indeterminato | Aliquota INPS a carico del lavoratore 9,19%, senza massimale contributivo |
| Residenza fiscale | Milano (Lombardia) | Addizionale regionale a scaglioni Lombardia + addizionale comunale Milano |
| Carichi di famiglia | Nessuno | Nessuna detrazione ex art. 12 TUIR: le uniche detrazioni sono quelle da lavoro dipendente |
| Giorni lavorati | 365 | Le detrazioni sono rapportate all'anno intero, senza ragguaglio |
| Mensilità | 13 | Il netto mensile è il netto annuo diviso 13 |
| Addizionali locali | **A regime, per competenza** | Vedi sotto |

### Dove il profilo standard smette di valere

L'aliquota INPS piatta al 9,19% senza massimale è corretta nella fascia retributiva ordinaria, ma oltre due soglie contributive non lo è più:

| Soglia 2025 | Cosa cambia | Effetto sul netto della sezione Base |
|---|---|---|
| 55.448 € | Si aggiunge l'aliquota contributiva dell'1% (art. 3-ter D.L. 384/1992) | Sovrastimato: +245,52 € a 80.000 € di RAL |
| 120.607 € | Opera il massimale contributivo per chi è privo di anzianità al 31/12/1995 | Sottostimato: i contributi continuano a crescere quando dovrebbero fermarsi |

La sezione Base **non** implementa queste due regole, perché il profilo richiesto è quello standard. Piuttosto che presentare un numero impreciso come esatto, la interfaccia lo dichiara: superata la soglia compare un avviso che nomina la norma, quantifica lo scostamento e offre di ricalcolare nella sezione Premium, che applica entrambe le regole. La RAL viene trasferita e il massimale attivato automaticamente.

A 200.000 € di RAL la differenza fra i due motori è di circa 4.000 € annui.

### Sul criterio "a regime, per competenza"

Nel cedolino reale l'addizionale regionale e comunale seguono un criterio di **cassa sfalsato**: l'addizionale dell'anno N è determinata a conguaglio e trattenuta in rate nell'anno N+1, mentre nell'anno corrente si versano acconti calcolati sull'imponibile dell'anno precedente. In un anno di ingresso in azienda o di variazione retributiva, la trattenuta effettiva in busta paga non coincide quindi con l'addizionale di competenza.

Il prototipo adotta il criterio **di competenza a regime**: calcola l'addizionale dovuta sull'imponibile dell'anno simulato e la ripartisce sulle 13 mensilità. È l'unico criterio che produce una proiezione stabile e confrontabile, che è esattamente ciò che serve a chi sta valutando un'offerta economica. La scelta è dichiarata nell'interfaccia, non nascosta.

---

## 4. Precisione del motore di calcolo

### 4.1 Il taglio del cuneo fiscale — due istituti, non uno

L'errore più diffuso nei calcolatori online è trattare il taglio del cuneo come un'unica agevolazione. Non lo è. Dal 2025 il beneficio ha **due nature giuridiche diverse** a seconda dell'imponibile, e la differenza è sostanziale:

| Imponibile | Istituto | Natura | Effetto sull'IRPEF |
|---|---|---|---|
| ≤ 8.500 € | Bonus 7,1% | Somma **esentasse** | Nessuno: non erode l'imposta |
| 8.500 – 15.000 € | Bonus 5,3% | Somma **esentasse** | Nessuno |
| 15.000 – 20.000 € | Bonus 4,8% | Somma **esentasse** | Nessuno |
| 20.000 – 32.000 € | 1.000 € | **Detrazione d'imposta** | Riduce l'IRPEF, soggetta a capienza |
| 32.000 – 40.000 € | 1.000 € × (40.000 − imp.) / 8.000 | **Detrazione d'imposta** decrescente | Riduce l'IRPEF, soggetta a capienza |
| > 40.000 € | — | — | — |

Nel motore i due istituti sono due funzioni distinte:

- `calcolaBonusCuneo()` produce `bonusCuneo`, che entra nella formula finale **sommato al netto**, dopo il calcolo dell'imposta;
- `calcolaUlterioreDetrazione()` produce `ulterioreDetrazione`, che entra nel monte detrazioni **prima** del calcolo dell'IRPEF netta ed è quindi soggetta al limite di capienza.

Confonderli significa sbagliare il netto in due modi opposti: sopravvalutarlo per gli incapienti sotto i 20.000 € e sottovalutarlo tra 20.000 e 40.000 €.

### 4.2 L'addizionale comunale di Milano — l'effetto scalino

Milano prevede una **soglia di esenzione totale a 23.000 € di imponibile**. Il punto tecnico è che la soglia **non è una franchigia**: superata di un solo euro, l'aliquota dello 0,80% si applica all'**intero imponibile**, non alla sola quota eccedente.

```js
function calcolaAddizionaleComunale(imponibile, regola) {
  if (imponibile <= regola.esenzione) return 0;
  return imponibile * regola.aliquota;   // sull'INTERO imponibile
}
```

Conseguenza misurabile: a 23.000 € di imponibile l'addizionale è 0 €; a 23.001 € è 184,01 €. Un contribuente che supera la soglia di 1 € perde 184 € netti. Un'implementazione a scaglioni progressivi, che qui sarebbe l'assunzione istintiva e sbagliata, produrrebbe 0,008 € invece di 184,01 € — un errore del 99,996% su quella voce.

L'addizionale **regionale**, al contrario, è genuinamente progressiva a scaglioni ed è implementata con l'algoritmo cumulativo `calcolaAddizionaleScaglioni()`. Le due addizionali hanno logiche opposte e il motore le tiene separate.

### 4.3 Capienza fiscale

Le detrazioni non generano credito d'imposta:

```js
const detrazioneEffettiva = Math.min(totDetrazioni, irpefLorda);
const irpefNetta = Math.max(0, irpefLorda - detrazioneEffettiva);
```

La quota di detrazione persa per incapienza è calcolata, esposta in una riga dedicata della cascata e mostrata all'utente. È un'informazione che i calcolatori commerciali tipicamente occultano, ma che spiega perché a redditi bassi un aumento di RAL possa avere un rendimento netto anomalo.

### 4.4 Trattamento integrativo e incapienza

Il trattamento integrativo (ex bonus Renzi, 1.200 € annui) **non spetta agli incapienti**: la condizione di legge è che l'imposta lorda superi la detrazione da lavoro dipendente. Poiché la detrazione minima è 1.955 € e l'aliquota del primo scaglione è 23%, il punto di pareggio cade esattamente a **8.500 € di imponibile** — la no tax area.

Sotto quella soglia il motore restituisce `trattamentoIntegrativo = 0`, non 1.200 €. Tra 15.000 e 28.000 € spetta la sola quota di detrazioni eccedente l'imposta lorda, con tetto a 1.200 €.

### 4.5 Le tre discontinuità della curva

Il netto **non è una funzione monotona crescente della RAL**. La normativa produce tre punti in cui a un aumento di lordo corrisponde una diminuzione di netto. Il motore le riproduce fedelmente e la suite di test le asserisce come comportamento atteso:

| Soglia (imponibile) | RAL corrispondente | Perdita netta | Causa |
|---|---|---|---|
| 15.000 € | ≈ 16.519 € | −129,35 € | Decadenza del trattamento integrativo, non compensata dal gradino di detrazione |
| 23.000 € | ≈ 25.328 € | −183,40 € | Effetto scalino dell'addizionale comunale di Milano |
| 35.000 € | ≈ 38.543 € | −64,62 € | Decadenza del correttivo di fascia da 65 € |

Un calcolatore che restituisce una curva perfettamente monotona sta approssimando la normativa. Il test `Monotonicità: rotture solo sulle 3 soglie normative note` verifica su 250.000 punti che esistano **esattamente** queste tre discontinuità e nessun'altra: qualunque rottura aggiuntiva sarebbe un bug di implementazione.

---

## 5. Verifica

La pagina include una suite di test eseguibile dal browser: sezione **Premium → Verifica del motore di calcolo → Esegui test**.

| Test | Tipo |
|---|---|
| RAL 30.000 € → INPS 2.757,00 € | Valore di riferimento |
| RAL 30.000 € → imponibile 27.243,00 € | Valore di riferimento |
| RAL 30.000 € → netto annuo 23.425,52 € | Valore di riferimento |
| Milano: esenzione sotto 23.000 € | Soglia normativa |
| Milano: 0,80% sull'intero imponibile sopra soglia | Effetto scalino |
| IRPEF netta mai negativa (1k → 200k) | Invariante |
| Monotonicità: rotture solo sulle 3 soglie note | Invariante |
| Quadratura: RAL − trattenute + bonus = netto | Riconciliazione contabile |
| Cuneo: bonus esentasse fino a 20.000 € | Confine tra istituti |
| Trattamento integrativo nullo per incapienti | Regola di legge |
| Premium 2025 = motore Base sotto la prima fascia pensionabile | Non-regressione |
| Sopra soglia lo scarto dal Base è solo l'aliquota aggiuntiva 1% | Non-regressione |
| 2026 più conveniente del 2025 nello scaglione 28k–50k | Effetto della nuova aliquota |
| Aliquota aggiuntiva 1% applicata sopra soglia | Regola contributiva |
| Massimale contributivo blocca la contribuzione | Regola contributiva |
| Impatriati: abbatte l'IRPEF ma non i contributi | Confine tra basi imponibili |
| Ragguaglio ai giorni su retribuzione e detrazioni | Competenza temporale |
| Fringe benefit: superata la soglia è tassato tutto | Soglia, non franchigia |
| Dataset: 7.897 comuni e 21 regioni caricati | Integrità del dataset |
| Dataset: Milano 0,80% con esenzione 23.000 € | Integrità del dataset |
| Dataset: Lombardia allineata alla specifica del motore Base | Riconciliazione fonte/spec |
| Dataset: nessuna aliquota comunale oltre il massimo di legge 1,20% | Integrità del dataset |
| Fondo pensione: deduce l'imposta, non gonfia le detrazioni | Confine fra reddito complessivo e imponibile |
| Compensi accessori: imposta sostitutiva solo dal 2026 | Vigenza temporale dell'agevolazione |
| Ogni provincia è associata a una regione esistente | Coerenza territoriale |
| Inversione: la RAL trovata riproduce il netto richiesto | Correttezza dell'inversione |
| Inversione: più RAL per lo stesso netto, sceglie la meno costosa | Effetto delle discontinuità |
| Inversione: dichiara le richieste fuori scala | Robustezza |
| Input 0 e input negativo senza `NaN`, anche in Premium | Robustezza |

**31 test su 31 superati.** Gli stessi controlli sono stati eseguiti fuori dal browser estraendo gli strati 1–3 del motore in un modulo Node.js, senza modificarne il codice.

Un dettaglio che vale la pena spiegare: i due motori **non** coincidono sopra i 55.448 € di retribuzione, e questo è corretto. La specifica del motore Base fissa l'INPS al 9,19% puro; il motore Premium applica anche l'aliquota aggiuntiva dell'1% prevista dall'art. 3-ter del D.L. 384/1992. Il test non nasconde la divergenza: la misura e verifica che sia esattamente pari a quel contributo.

### Valori di riferimento verificati

| RAL | Imponibile | IRPEF netta | Add. reg. | Add. com. | Bonus | Netto annuo | Netto/mese | Pressione |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 15.000 € | 13.621,50 | 1.177,95 | 167,54 | 0,00 | 1.921,94 | 14.197,95 | 1.092,15 | 5,4% |
| 20.000 € | 18.162,00 | 1.366,70 | 234,46 | 0,00 | 871,78 | 17.432,61 | 1.340,97 | 12,8% |
| 25.000 € | 22.702,50 | 1.826,65 | 306,20 | 0,00 | 0,00 | 20.569,65 | 1.582,28 | 17,7% |
| 30.000 € | 27.243,00 | 3.221,60 | 377,94 | 217,94 | 0,00 | 23.425,52 | 1.801,96 | 21,9% |
| 45.000 € | 40.864,50 | 10.149,45 | 611,17 | 326,92 | 0,00 | 29.776,97 | 2.290,54 | 33,8% |
| 60.000 € | 54.486,00 | 16.068,98 | 845,91 | 435,89 | 0,00 | 37.135,22 | 2.856,56 | 38,1% |
| 100.000 € | 90.810,00 | 31.688,30 | 1.474,31 | 726,48 | 0,00 | 56.920,91 | 4.378,53 | 43,1% |

A 15.000 € di RAL la pressione fiscale è 5,4% e a 10.000 € è **negativa**: i bonus esentasse superano il prelievo. Il valore non è un errore di calcolo, è il risultato corretto del cuneo fiscale a redditi bassi.

---

## 6. Sezione Premium

Costruita sopra le stesse funzioni pure del motore Base. Rimuove tutte le assunzioni fisse e copre gli istituti che un HR applica realmente in busta paga.

### 6.1 Anno d'imposta: il 2026 non è il 2025

La differenza più rilevante è che **le regole cambiano fra i due anni**, e un calcolatore che ne implementa uno solo è già sbagliato per metà del suo perimetro:

| Parametro | 2025 | 2026 |
|---|---:|---:|
| Seconda aliquota IRPEF (28.000–50.000 €) | 35% | **33%** |
| Massimale contributivo annuo | 120.607 € | 122.295 € |
| Soglia dell'aliquota aggiuntiva 1% | 55.448 € | 56.224 € |
| Minimale retributivo mensile | 1.490,32 € | 1.511,38 € |
| Buoni pasto elettronici esenti | 8 €/giorno | **10 €/giorno** |
| Imposta sostitutiva sui premi di risultato | 5% | **1%** |

A 45.000 € di RAL, il solo passaggio dal 2025 al 2026 vale **+257,29 €** di netto annuo — importo calcolato dal motore, non stimato.

La specifica di `PROJECT.md` fissa la seconda aliquota al 35%: è corretta per il 2025 ed è quella che il motore Base implementa alla lettera. Il motore Premium copre entrambi gli anni.

### 6.2 Contribuzione reale per settore e qualifica

| Funzionalità | Nota |
|---|---|
| 10 profili contributivi | Terziario impiegato e quadro, industria impiegato/operaio/con CIGS, edilizia, dirigente, apprendista, agricoltura, lavoro domestico |
| **Aliquota aggiuntiva 1%** | Art. 3-ter D.L. 384/1992: 1% sulla quota oltre la prima fascia di retribuzione pensionabile, dovuta quando l'aliquota a carico del lavoratore è inferiore al 10%. Assente in quasi tutti i calcolatori online |
| **Massimale contributivo** | Per chi è privo di anzianità al 31/12/1995: oltre il tetto la contribuzione si ferma e il netto marginale sale bruscamente |
| Minimale retributivo | Segnalato quando la retribuzione mensile scende sotto la soglia INPS |
| Fondo di categoria dei dirigenti | Quota a carico del dirigente, con tetto di retribuzione |
| Contribuzione a carico del datore | Differenziata per profilo, dichiarata come stima |

### 6.3 Competenza temporale

| Funzionalità | Nota |
|---|---|
| Giorni di lavoro nell'anno | Assunzione o cessazione in corso d'anno: **detrazioni, bonus cuneo e trattamento integrativo vengono ragguagliati**, le soglie di reddito no |
| Part-time percentuale | Riduce la retribuzione maturata, non le soglie normative |
| Mensilità 12 / 13 / 14 | Modifica il divisore del netto mensile |

### 6.4 Welfare e compensi variabili

| Funzionalità | Nota |
|---|---|
| Fringe benefit | Soglia 1.000 € (2.000 € con figli a carico). Se superata, l'**intero** importo diventa imponibile: è una soglia, non una franchigia. Errore molto frequente |
| Buoni pasto | Limite giornaliero esente per anno e per tipo (elettronici o cartacei); l'eccedenza è imponibile e contributiva |
| Premio di risultato | Imposta sostitutiva 5% (2025) o 1% (2026), entro 3.000 € e per redditi fino a 80.000 €; l'eccedenza torna a tassazione ordinaria |
| Conversione del premio in welfare | Esente da imposte e contributi: alternativa esplicita, con confronto immediato sul netto |
| Straordinari, notturni e festivi | Imposta sostitutiva 5% per redditi fino a 33.000 € |
| Previdenza complementare | Contributo del lavoratore deducibile fino a 5.164,57 €: riduce l'imponibile IRPEF ma non la base contributiva |
| TFR maturato | RAL / 13,5 al netto del contributo dello 0,50% al Fondo di garanzia |

### 6.5 Regimi fiscali agevolati

| Regime | Effetto |
|---|---|
| Impatriati — D.Lgs. 209/2023 | Imponibile al 50%, o al 40% con figlio minore, entro 600.000 € di reddito agevolabile |
| Docenti e ricercatori — art. 44 D.L. 78/2010 | Imponibile al 10% |
| Frontalieri | Franchigia di 10.000 € sull'imponibile |

Tutti e tre riducono l'imponibile IRPEF e **nessuno riduce la base contributiva**: è una distinzione che il motore rispetta e che un test verifica esplicitamente.

### 6.6 Fiscalità locale su base nazionale

- **7.897 comuni** e **21 regioni e province autonome**, importati dall'anagrafe ufficiale del MEF.
- Ricerca del comune con completamento a digitazione, che mostra aliquota ed esenzione prima ancora della selezione.
- Ogni comune conserva la propria struttura: aliquota unica oppure scaglioni cumulativi, con o senza soglia di esenzione.
- Il motore gestisce entrambi gli anni: dove il comune non ha ancora deliberato per il 2026 resta in vigore l'aliquota 2025, ed è segnalato in interfaccia.

### 6.7 Dal netto alla RAL

La domanda che in un'azienda di HR si fa ogni giorno è l'inversa di quella che i calcolatori sanno rispondere: *"il candidato chiede 2.500 € netti al mese, che RAL devo mettere nell'offerta?"*.

L'inversione avviene per bisezione sul motore stesso, ma il caso interessante nasce dalle discontinuità del §4.5. Un salto verso il basso **non** lascia buchi nell'insieme dei netti raggiungibili: fa attraversare due volte lo stesso livello. La conseguenza pratica è che alcune cifre nette corrispondono a **più RAL diverse**.

Esempio reale prodotto dal motore, vicino allo scalino di Milano:

> Serve una RAL di **25.277 €**. Per via dei salti normativi questa cifra netta è prodotta anche da 25.586 €. Ho scelto la più bassa: stesso netto in busta, ma **426 € in meno di costo azienda**.

È l'unico punto in cui il lavoro sulle discontinuità produce un risultato che l'utente usa, invece di una nota nel README. Il ramo che gestisce i valori davvero irraggiungibili resta implementato come difesa: servirebbe un salto verso l'alto, che una normativa futura potrebbe introdurre.

### 6.8 Confronto fra scenari

Chi lavora in selezione non calcola: compara. Un pulsante blocca lo scenario corrente come A; da lì ogni modifica dei parametri produce lo scenario B e una tabella di differenze su netto, valore totale percepito, prelievo, costo azienda ed efficienza.

Serve a confrontare due offerte, due città, i due anni d'imposta, oppure più RAL contro meno RAL più welfare.

### 6.9 Scenario condivisibile

Ogni parametro vive nell'indirizzo: `?sezione=premium&anno=2025&comune=L219&ral=62000&profilo=dirigente&massimale=1`. La simulazione si configura e si manda per link, e alla riapertura lo stato è identico. Nell'URL finiscono solo i parametri diversi dal valore predefinito, per tenerlo leggibile.

Selezionare un comune **allinea automaticamente la regione**: senza questo vincolo era possibile calcolare Torino con l'addizionale regionale della Lombardia. Un test verifica che tutte le 107 province del dataset ricadano in una delle 21 regioni.

### 6.10 Avvisi contestuali

L'interfaccia segnala automaticamente le situazioni che un HR deve vedere e spiegare al dipendente: massimale raggiunto, aliquota aggiuntiva attiva, retribuzione sotto il minimale, detrazioni perse per incapienza, delibera comunale 2026 non ancora pubblicata.

### Limiti dichiarati

Dichiarati anche nell'interfaccia, non solo qui:

- Le aliquote a carico del **datore di lavoro** sono stime parametriche: variano per CCNL, dimensione aziendale e codice ATECO. Quelle a carico del lavoratore sono invece valori normativi.
- Le detrazioni per carichi di famiglia sono calcolate sul reddito del solo dichiarante.
- Il taglio forfettario di 440 € sulle detrazioni al 19% per redditi oltre 200.000 € non è modellato, perché il calcolatore non gestisce oneri detraibili: senza oneri, non c'è nulla da tagliare.
- Il fringe benefit da auto aziendale va inserito come importo già valorizzato: il motore non calcola le tabelle ACI.

---

## 7. Perimetro del prototipo

Fuori scope, in modo deliberato:

- Conguaglio fiscale di fine anno e criterio di cassa sulle addizionali (acconto e saldo)
- Tassazione separata di arretrati e TFR liquidato
- Detrazioni per oneri (spese sanitarie, interessi passivi, ristrutturazioni) e relativo taglio forfettario oltre 200.000 €
- Minimi tabellari, scatti di anzianità e superminimi previsti dai singoli CCNL
- Trattenute sindacali, cessioni del quinto, pignoramenti
- Assegno Unico Universale, che non transita dalla busta paga fiscale

Il prototipo è una **stima previsionale a fini illustrativi** e non sostituisce il cedolino elaborato dal consulente del lavoro.

---

## 8. Fonti normative

Le regole implementate derivano dalle fonti seguenti. Dove la fonte primaria lascia margine interpretativo, la scelta adottata è dichiarata nelle sezioni precedenti.

| Istituto | Fonte |
|---|---|
| Scaglioni e aliquote IRPEF (23% / 35% / 43%) | TUIR — D.P.R. 917/1986, art. 11; assetto a tre scaglioni introdotto dal D.Lgs. 216/2023 e reso strutturale dalla Legge di Bilancio 2025 (L. 207/2024) |
| Detrazioni per lavoro dipendente e correttivo di fascia | TUIR, art. 13 |
| Detrazioni per carichi di famiglia (sezione Premium) | TUIR, art. 12 |
| Taglio del cuneo fiscale 2025: bonus esentasse fino a 20.000 € e ulteriore detrazione 20.000–40.000 € | L. 207/2024 (Legge di Bilancio 2025); istruzioni operative Agenzia delle Entrate |
| Trattamento integrativo (1.200 € annui) e condizione di capienza | D.L. 3/2020 conv. L. 21/2020, come modificato dal D.Lgs. 216/2023 |
| Aliquota contributiva 9,19% a carico del lavoratore | Circolari INPS sulle aliquote contributive del settore privato (FPLD) |
| Addizionale regionale IRPEF Lombardia, scaglioni 1,23% / 1,58% / 1,72% / 1,73% | Legge regionale Lombardia sull'addizionale IRPEF; elenco aliquote pubblicato dal MEF — Dipartimento delle Finanze |
| Addizionale comunale IRPEF Milano, 0,80% con esenzione fino a 23.000 € | Delibera comunale di Milano sulle aliquote dell'addizionale; regolamento comunale e anagrafe MEF delle aliquote |
| Soglie fringe benefit (1.000 € / 2.000 € con figli) e buoni pasto elettronici (8 €/giorno) | TUIR art. 51, comma 3 e comma 2 lett. c); disciplina prorogata dalla Legge di Bilancio 2025 |
| Quota TFR (retribuzione / 13,5) e contributo 0,50% al Fondo di garanzia | Art. 2120 c.c.; L. 297/1982 |
| Seconda aliquota IRPEF 2026 al 33% e sterilizzazione oltre 200.000 € | Legge di Bilancio 2026; [scheda MEF sulle principali misure](https://www.mef.gov.it/focus/Principali-misure-della-legge-di-bilancio-2026/) |
| Massimale contributivo, minimale retributivo e prima fascia pensionabile | INPS, circolare n. 6 del 30 gennaio 2026; circolari annuali su minimali e massimali |
| Aliquota aggiuntiva 1% | Art. 3-ter D.L. 384/1992, conv. L. 438/1992 |
| Imposta sostitutiva su premi di risultato (5% nel 2025, 1% nel 2026) e sui compensi accessori | L. 208/2015; Legge di Bilancio 2026 |
| Regime impatriati: imponibile al 50%, 40% con figlio minore, tetto 600.000 € | D.Lgs. 209/2023, art. 5; [Agenzia delle Entrate — nuovo regime impatriati](https://www.agenziaentrate.gov.it/portale/lavoratori-impatriati-209-2023/infogen-lavoratori-impatriati-209-2023-cittadini) |
| Docenti e ricercatori: imponibile al 10% | Art. 44 D.L. 78/2010 |
| Previdenza complementare deducibile fino a 5.164,57 € | D.Lgs. 252/2005, art. 8 |
| **Aliquote di tutti i 7.897 comuni** | MEF — Dipartimento delle Finanze, [anagrafe delle delibere comunali](https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/addirpef_newDF/download/tabella.htm) (CSV per anno d'imposta) |
| **Aliquote di tutte le 21 regioni e province autonome** | MEF — Dipartimento delle Finanze, [ricerca aliquote regionali](https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/addregirpef/sceltaregione.htm) |

### Tre correzioni prodotte dalla verifica sulle fonti

La prima versione del prototipo usava, per i territori diversi da Milano e Lombardia, valori ricostruiti a memoria e dichiarati come indicativi. Il confronto con l'anagrafe ufficiale ne ha corretti tre:

| Dato | Prima versione | Fonte ufficiale |
|---|---|---|
| Esenzione comunale di Roma | 12.000 € | **14.000 €** |
| Tetto massimo dell'addizionale comunale | 0,80% | **1,20%** — i comuni che hanno aderito agli accordi per il ripiano del disavanzo (Genova, Torino, Alessandria, Brindisi e altri) superano il tetto ordinario |
| Aliquota INPS a carico del lavoratore sopra soglia | 9,19% piatta | **9,19% + 1%** sulla quota oltre la prima fascia pensionabile |

Sono esattamente il tipo di errore che un valore "plausibile" nasconde e che solo la fonte primaria smaschera.

**Verifica incrociata.** I valori di riferimento della tabella al §5 sono stati ricalcolati con un'implementazione indipendente in Node.js, ottenuta estraendo gli strati 1–3 del motore senza modificarne il codice. Le tre discontinuità del §4.5 sono state individuate con una scansione a passo 1 € su 250.000 punti, non ipotizzate a priori.

---

## 9. Pipeline dei dati territoriali

Il dataset non è stato digitato a mano né copiato da siti di terze parti: è generato da uno script di build che parte dalle fonti primarie.

```
CSV MEF addizionali comunali 2025  ─┐
CSV MEF addizionali comunali 2026  ─┼─→  build_dataset.py  ─→  dataset incorporato in index.html
21 pagine MEF aliquote regionali   ─┘
```

**Passaggi dello script:**

1. Scarica i CSV ufficiali dell'anagrafe comunale per il 2025 e il 2026 (790 KB e 1,2 MB).
2. Interpreta le coppie *(aliquota, fascia di applicazione)* — fino a 12 per comune — distinguendo i quattro formati presenti nella fonte: esenzione, aliquota unica, scaglione chiuso, scaglione aperto.
3. Normalizza i decimali: il CSV comunale usa la virgola e omette lo zero iniziale (`,8`), le tabelle regionali usano il punto (`1.23`). Due parser distinti, perché unificarli produceva aliquote del 123%.
4. Applica la regola di vigenza: **la delibera 2026 prevale; in sua assenza resta in vigore quella 2025**. Su 7.897 comuni, 3.028 hanno deliberato per il 2026, 3.984 ereditano il 2025 e 885 non hanno alcuna delibera.
5. Comprime il risultato: anagrafe scritta una sola volta, tariffe posizionali, 2026 come diff sul 2025 (solo 509 comuni differiscono). Da 495 KB a **267 KB**, mantenendo la proprietà di file unico.

Il dataset resta rigenerabile: rilanciando lo script su una nuova annualità, il calcolatore si aggiorna senza toccare una riga del motore.

### 9.1 Aggiornamento automatico

I dati territoriali si aggiornano da soli. Un workflow GitHub Actions gira il 1° e il 15 di ogni mese:

1. Riscarica i CSV dal Dipartimento delle Finanze.
2. Ricostruisce il dataset e lo reinserisce in `index.html`.
3. Esegue `build/verifica_dataset.py`: 21 regioni, oltre 7.500 comuni, anagrafe e tariffe allineate, nessuna aliquota oltre il tetto di legge, Milano ancora allo 0,80% con esenzione a 23.000 €.
4. Apre una pull request **solo se qualcosa è cambiato davvero**, allegando il report della ricostruzione.

Il controllo di integrità è verificato al contrario: alterando l'aliquota di Milano lo script fallisce con codice 1 e blocca la pull request. Un controllo che non fallisce mai non protegge nulla.

La data dell'ultima verifica è scritta nel dataset e mostrata in pagina, nel piè di pagina e nell'intestazione della sezione Premium: chi legge sa quanto sono recenti le delibere incorporate.

### 9.2 Cosa l'automazione non può fare

Va detto con precisione, perché la differenza è sostanziale.

| Tipo di dato | Aggiornabile in automatico | Perché |
|---|---|---|
| Aliquote comunali e regionali | **Sì** | Il MEF le pubblica in CSV, leggibile da una macchina |
| Aliquote IRPEF, cuneo, detrazioni, soglie contributive | **No** | Nascono da un testo di legge, non da un dataset. Nessuna fonte italiana le espone in formato interrogabile |

Nessun ente pubblica la Legge di Bilancio come API. Quando cambia un'aliquota IRPEF, qualcuno deve leggere la norma e capirla: è esattamente ciò che ho fatto scoprendo che dal 2026 la seconda aliquota scende al 33%.

Quello che l'architettura garantisce è che quel lavoro umano costi il minimo possibile: ogni parametro normativo è una costante nominata dentro `ANNI` e `COSTANTI`. Aggiungere l'anno d'imposta 2027 significa aggiungere un blocco di una dozzina di righe, senza toccare una sola formula. I 27 test dicono subito se qualcosa si è rotto.

È la distinzione fra un software che si aggiorna da solo dove è possibile, e uno che promette di farlo dove non lo è.

---

## 10. Struttura dei file

```
.
├── index.html                      # SPA completa: motore, dataset MEF incorporato, UI, suite di test
├── README.md                       # Questo documento
├── build/
│   ├── build_dataset.py            # Scarica dal MEF e ricostruisce il dataset
│   ├── aggiorna_index.py           # Reinserisce il dataset in index.html, solo se cambiato
│   └── verifica_dataset.py         # Controlli di integrita', gira in CI
└── .github/workflows/
    └── aggiorna-dati.yml           # Ricontrolla le delibere il 1 e il 15 di ogni mese
```

`index.html` pesa circa 350 KB, di cui 267 KB sono il dataset ufficiale delle aliquote territoriali. Il motore di calcolo e l'interfaccia occupano gli 80 KB restanti. L'applicazione resta un unico file autosufficiente: `build/` serve solo a rigenerare i dati, non è richiesto per eseguirla.

**Riproducibilità.** Lo script scarica da solo le fonti mancanti dal Dipartimento delle Finanze:

```bash
cd build && python build_dataset.py
```

Da una cartella vuota, produce un `dataset.js` **identico byte per byte** a quello incorporato in `index.html`, insieme a un report di controllo: numero di comuni, quanti hanno deliberato per l'anno corrente, quanti ereditano l'anno precedente, e le aliquote di alcuni comuni di riferimento.
