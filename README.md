# Calcolatore RAL → Netto — Prototipo tecnico

Single Page Application che calcola la proiezione della **retribuzione netta annuale e mensile** a partire dalla RAL, secondo la normativa fiscale italiana **2025/2026**.

Il progetto è organizzato in tre sezioni accessibili dallo stesso URL:

| Sezione | Contenuto |
|---|---|
| **Base** | Lo scenario richiesto, con profilo e assunzioni fissi. Motore di calcolo canonico, anno d'imposta 2025. |
| **Premium** | Motore parametrico completo: anno d'imposta 2025 o 2026, aliquota contributiva scelta per settore, qualifica e dimensione dell'organico, massimale e aliquota aggiuntiva, fiscalità locale su **tutti i 7.897 comuni italiani** e 21 regioni e province autonome, periodo di lavoro e part-time, carichi di famiglia, welfare, premi di risultato, previdenza complementare e regimi fiscali agevolati. |

| **Partita IVA** | Lavoro autonomo: regime ordinario e forfetario al 15% o al 5%, coefficienti di redditività dell'allegato 4, contributi in Gestione separata e confronto fra i tre regimi a parità di fatturato. |

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
| Controllo sulle logiche, non output di un tool generativo | Ogni soglia è una costante nominata, ogni regola una funzione pura testabile; §5 documenta 70 test eseguibili dalla pagina e riproducibili in Node |
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

1. **Costanti normative** (`COSTANTI`, `ANNI`, `PROFILI_CONTRIBUTIVI`, `REGIMI`, `REGIONI`, `COMUNI`, `PROVINCE_REGIONE`, `PREMIUM`) — ogni soglia e ogni aliquota è una costante nominata, mai un numero magico inline. L'aggiornamento a una nuova legge di bilancio si riduce a modificare questo blocco.
2. **Funzioni pure di dominio** — `calcolaInps`, `calcolaIrpefLorda`, `calcolaDetrazioniBase`, `calcolaBonusCuneo`, `calcolaUlterioreDetrazione`, `calcolaTrattamentoIntegrativo`, `calcolaAddizionaleScaglioni`, `calcolaAddizionaleComunale`. Nessuna tocca il DOM, ognuna è testabile in isolamento.
3. **Orchestratori** — `calcolaBase(ral)` e `calcolaPremium(params)` compongono le funzioni pure e restituiscono un oggetto risultato completo, che include tutti i valori intermedi e non solo il netto finale. `invertiNetto(netto, params)` percorre la strada opposta, invertendo il motore per bisezione.
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
| Giorni di rapporto | 365 | Il rapporto copre l'intero anno: le detrazioni non vengono ragguagliate |
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
| Senza retribuzione il netto resta a zero, non va sotto | Caso limite |
| Sweep su tutte le combinazioni di contratto e regime (400) | Copertura combinatoria |
| Fondo: il contributo del datore spetta solo a chi versa | Regola dei fondi negoziali |
| Fondo: tetto di deducibilità condiviso fra lavoratore e datore | Confine del tetto unico |
| Fondo: il contributo aziendale oltre il tetto torna imponibile | Trattamento dell'eccedenza |
| TFR al fondo: nessun contributo dello 0,50% al Fondo di garanzia | Destinazione del TFR |
| Fondo: il versamento non supera quanto la busta contiene | Capienza della busta paga |
| Sweep sulle combinazioni di previdenza complementare (96) | Copertura combinatoria |
| Altre trattenute: escono dal netto senza toccare le imposte | Assenza di effetto fiscale |
| Altre trattenute: non superano il netto disponibile | Capienza della busta paga |
| Ottimizzazione dal netto: stesso valore, costo decrescente | Correttezza dell'ottimizzatore |
| Ottimizzazione dal budget: stessa spesa, valore crescente | Correttezza nella seconda direzione |
| Ottimizzazione: il welfare resta entro i tetti di legge | Rispetto delle soglie |
| Efficienza misurata: welfare esente 1:1, retribuzione molto meno | Misura anziché stima |
| Tempo determinato: NASpI 1,40% sul solo costo azienda | Confine fra costo e busta paga |
| Apprendistato: aliquota 5,84% indipendente dal settore | Indipendenza dei due assi |
| Tirocinio: nessun contributo, nessun TFR, imponibile pieno | Natura del reddito assimilato |
| Tirocinio: niente cuneo né trattamento integrativo | Perimetro delle misure per il lavoro dipendente |
| Welfare: quantifica TFR e pensione a cui si rinuncia | Completezza del confronto |
| Soglie: individua il gradino raggiungibile e lo quantifica | Ottimizzazione sulle discontinuità |
| Soglie: nessun suggerimento se l'imponibile è già basso | Assenza di consigli inutili |
| Ottimizzazione: nessun premio promesso oltre la soglia di reddito | Coerenza fra promesso ed erogato |
| Soglie: lo spostamento porta l'imponibile sotto la soglia in ogni profilo | Correttezza su tutti i profili |
| Esoneri: una misura scaduta non viene applicata | Disattivazione automatica |
| Esoneri: quello del datore riduce il costo, non il netto | Confine fra costo e busta paga |
| Esoneri: quello della lavoratrice alza netto e imponibile | Effetto fiscale dell'esonero |
| Esoneri: la decontribuzione Sud vale solo nelle regioni previste | Requisito territoriale |
| Esoneri: la stabilizzazione vale 500 € al mese dentro la sua finestra | Misura ed effetto della finestra di vigenza |
| Esoneri: la stabilizzazione esclude dirigenti e rapporti non stabilizzati | Ambito soggettivo della misura |
| Esoneri: le misure non cumulabili sono riconosciute | Divieto di cumulo |
| Co.co.co.: 35,03% diviso un terzo e due terzi | Ripartizione dell'onere in Gestione separata |
| Co.co.co.: niente TFR né cuneo, il trattamento integrativo resta | Confine fra istituti su un reddito assimilato |
| Co.co.co.: il massimale di 122.295 € si applica da solo | Regola, non opzione |
| Forfetario: coefficiente ATECO, contributi dedotti, 15% sul resto | Catena di calcolo del regime |
| Forfetario 5%: stessa base, imposta ridotta a un terzo | Isolamento dell'aliquota |
| Forfetario: niente addizionali, il comune non cambia il netto | Perimetro dell'imposta sostitutiva |
| Partita IVA: i contributi si fermano al massimale della Gestione separata | Tetto contributivo |
| Partita IVA: detrazione dell'art. 13 comma 5, non quella dei dipendenti | Detrazione corretta per la categoria |
| Ordinario: i costi abbattono reddito, contributi e imposte | Differenza sostanziale fra i due regimi |
| Input 0 e input negativo senza `NaN`, anche in Premium (3 controlli) | Robustezza |

