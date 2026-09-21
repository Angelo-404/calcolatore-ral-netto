/* Esegue la suite di regressione di index.html fuori dal browser.
 *
 * La suite vive dentro la pagina perche' e' anche uno strumento per chi la
 * legge: il bottone «Esegui test» mostra a schermo cosa il motore garantisce.
 * Lasciarla solo li' pero' significava che nessuno la eseguiva prima di un
 * commit. Questo script ritaglia da index.html il motore e la suite, mette
 * al posto del DOM il minimo indispensabile e riporta l'esito con un codice
 * di uscita, cosi' la CI puo' bocciare una modifica che rompe i conti.
 *
 * Il ritaglio e' volutamente fragile: se index.html cambia struttura lo
 * script si ferma con un messaggio, invece di eseguire una suite monca e
 * dichiararla superata.
 *
 *     node build/prova_motore.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RADICE = path.dirname(__dirname);
const SORGENTE = path.join(RADICE, 'index.html');
const PRIMO_DOM = 'const el = (id) => document.getElementById(id);';

function muori(messaggio) {
  console.error('prova_motore: ' + messaggio);
  process.exit(2);
}

/* Ritaglia da `testo` il blocco che comincia con `apertura` e finisce alla
   prima occorrenza di `chiusura`. Le dichiarazioni di primo livello della
   pagina chiudono a colonna zero, quindi `\n}` e `\n};` sono terminatori
   affidabili: le graffe annidate sono tutte indentate. */
function ritaglia(testo, apertura, chiusura) {
  const inizio = testo.indexOf(apertura);
  if (inizio < 0) muori(`blocco non trovato in index.html: ${apertura}`);
  const fine = testo.indexOf(chiusura, inizio + apertura.length);
  if (fine < 0) muori(`fine del blocco non trovata: ${apertura}`);
  return testo.slice(inizio, fine + chiusura.length);
}

const pagina = fs.readFileSync(SORGENTE, 'utf8');
const blocchi = [...pagina.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!blocchi.length) muori('nessun blocco <script> in index.html');

const script = blocchi[blocchi.length - 1];
if (!script.includes(PRIMO_DOM)) {
  muori("punto di taglio non trovato: index.html e' cambiato, aggiorna PRIMO_DOM");
}

/* Tutto cio' che precede il primo accesso al DOM e' motore puro: costanti,
   funzioni e orchestratori. Lo stesso taglio di build/estrai_motore.py. */
const motore = script.slice(0, script.indexOf(PRIMO_DOM));

/* Dopo il taglio restano quattro dipendenze della suite, che vivono in mezzo
   al codice di interfaccia ma non toccano il DOM. */
const contorno = [
  ritaglia(script, 'const PROVINCE_REGIONE = {', '\n};'),
  ritaglia(script, 'const ANNO_RIFERIMENTO = ', ';'),
  ritaglia(script, 'function improntaMotore() {', '\n}'),
  ritaglia(script, 'function eseguiTest() {', '\n}')
].join('\n\n');

/* La suite scrive il proprio esito in pagina come ultima cosa che fa. Fuori
   dal browser quel nodo non esiste: se ne fornisce uno finto, che ingoia
   l'HTML senza farne nulla. L'esito vero arriva dal valore restituito. */
const finta = {
  innerHTML: '', textContent: '', value: '', hidden: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, dataset: {},
  setAttribute() {}, removeAttribute() {}, appendChild() {},
  addEventListener() {}, querySelector() { return null; },
  querySelectorAll() { return []; }
};

const ambiente = vm.createContext({
  el: () => finta,
  document: { getElementById: () => finta, createElement: () => finta, body: finta },
  console,
  Intl,
  Date,
  Math,
  JSON
});

try {
  vm.runInContext(motore + '\n' + contorno + '\nglobalThis.__risultati = eseguiTest();',
                  ambiente, { filename: 'index.html:script' });
} catch (errore) {
  muori('la suite ha sollevato un errore: ' + errore.message);
}

const risultati = ambiente.__risultati;
if (!Array.isArray(risultati) || !risultati.length) {
  muori('eseguiTest() non ha restituito l’elenco dei test: '
      + 'controlla che la funzione termini con `return risultati;`');
}

const falliti = risultati.filter((r) => !r.esito);
const superati = risultati.length - falliti.length;

for (const r of falliti) {
  console.error(`  ✗ ${r.nome}${r.dettaglio ? ' — ' + r.dettaglio : ''}`);
}

console.log(`${superati}/${risultati.length} test superati`);
process.exit(falliti.length ? 1 : 0);