**70 test su 70 superati.** Gli stessi controlli sono stati eseguiti fuori dal browser estraendo gli strati 1–3 del motore in un modulo Node.js, senza modificarne il codice.

**Collaudo combinatorio.** Oltre alla suite, il motore è stato sottoposto a uno sweep di **25.610 valutazioni**: tutte le combinazioni di profilo contributivo, anno d'imposta, mensilità, regime agevolato e massimale su dieci livelli di RAL; ogni parametro di welfare, famiglia e periodo variato sulle proprie soglie; e tutti i 7.897 comuni con la rispettiva regione. Su ognuna sono verificati valori finiti, netto non negativo, capienza, tetti di legge e identità contabile.

L'interfaccia è stata collaudata a parte su **332 scenari**, pilotando i controlli reali e ispezionando ciò che viene disegnato: nessun `NaN` o valore mancante nel testo, dettaglio e grafico sempre presenti, nessuno scorrimento orizzontale, ogni spiegazione contestuale con un contenuto reale.

Il collaudo ha prodotto tre correzioni, documentate al §5.1.

### 5.1 Difetti emersi dal collaudo combinatorio

| Difetto | Causa | Correzione |
|---|---|---|
| Netto negativo con RAL 0 e fringe benefit | Senza retribuzione i contributi venivano calcolati su una busta paga inesistente | Le componenti accessorie si azzerano e l'interfaccia lo dichiara con un avviso dedicato |
| Indirizzo rimasto indietro rispetto ai campi | I browser limitano la frequenza di `history.replaceState`: una chiamata a ogni digitazione superava la soglia e le successive venivano scartate in silenzio | L'indirizzo si scrive una sola volta, 350 ms dopo l'ultima modifica |
| Avvisi privi di senso con RAL 0 | Detrazioni non godute e soglie contributive segnalate su un rapporto inesistente | Senza retribuzione resta un solo avviso, gli altri sono soppressi |
| Versamento al fondo superiore alla busta paga | Con pochi giorni lavorati un importo fisso eccedeva la retribuzione. Il limite non è però la retribuzione: dedurre azzera l'imposta e fa perdere il trattamento integrativo, quindi il netto disponibile scende più in fretta di quanto si versa | Il trattenuto viene cercato per approssimazioni successive fino a mantenere il netto non negativo, e l'interfaccia dichiara quanto è stato effettivamente trattenuto |
| Rapporto netto/costo negativo | Con netto sotto zero l'indicatore perdeva significato | Mostra un trattino invece di una percentuale priva di senso |
| Pacchetto che prometteva welfare non erogabile | Oltre 80.000 € di reddito il premio agevolato non spetta, ma il pacchetto continuava a contarlo: prometteva 6.200 € di welfare consegnandone 3.200 | Il pacchetto viene ricostruito senza premio, così i numeri mostrati coincidono con ciò che il lavoratore riceve |
| Spostamento verso la soglia calcolato con l'aliquota sbagliata | Fra RAL e imponibile non c'è solo l'aliquota del lavoratore: ci sono anche il contributo aggiuntivo dell'1% e i fondi di categoria. Su un dirigente lo spostamento mancava il bersaglio di 128 € e lasciava l'imponibile sopra la soglia | Lo spostamento si misura per bisezione sul motore, quindi vale per qualunque profilo |
| Obiettivo netto non sempre raggiungibile | I salti normativi rendono certe cifre irraggiungibili, ma l'intestazione dichiarava comunque il valore richiesto | Quando il pacchetto consegna una cifra diversa, lo dichiara esplicitamente |

Un dettaglio di metodo: la prima verifica del debounce risultò superata su una **pagina servita dalla cache**, che non conteneva ancora la correzione. Il controllo è stato ripetuto forzando il ricaricamento. Un test che passa su codice vecchio è peggio di un test assente, perché dà una falsa sicurezza.

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
| Massimale del premio agevolato | 3.000 € | **5.000 €** |

A 45.000 € di RAL, il solo passaggio dal 2025 al 2026 vale **+257,29 €** di netto annuo — importo calcolato dal motore, non stimato.

La specifica di `PROJECT.md` fissa la seconda aliquota al 35%: è corretta per il 2025 ed è quella che il motore Base implementa alla lettera. Il motore Premium copre entrambi gli anni.

### 6.2 Contribuzione reale per settore e qualifica

| Funzionalità | Nota |
|---|---|
| 50 combinazioni contributive | Nove settori (industria, edilizia, artigianato, commercio a CUAF intera e ridotta, pubblici esercizi, logistica, agricoltura, lavoro domestico) per quattro qualifiche (operaio, impiegato/quadro, viaggiatore, dirigente) e fino a tre scaglioni dimensionali |
| 4 tipi di rapporto | Indeterminato, determinato, apprendistato, tirocinio. Asse separato dal settore: si combinano fra loro. Vedi §6.17 |
| **Aliquota aggiuntiva 1%** | Art. 3-ter D.L. 384/1992: 1% sulla quota oltre la prima fascia di retribuzione pensionabile, dovuta quando l'aliquota a carico del lavoratore è inferiore al 10%. Assente in quasi tutti i calcolatori online |
| **Massimale contributivo** | Per chi è privo di anzianità al 31/12/1995: oltre il tetto la contribuzione si ferma e il netto marginale sale bruscamente |
| Minimale retributivo | Segnalato quando la retribuzione mensile scende sotto la soglia INPS |
| Fondo di categoria dei dirigenti | Quota a carico del dirigente, con tetto di retribuzione |
| Contribuzione a carico del datore | Differenziata per profilo, dichiarata come stima |

### 6.3 Competenza temporale

| Funzionalità | Nota |
|---|---|
| Giorni di rapporto nell'anno | Giorni di calendario, non presenze: assunzione o cessazione in corso d'anno ragguagliano **detrazioni, bonus cuneo e trattamento integrativo**, le soglie di reddito no |
| Part-time percentuale | Riduce la retribuzione maturata, non le soglie normative |
| Mensilità 12 / 13 / 14 | Modifica il divisore del netto mensile |

### 6.4 Welfare e compensi variabili

| Funzionalità | Nota |
|---|---|
| Fringe benefit | Soglia 1.000 € (2.000 € con figli a carico). Se superata, l'**intero** importo diventa imponibile: è una soglia, non una franchigia. Errore molto frequente |
| Buoni pasto | Limite giornaliero esente per anno e per tipo (elettronici o cartacei); l'eccedenza è imponibile e contributiva |
| Premio di risultato | Imposta sostitutiva 5% entro 3.000 € (2025) o 1% entro 5.000 € (2026-2027), per redditi da lavoro dipendente dell'anno precedente fino a 80.000 €; l'eccedenza torna a tassazione ordinaria. Richiede un contratto collettivo aziendale o territoriale depositato entro 30 giorni |
| Conversione del premio in welfare | Esente da imposte e contributi: alternativa esplicita, con confronto immediato sul netto |
| Straordinari, notturni e festivi | Imposta sostitutiva 5% per redditi fino a 33.000 € |
| Previdenza complementare | Contributo del lavoratore, contributo del datore in percentuale, destinazione del TFR. Vedi §6.14 |
| TFR maturato | RAL / 13,5 al netto del contributo dello 0,50% al Fondo di garanzia |
| **Altre trattenute** | Quota sindacale, cessione del quinto, pignoramenti, prestiti aziendali, mensa: un campo unico, perché si comportano tutte allo stesso modo. Vedi §6.15 |

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

### 6.11 Spiegazioni contestuali

Ogni voce che nasconde una regola porta un pulsante informativo che apre **la derivazione sui numeri del calcolo corrente**, non un testo di aiuto generico. A 30.000 € di RAL, la detrazione da lavoro dipendente si apre così:

> **Detrazione per lavoro dipendente**
> Fra 15.000 e 28.000 €: 1.910 € più una quota decrescente di 1.190 €. Fra 25.000 e 35.000 € si aggiunge il correttivo di fascia di 65 €.
>
> | | |
> |---|---:|
> | Detrazione di fascia | 1.979,29 € |
> | Correttivo | 65,00 € |
> | **Totale** | **2.044,29 €** |
>
> *TUIR art. 13*

Sono **32 in tutto**: 11 nella cascata di «Al banco», 19 in quella di «Al tavolo», 2 sulle card di sintesi. Le due cascate non spiegano le stesse cose: «Al tavolo» ha più voci perché ha più parametri, e nessuna spiegazione presente nella sezione semplice manca in quella avanzata. Compaiono solo quando la voce corrispondente entra nel calcolo, così l'interfaccia non si riempie di icone inutili. Coprono l'IRPEF scaglione per scaglione, la capienza, l'effetto scalino, il cuneo nelle sue due nature, il trattamento integrativo, l'aliquota aggiuntiva 1%, il massimale, i regimi agevolati, il ragguaglio ai giorni, la soglia dei fringe benefit e l'imposta sostitutiva sui premi.

Alcune si adattano al contesto: l'IRPEF lorda mostra anche quanto sarebbe con le aliquote dell'altro anno d'imposta; l'addizionale comunale cambia testo se il comune è esente, se ha scaglioni o se non ha ancora deliberato.

Servono a portare il contenuto di questo documento dentro l'interfaccia, dove viene effettivamente letto.

### 6.12 Uso quotidiano

- **Apertura a clic, tastiera e tocco.** I tooltip solo-hover sarebbero inaccessibili da telefono: l'apertura in hover è attiva solo dove esiste un puntatore vero. Sotto i 640px la spiegazione diventa un pannello ancorato al fondo dello schermo, con chiusura esplicita.
- **Esportazione.** *Copia CSV* mette il dettaglio negli appunti, pronto per un foglio di calcolo. *Stampa / PDF* produce una versione pulita, senza pulsanti né controlli.
- **Responsive verificato.** Nessuno scorrimento orizzontale a 390px: le colonne della griglia possono restringersi e lo scorrimento resta confinato alla tabella del dettaglio.

### 6.14 Fondi pensione di settore

I fondi negoziali sono modellati **per parametri, non per catalogo**: le percentuali variano per CCNL e nessun ente le pubblica in forma interrogabile, quindi inserirle a memoria significherebbe ripetere l'errore corretto al §8. Chi usa lo strumento indica il contributo del proprio fondo; il motore applica le tre regole che contano.

**Il contributo del datore spetta solo a chi versa.** È la regola dei fondi negoziali: chi non aderisce rinuncia al denaro dell'azienda. Il motore azzera il contributo aziendale quando il versamento del lavoratore è nullo, e l'interfaccia lo dichiara.

**Il tetto di deducibilità è unico.** I 5.164,57 € annui valgono per la somma dei versamenti del lavoratore e del datore: se l'azienda versa consuma capienza, e la quota del lavoratore è deducibile solo per la parte restante. La porzione di contributo aziendale che eccede il tetto **torna a essere reddito imponibile** per il lavoratore.

**Il TFR cambia natura.** Conferito al fondo non si accantona più in azienda e non sconta il contributo dello 0,50% al Fondo di garanzia, che riguarda l'accantonamento interno. La card del TFR dichiara la destinazione invece di mostrare un numero ambiguo.

Un esempio prodotto dal motore — operaio metalmeccanico a 32.000 €, versamento di 384 € l'anno, contributo aziendale al 2%, TFR conferito:

| | |
|---|---:|
| Netto annuo a cui rinuncia | −247,60 € |
| Versamento proprio | 384,00 € |
| Contributo dell'azienda | 640,00 € |
| TFR conferito | 2.370,37 € |
| **Accantonato nell'anno** | **3.394,37 €** |

Rinuncia a 247,60 € di netto e accumula 3.394,37 €. È il conto che un HR fa a voce davanti a un neoassunto, e che il calcolatore ora sa mostrare.

### 6.15 Altre trattenute

Un campo unico raccoglie le trattenute che escono dal netto **già tassato**: quota sindacale, cessione del quinto, pignoramenti, prestiti aziendali, mensa. Si comportano tutte allo stesso modo, quindi un solo parametro le copre.

Fiscalmente sono la voce più semplice del cedolino: **non sono oneri deducibili né detraibili**. Non toccano imponibile, imposte né contributi. È però la differenza fra il netto teorico e quello che arriva sul conto — la cifra che un dipendente contesta all'HR.

Due conseguenze che il motore rispetta:

- **La pressione fiscale le ignora.** Misura il prelievo dello Stato, non le spese personali del lavoratore: una quota sindacale non è un'imposta e non deve far salire quell'indicatore. Stesso criterio per il rapporto netto/costo azienda.
- **Non possono eccedere il netto disponibile.** Qui il limite è semplice, perché non hanno effetto fiscale: nessuna ricerca per approssimazioni, a differenza dei versamenti al fondo.

Il **limite del quinto** non viene imposto: il campo raccoglie voci diverse e solo la cessione del quinto vi è soggetta. Quando l'importo supera un quinto del netto, l'interfaccia lo segnala indicando il tetto di legge, lasciando all'utente il giudizio su quale voce stia inserendo.

### 6.16 Ottimizzazione del costo aziendale

Un euro di RAL e un euro di welfare non costano uguale all'azienda, perché non subiscono lo stesso prelievo. È il punto in cui il calcolatore smette di misurare una busta paga e comincia a rispondere a una domanda di impresa.

**Due direzioni, la stessa macchina.**

| Modalità | Domanda | Risposta |
|---|---|---|
| Dal netto desiderato | Il candidato chiede 2.000 € netti al mese: qual è il pacchetto che glieli consegna al minor costo? | Tre pacchetti a parità di valore, con il costo aziendale decrescente |
| Dal budget aziendale | Ho 50.000 € l'anno da spendere: qual è il valore massimo che posso consegnare? | Tre pacchetti a parità di spesa, con il valore crescente |

**Le due direzioni restano allineate.** Ottimizzando dal netto, il campo del budget si compila con la spesa che il pacchetto migliore comporta; partendo dal budget, l'obiettivo netto si aggiorna con quanto quella spesa riesce a consegnare. Si può proseguire nell'altra direzione senza ricopiare un numero a mano, e senza trovarne uno vecchio rimasto lì. L'andata e ritorno è coerente: 2.000 € netti al mese producono un budget di 38.868 €, che ricalcolato restituisce di nuovo 2.000 € al mese.

**Un solo punto d'ingresso per l'obiettivo netto.** La cifra che il candidato chiede si scrive una volta sola, nel riquadro *Dal netto alla RAL*, e da lì partono due azioni: **Trova la RAL** cerca la retribuzione che produce quella cifra, **Ottimizza** cerca il modo meno costoso di consegnarla. Duplicare il campo in due riquadri diversi avrebbe significato chiedere due volte la stessa cosa. Il budget, che non è un netto, resta l'ingresso speculare accanto ai risultati.

**L'efficienza è misurata, non dichiarata.** A ciascuno strumento viene aggiunta una quota e si osserva la variazione reale di costo aziendale e di valore ricevuto. Nessun coefficiente scritto a mano che poi invecchia:

| Strumento | Ricevuto per ogni euro speso |
|---|---:|
| Fringe benefit entro soglia | 1,00 € |
| Buoni pasto entro il limite | 1,00 € |
| Premio convertito in welfare | 1,00 € |
| Premio in denaro | 0,65 € |
| Retribuzione ordinaria | 0,37 € |

Il dato sulla retribuzione è marginale: a 45.000 € di RAL, l'euro aggiuntivo sconta contributi del datore e del lavoratore, IRPEF marginale al 33%, addizionali e perdita progressiva delle detrazioni.

**Risultato concreto.** Per consegnare 26.000 € di valore annuo: 48.114 € di costo con la sola retribuzione, **38.868 € con il pacchetto ottimizzato**. Sono 9.246 € risparmiati, il 19%.

**Cosa il lavoratore guadagna e cosa rinuncia.** Un confronto che mostrasse solo il risparmio dell'azienda sarebbe metà della verità. Il welfare non passa dalla busta paga, e ciò che non è retribuzione non costruisce pensione né matura TFR. Il pannello espone le due colonne affiancate.

Sull'esempio dei 26.000 € di valore annuo:

| Guadagna | | Rinuncia | |
|---|---:|---|---:|
| Welfare esente da imposte | 6.200 € | Retribuzione lorda dichiarata | −11.216 € |
| Costo aziendale in meno | 9.246 € | TFR maturato nell'anno | −775 € |
| | | Accantonamento pensionistico | −3.701 € |

Sono **4.476 € l'anno di accantonamenti differiti**, calcolati con l'aliquota di computo del 33% che alimenta il montante contributivo. Cala anche la base per NASpI, malattia e maternità, e il reddito che una banca legge per concedere un mutuo. Il minor costo per l'azienda non sparisce: è il margine su cui si può trattare l'offerta, ed è giusto che entrambe le parti lo vedano.

**Ottimizzazione rispetto alle soglie.** Non tutte le soglie sono uguali: alcune cambiano solo l'aliquota marginale, e attraversarle non costa nulla di netto; altre sono gradini, e superarle di un euro fa perdere un importo intero. Spostare retribuzione su welfare abbassa l'imponibile e può riportarlo sotto un gradino.

Il calcolo cerca la soglia più conveniente fra quelle raggiungibili con la capienza welfare disponibile — inclusa **l'esenzione comunale del comune selezionato**, che varia da comune a comune — e quantifica il recupero. Con un imponibile di 24.065 €:

> L'imponibile supera di poco la soglia del **bonus del cuneo fiscale** (20.000 €). Spostando 4.481 € dalla retribuzione al welfare, l'imponibile scende a 19.995 € e il lavoratore recupera **1.937 € l'anno**.

Sceglie l'occasione con il recupero maggiore, non la più vicina: l'esenzione comunale di Milano era a soli 1.173 € di distanza, ma vale 192 € contro i 1.937 € del cuneo. E non suggerisce nulla a chi è già sotto tutte le soglie.

**Tre vincoli che l'ottimizzatore rispetta.**

- Non supera mai le soglie di esenzione: oltre la soglia il fringe benefit diventa imponibile per intero e il vantaggio evapora. È l'effetto scalino del §4.2 applicato a un altro istituto.
- Segnala quando il premio di risultato non spetta, perché il reddito supera gli 80.000 € o manca il contratto aziendale.
- Dichiara sempre quanta parte del valore arriva come denaro e quanta come welfare vincolato. Non li somma fingendo che siano la stessa cosa: nel pacchetto migliore dell'esempio, il 76,2% è denaro in busta.

### 6.17 Tipo di rapporto, separato da settore e inquadramento

La prima versione mescolava tre assi in un unico selettore: settore, inquadramento e tipo di contratto. Non era possibile simulare *un apprendista nell'industria* o *un operaio a tempo determinato*, perché erano alternative mutuamente esclusive. Ora sono due dimensioni indipendenti che si combinano.

Ma il punto vero non era la combinatoria: era che ogni voce cambiava **soltanto due aliquote**, mentre certi rapporti cambiano la natura stessa del reddito.

| Tipo | Cosa cambia davvero |
|---|---|
| **Indeterminato** | Contribuzione ordinaria del settore |
| **Tempo determinato** | Contributo addizionale NASpI dell'1,40% **a carico del solo datore**: la busta paga del lavoratore è identica, cambia solo il costo aziendale. A 24.000 € sono 336 € l'anno |
| **Apprendistato** | Aliquota del lavoratore fissata per legge al 5,84%, indipendente dal settore scelto |
| **Collaborazione coordinata e continuativa** | Non è lavoro dipendente né lavoro autonomo: Gestione separata INPS al 35,03%, divisa per un terzo sul collaboratore e due terzi sul committente |
| **Tirocinio / stage** | Non è un'aliquota diversa: è un reddito diverso |

**Il tirocinio è il caso che valeva la pena modellare.** L'indennità non è reddito di lavoro dipendente ma **assimilato**, ex art. 50, comma 1, lettera c) del TUIR. Le conseguenze sono strutturali:

- **Nessun contributo previdenziale.** L'imponibile IRPEF coincide con l'intera indennità, non con l'indennità al netto dei contributi. A parità di importo lordo il tirocinante paga *più* IRPEF di un dipendente, non meno.
- **Nessun TFR, nessuna mensilità aggiuntiva.** I controlli che non hanno effetto vengono disattivati invece di restare attivi e ininfluenti.
- **La detrazione dell'art. 13 spetta**, ed è ragguagliata ai giorni: il comma 1 richiama espressamente l'art. 50 comma 1 lettera c). L'ho verificato sul testo della norma, perché due fonti secondarie sostenevano che si applicasse la detrazione per "taluni redditi assimilati" del comma 5 — che invece riguarda le lettere e), f), g), h), i), non la c).
- **Cuneo fiscale e trattamento integrativo non sono riconosciuti**, perché si rivolgono ai titolari di reddito di lavoro dipendente. Questa è un'interpretazione, non un calcolo, ed è dichiarata come tale nell'avviso in pagina.
- **Costo per il soggetto ospitante**: indennità più copertura INAIL, senza contribuzione previdenziale.

**La collaborazione coordinata e continuativa è il secondo caso in cui cambia la natura del reddito**, e ha richiesto di distinguere tre istituti che sembrano uno solo:

- **Contributi**: Gestione separata al 35,03% (33% IVS più 0,50%, 0,22% e 1,31% DIS-COLL), ripartita per legge in un terzo a carico del collaboratore e due terzi a carico del committente. Il massimale di 122.295 € qui non è una casella da spuntare come per i dipendenti: si applica sempre, e l'interfaccia lo mostra spuntato e disattivato.
- **Detrazione dell'art. 13, comma 1**: spetta, perché la norma richiama la lettera c-bis) dell'art. 50.
- **Trattamento integrativo**: spetta. Il D.L. 3/2020 elenca espressamente la lettera c-bis) fra i redditi ammessi.
- **Taglio del cuneo 2025**: *non* spetta. La Legge di Bilancio 2025 si rivolge ai «titolari di reddito di lavoro dipendente di cui all'articolo 49», e la collaborazione è reddito assimilato dell'art. 50.

Le ultime due voci sono la ragione per cui questa distinzione andava verificata riga per riga sulle due norme invece che assumere un comportamento unico per «i redditi assimilati»: due istituti nati per lo stesso scopo hanno perimetri diversi. Niente TFR e niente mensilità aggiuntive: il compenso si divide per dodici.

Resta fuori la **somministrazione**, che aggiunge i contributi ai fondi bilaterali.

### 6.20 Partita IVA: un secondo motore, non un ramo

Il lavoro autonomo ha una sezione propria, accanto a Base e Premium, e un motore separato — `calcolaAutonomo` — che non passa da `calcolaPremium`. Non è una scelta estetica: nel lavoro autonomo non c'è una busta paga da ricostruire, non esistono TFR, mensilità aggiuntive, welfare aziendale né un datore che versa due terzi dei contributi, e soprattutto **cambia l'ordine dei fattori**. I contributi si calcolano sul reddito e poi si deducono dallo stesso reddito; nel forfetario l'imposta sostitutiva prende il posto di IRPEF e addizionali. Innestare tutto questo come ramo del motore dei dipendenti avrebbe prodotto una funzione piena di eccezioni, cioè il posto dove nascono gli errori.

| Regime | Come si arriva al netto |
|---|---|
| **Ordinario** | Fatturato − costi = reddito; contributi Gestione separata 26,07%, deducibili; IRPEF a scaglioni con la detrazione dell'**art. 13, comma 5** (non quella dei dipendenti: a 20.000 € vale circa la metà); addizionali regionale e comunale |
| **Forfetario 15%** | Reddito = fatturato × coefficiente ATECO dell'allegato 4 (dal 40% all'86%); contributi sul reddito così determinato e deducibili; imposta sostitutiva del 15% al posto di IRPEF, addizionali e IRAP |
| **Forfetario 5%** | Identico al precedente con aliquota al 5%, per i primi cinque anni di una nuova attività |

Tre conseguenze che il calcolatore rende visibili invece di nasconderle:

- **Nel forfetario i costi effettivi non contano.** Vale il coefficiente, che dipende dal codice ATECO e non da quanto si è speso: per un professionista al 78% il regime è conveniente finché i costi reali restano sotto il 22% del fatturato. Il campo dei costi sparisce quando si sceglie il forfetario, invece di restare lì a suggerire un effetto che non c'è.
- **Il comune di residenza non sposta il netto forfetario di un centesimo**, perché l'imposta sostitutiva sostituisce anche le addizionali locali. È un risultato, non una svista, ed è asserito da un test che confronta lo stesso fatturato a Milano e a Roma.
- **La tabella di confronto fra i tre regimi** sta accanto al dettaglio: la domanda vera di chi apre una partita IVA non è quanto paga, ma quale regime gli conviene a parità di fatturato.

**Limiti dichiarati anche in pagina:** la previdenza modellata è la Gestione separata INPS, quella di chi non ha una cassa professionale — casse di categoria, artigiani e commercianti hanno minimali e regole proprie; i contributi sono imputati all'anno di competenza, senza acconti, saldo e cassa sfalsata; l'IVA non entra nel calcolo; le cause di esclusione dal forfetario (redditi da lavoro dipendente sopra 35.000 €, partecipazioni societarie, prevalenza dell'ex datore di lavoro) non sono verificate, mentre il superamento della soglia di 85.000 € è segnalato.

### 6.18 Esoneri contributivi all'assunzione

Sono la leva con cui un HR decide *chi* assumere e *come*, e mancavano del tutto. A differenza delle aliquote territoriali non sono un dataset: nascono da leggi che ne cambiano la **struttura**, non solo gli importi.

**Vigenti al 21 agosto 2026**, verificati sulle fonti:

| Misura | Incide su | Entità | Fonte |
|---|---|---|---|
| Decontribuzione Sud — PMI | Datore | 20%, max 125 €/mese nel 2026 | L. 207/2024 c. 406-412 — INPS circ. 32/2025 |
| Bonus Donne | Datore | 100%, max 650 €/mese, 24 mesi | D.L. 60/2024 art. 23 — prorogato dal D.L. 200/2025 |
| Esonero assunzione madri con tre figli | Datore | 100%, max 8.000 € l'anno | L. 199/2025 c. 210-213 — INPS circ. 82/2026 |
| Esonero lavoratrici madri con 3+ figli | Lavoratrice | 100% quota IVS, max 3.000 € l'anno | L. 213/2023 — resa strutturale dalla L. 207/2024 |
| Incentivo alla stabilizzazione degli under 35 | Datore | 100%, max 500 €/mese, 24 mesi | D.L. 62/2026 art. 4, conv. L. 112/2026 — INPS circ. 72/2026 |

**Scadute, e il calcolatore lo dice da solo:** Bonus Giovani under 35 e Bonus ZES. La proroga per il 2026 copriva le sole assunzioni fino al 30 aprile: restano visibili, marcate *scadute*, non selezionabili. Nasconderle lascerebbe credere che non esistano; applicarle sarebbe peggio.

**Due comportamenti che vale la pena distinguere.** Un esonero sul datore riduce il costo aziendale e **non tocca la busta paga**. Un esonero sulla quota della lavoratrice alza il netto, ma anche l'imponibile: ciò che non si versa all'INPS resta reddito tassabile, quindi su 2.757 € esonerati ne arrivano 1.612. L'aliquota di computo pensionistico resta comunque piena — l'esonero non intacca la pensione futura.

**Un incentivo che non premia l'assunzione ma la trasformazione.** L'ultima misura della tabella si applica solo al passaggio a tempo indeterminato, fra il 1° agosto e il 31 dicembre 2026, di un rapporto a termine instaurato entro il 30 aprile 2026, senza soluzione di continuità e di durata complessiva non superiore a dodici mesi; il lavoratore deve avere meno di 35 anni e non essere mai stato occupato a tempo indeterminato. È anche l'unica ad ammettere gli operai agricoli — che la decontribuzione Sud invece esclude — e a escludere i dirigenti. Restano fuori pubbliche amministrazioni, lavoro domestico, apprendistato e trasformazione del lavoro intermittente; i premi INAIL restano dovuti. Il calcolatore modella ciò che incide sul costo — percentuale, tetto, finestra, ambito — e dichiara nelle condizioni ciò che non può verificare: DURC regolare e incremento occupazionale netto sulla media dei dodici mesi precedenti.

Il **cumulo vietato** dalla legge è codificato: decontribuzione Sud e bonus del decreto Coesione non sono compatibili, la stabilizzazione non si cumula con nessun altro esonero sulle aliquote del datore, e l'interfaccia impedisce la combinazione invece di produrre un numero impossibile.

### 6.21 L'ordine delle card dei parametri

Le sei card della colonna sinistra seguono **l'ordine in cui ogni parametro entra nel calcolo**, cioè lo stesso ordine della cascata dei risultati che sta a destra:

1. **Contratto** — retribuzione, tipo di rapporto, inquadramento: da qui nascono lordo e contributi
2. **Esoneri all'assunzione** — agiscono sui contributi appena calcolati
3. **Welfare, premi e trattenute** — costruiscono l'imponibile fiscale, o lo aggirano restando esenti
4. **Regimi fiscali agevolati** — abbattono l'imponibile IRPEF, mai la base contributiva
5. **Carichi di famiglia** — detrazioni sull'IRPEF lorda
6. **Residenza fiscale** — addizionali regionale e comunale, ultimo anello della catena

L'ordine precedente metteva la residenza fiscale al secondo posto e gli esoneri al quinto: alfabeticamente innocuo, ma chiedeva di saltare avanti e indietro nella busta paga per capire dove ciascun parametro agisse. Leggere le card dall'alto verso il basso ora ricalca la lettura del cedolino.

### 6.19 Sorveglianza normativa

Le aliquote territoriali si aggiornano da sole perché sono un dataset. Gli esoneri no: nessun automatismo può leggere una legge e tradurla in codice. Quello che si può automatizzare è **accorgersi che qualcosa si è mosso**, e ridurre il danno quando nessuno se ne accorge.

- **Scadenza automatica.** Ogni misura porta la propria finestra di vigenza. Il motore la confronta con la data odierna e disattiva ciò che è scaduto, senza attendere che qualcuno intervenga. È il rimedio al modo peggiore di sbagliare: applicare un esonero che non esiste più.
- **Data di verifica.** Ogni voce dichiara in pagina quando è stata controllata l'ultima volta, insieme alla norma e alla circolare INPS.
- **Sorveglianza dei feed.** Un workflow settimanale legge i feed RSS delle circolari e dei messaggi INPS, filtra per parole chiave — *esonero, decontribuzione, aliquote, massimali* — scarta il rumore delle convenzioni sindacali e apre una segnalazione con i link. Non interpreta: dice dove guardare.

Questa sorveglianza ha già prodotto un risultato al primo avvio: ha segnalato la **circolare INPS n. 82 del 29 luglio 2026**, che introduce l'esonero per l'assunzione di madri con tre figli. Quella misura non era nel mio elenco iniziale ed è stata aggiunta grazie alla segnalazione. Ha inoltre intercettato l'incentivo alla stabilizzazione dei rapporti a termine (D.L. 62/2026, INPS circ. 72/2026), oggi modellato: dalla segnalazione alla misura in tabella, il ciclo si è chiuso due volte.

### 6.13 Cosa non è conoscibile, e come viene dichiarato

Un calcolatore che presenta come esatto un numero che nessuno può conoscere perde credibilità presso chi il mestiere lo fa. Tre voci della sezione Premium hanno un margine di incertezza che non dipende dall'implementazione, e sono marcate come tali nell'interfaccia:

| Voce | Perché non è conoscibile | Come viene dichiarato |
|---|---|---|
| **Costo azienda** | Il premio INAIL varia dallo 0,4% a oltre il 13% secondo la lavorazione; qui è fissato allo 0,5%, valore da ufficio. Le aliquote a carico del datore variano per CCNL, dimensione e ATECO | La card porta la dicitura *"stima, non un preventivo"* e una spiegazione che scompone il calcolo e nomina l'incertezza |
| **Netto in busta più welfare** | Sommare denaro e benefit produce un numero solo, e un numero solo si legge come stipendio. Ma mille euro di buoni pasto non sono mille euro in busta: sono vincolati nell'uso, non costruiscono pensione né TFR, e le banche non li leggono come reddito | La card non si chiama più «valore totale» e la cifra non è verde: sotto compare una barra che mostra la proporzione fra le due metà, e una riga in ambra dichiara quanta parte è welfare vincolato. La spiegazione apre dicendo che non è uno stipendio più alto |
| **Minimale contributivo** | Sotto la soglia INPS i contributi andrebbero calcolati sul minimale, non sulla retribuzione effettiva | L'avviso dice esplicitamente che il motore **non** applica la correzione e che i contributi risultano sottostimati |

La regola seguita: dove il dato è normativo si calcola; dove dipende da variabili che il calcolatore non può conoscere, si dichiara.

### Limiti dichiarati

Dichiarati anche nell'interfaccia, non solo qui:

- Le aliquote contributive vengono dalle **tabelle INPS** e si scelgono su tre assi — settore, qualifica, dimensione dell'organico — perché sono i tre che le determinano. La quota a carico del datore è la differenza fra il totale di tabella e la quota del lavoratore: una sottrazione, non una stima. Restano stime dichiarate solo agricoltura e lavoro domestico.
- Le detrazioni per carichi di famiglia sono calcolate sul reddito del solo dichiarante.
- Il taglio forfettario di 440 € sulle detrazioni al 19% per redditi oltre 200.000 € non è modellato, perché il calcolatore non gestisce oneri detraibili: senza oneri, non c'è nulla da tagliare.
- Il fringe benefit da auto aziendale va inserito come importo già valorizzato: il motore non calcola le tabelle ACI.
- Per la partita IVA la previdenza modellata è la **Gestione separata INPS**: chi versa a una cassa professionale o alle gestioni artigiani e commercianti ha minimali e regole proprie, non implementate. I contributi sono imputati per competenza, senza acconti e saldo. L'IVA resta fuori dal calcolo.

---

## 7. Perimetro del prototipo

Fuori scope, in modo deliberato:

- Conguaglio fiscale di fine anno e criterio di cassa sulle addizionali (acconto e saldo)
- Tassazione separata di arretrati e TFR liquidato
- Detrazioni per oneri (spese sanitarie, interessi passivi, ristrutturazioni) e relativo taglio forfettario oltre 200.000 €
- Minimi tabellari, scatti di anzianità e superminimi previsti dai singoli CCNL
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
| Soglie fringe benefit (1.000 € / 2.000 € con figli) | TUIR art. 51, comma 3; L. 207/2024 (Legge di Bilancio 2025), che le fissa per il triennio 2025-2027 |
| Buoni pasto esenti: 8 €/giorno nel 2025, 10 €/giorno dal 2026; cartacei 4 €/giorno | TUIR art. 51, comma 2 lett. c); L. 199/2025 (Legge di Bilancio 2026), art. 1 comma 14 |
| Premio di risultato: imposta sostitutiva 1% entro 5.000 € per il 2026-2027 | L. 208/2015, art. 1 commi 182-189; L. 199/2025, art. 1 comma 9 |
| Quota TFR (retribuzione / 13,5) e contributo 0,50% al Fondo di garanzia | Art. 2120 c.c.; L. 297/1982 |
| Seconda aliquota IRPEF 2026 al 33% e sterilizzazione oltre 200.000 € | Legge di Bilancio 2026; [scheda MEF sulle principali misure](https://www.mef.gov.it/focus/Principali-misure-della-legge-di-bilancio-2026/) |
| Massimale contributivo, minimale retributivo e prima fascia pensionabile | INPS, circolare n. 6 del 30 gennaio 2026; circolari annuali su minimali e massimali |
| Aliquota aggiuntiva 1% | Art. 3-ter D.L. 384/1992, conv. L. 438/1992 |
| Gestione separata: 35,03% per i collaboratori (un terzo e due terzi), 26,07% per i professionisti, massimale 122.295 € | INPS, circolare n. 8 del 3 febbraio 2026 |
| Detrazione per redditi di lavoro autonomo | TUIR, art. 13, comma 5 |
| Regime forfetario: soglia 85.000 €, imposta sostitutiva 15% e 5%, coefficienti di redditività per gruppo ATECO | L. 190/2014, art. 1, commi 54-89 e **allegato 4** |
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
| Esenzioni comunali riservate ad altre categorie | Applicate anche ai dipendenti | **Filtrate**: 17 comuni deliberano esenzioni per pensionati, lavoro autonomo o compensi sportivi. Ad Acerra convivono tre soglie e quella dei dipendenti è 8.174 €, non gli 8.500 € dei pensionati |
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
5. Comprime il risultato: anagrafe scritta una sola volta, tariffe posizionali, 2026 come diff sul 2025 (solo 509 comuni differiscono). Il `dataset.js` prodotto scende da 495 KB a **267 KB**, che incorporati in `index.html` diventano 252 KB al netto dell'intestazione. La proprietà di file unico resta intatta.

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
├── build/
│   └── sorveglia_norme.py          # Legge i feed INPS e segnala le novita' rilevanti
└── .github/workflows/
    ├── aggiorna-dati.yml           # Ricontrolla le delibere il 1 e il 15 di ogni mese
    └── sorveglia-norme.yml         # Sorveglia le circolari INPS ogni lunedi'
```

`index.html` pesa circa **425 KB**, di cui **252 KB** sono il dataset ufficiale delle aliquote territoriali: il motore di calcolo, la suite di test e l'intera interfaccia occupano i 173 KB restanti. L'applicazione resta un unico file autosufficiente: `build/` serve solo a rigenerare i dati, non è richiesto per eseguirla.

Il repository è collegato a Vercel: ogni push sul ramo `main` pubblica il sito, e ogni pull request genera un'anteprima con indirizzo proprio. La pull request aperta dal workflow di aggiornamento dati è quindi ispezionabile prima di essere accettata.

**Riproducibilità.** Lo script scarica da solo le fonti mancanti dal Dipartimento delle Finanze:

```bash
cd build && python build_dataset.py
```

Da una cartella vuota, produce un `dataset.js` **identico byte per byte** a quello incorporato in `index.html`, insieme a un report di controllo: numero di comuni, quanti hanno deliberato per l'anno corrente, quanti ereditano l'anno precedente, e le aliquote di alcuni comuni di riferimento.
