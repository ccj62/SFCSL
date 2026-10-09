/**
 * SFCSL til SFC i Google Sheets.
 *
 * Skriv et SFCSL-program i kolonne A i arket "SFCSL". Scriptet tegner
 * SFC-diagrammet med celler og kanter i arket "SFC".
 *
 * Parser og validering er de samme som i sfcsl-mermaid-editor.html.
 * Se README.md i denne mappe for, hvordan scriptet installeres.
 */

// ---------------------------------------------------------------------------
// SFCSL: tokenizer, parser og validering (samme kode som HTML-editoren).
// ---------------------------------------------------------------------------

const TOK = /\/\/[^\n]*|S(?:0|[1-9]\d*)(?!\d)|t(?:0|[1-9]\d*)(?!\d)|>>|[()\[\]]|\s+/y;

function tokenize(text) {
  const toks = [];
  let pos = 0;
  while (pos < text.length) {
    TOK.lastIndex = pos;
    const m = TOK.exec(text);
    if (!m) throw new Error('Ulovligt tegn: ' + JSON.stringify(text.slice(pos, pos + 12)));
    pos = TOK.lastIndex;
    const s = m[0];
    if (/^\s+$/.test(s) || s.startsWith('//')) continue;
    toks.push(s);
  }
  return toks;
}

function kind(t) {
  if (t === null || t === undefined) return null;
  if (/^S(?:0|[1-9]\d*)$/.test(t)) return 'S';
  if (/^t(?:0|[1-9]\d*)$/.test(t)) return 'T';
  return t;
}

class Parser {
  constructor(toks) { this.t = toks; this.i = 0; }
  pk(k = 0) { const j = this.i + k; return j < this.t.length ? this.t[j] : null; }
  nx() { const t = this.pk(); this.i++; return t; }
  closerS() { return kind(this.pk()) === 'S' && this.pk(1) === ')'; }
  closerT() { return kind(this.pk()) === 'T' && this.pk(1) === ']'; }
  chain(first) {
    const items = [];
    let expect = first;
    for (;;) {
      const k = kind(this.pk());
      if (k === null) break;
      if (expect === 'S') {
        if (k !== 'S' || this.closerS()) break;
        items.push(['S', this.nx()]);
        expect = 'T';
        while (this.pk() === '(') items.push(this.alt());
      } else {
        if (k !== 'T' || this.closerT()) break;
        items.push(['T', this.nx()]);
        expect = 'S';
        while (this.pk() === '[') items.push(this.par());
        if (this.pk() === '>>') {
          this.nx();
          const tgt = this.nx();
          if (kind(tgt) !== 'S') throw new Error('Et hop skal pege på et trin');
          items.push(['JUMP', tgt]);
          break;
        }
      }
    }
    return items;
  }
  alt() {
    this.nx();
    const brs = [];
    let c;
    for (;;) {
      if (this.closerS()) { c = this.nx(); this.nx(); break; }
      if (kind(this.pk()) !== 'T') throw new Error('En alt-gren skal starte med en transition, fandt ' + this.pk());
      const b = this.chain('T');
      if (!b.length) throw new Error('Uventet lukning i en alt-gren');
      brs.push(b);
    }
    if (brs.length < 2) throw new Error('En alt-blok skal have mindst to grene');
    return ['ALT', brs, c];
  }
  par() {
    this.nx();
    const brs = [];
    let c;
    for (;;) {
      if (this.closerT()) { c = this.nx(); this.nx(); break; }
      if (kind(this.pk()) !== 'S') throw new Error('En par-gren skal starte med et trin, fandt ' + this.pk());
      const b = this.chain('S');
      if (!b.length) throw new Error('Uventet lukning i en par-gren');
      brs.push(b);
    }
    if (brs.length < 2) throw new Error('En par-blok skal have mindst to grene');
    return ['PAR', brs, c];
  }
}

const END = { S: 'S', T: 'T', JUMP: 'J', ALT: 'S', PAR: 'T' };
function endkind(items) { return END[items[items.length - 1][0]]; }

function checkEnds(items, ctx) {
  const e = endkind(items);
  if (ctx === 'main' && e !== 'S') throw new Error('Hovedkæden skal slutte med et trin (sluttrinnet)');
  if (ctx === 'par' && e !== 'S') throw new Error('En par-gren skal slutte med et trin');
  if (ctx === 'alt' && e !== 'T' && e !== 'J') throw new Error('En alt-gren skal slutte med en transition eller et hop');
  for (const it of items) {
    if (it[0] === 'ALT') for (const b of it[1]) checkEnds(b, 'alt');
    else if (it[0] === 'PAR') for (const b of it[1]) checkEnds(b, 'par');
  }
}

function parse(text) {
  const p = new Parser(tokenize(text));
  if (kind(p.pk()) !== 'S') throw new Error('Sekvensen skal starte med et trin');
  const items = p.chain('S');
  if (p.pk() !== null) throw new Error('Uventet ' + p.pk());
  checkEnds(items, 'main');
  return items;
}

function validate(items) {
  const errs = [], defs = {}, seen = new Set(), jumps = [];
  let counter = 0;
  function walk(chain, scope) {
    let lastT = null;
    for (const it of chain) {
      const k = it[0];
      if (k === 'S' || k === 'T') {
        const id = it[1];
        if (seen.has(id)) errs.push(`${id} er defineret mere end én gang`);
        seen.add(id);
        defs[id] = scope;
        if (k === 'T') lastT = id;
      } else if (k === 'JUMP') {
        jumps.push([lastT, it[1], scope]);
      } else {
        for (const b of it[1]) {
          if (k === 'PAR') {
            counter++;
            walk(b, scope + '/' + counter);
            const tail = b[b.length - 1];
            if (tail[0] === 'ALT' && tail[1].every(x => endkind(x) === 'J'))
              errs.push(`Alt-blokken, der lukkes af ${tail[2]}, står sidst i en par-gren, men ingen af dens grene når lukkeren`);
          } else walk(b, scope);
        }
        const cid = it[2];
        if (seen.has(cid)) errs.push(`${cid} er defineret mere end én gang`);
        seen.add(cid);
        defs[cid] = scope;
        if (k === 'PAR') lastT = cid;
      }
    }
  }
  walk(items, '');
  for (const [src, tgt, scope] of jumps) {
    if (!(tgt in defs)) errs.push(`Hop ${src} >> ${tgt}: målet findes ikke`);
    else if (defs[tgt] !== scope) errs.push(`Hop ${src} >> ${tgt}: går ind i eller ud af en par-gren`);
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Layout: oversætter parserens liste til et gitter af celler med kanter.
// Hver bane (lane) i diagrammet fylder tre kolonner: L, R og X.
// Den lodrette forbindelseslinje er højre kant af L. Trin er L+R flettet
// sammen med en ramme om. Transitioner er en tyk bundkant på L+R med navnet
// i X. Alternativ forgrening er en enkelt vandret linje, parallel forgrening
// en dobbelt.
// ---------------------------------------------------------------------------

const FOERSTE_KOLONNE = 2;  // kolonne B
const FOERSTE_RAEKKE = 3;   // række 3 (række 1 bruges til status)

function layoutSFC(items, prio) {
  const m = { cells: {}, maxRow: 0, maxCol: 0 };
  let initial = true;
  const colL = lane => FOERSTE_KOLONNE + lane * 3;
  const colR = lane => colL(lane) + 1;
  const colX = lane => colL(lane) + 2;

  function cell(r, c) {
    const k = r + ',' + c;
    if (!m.cells[k]) m.cells[k] = { r, c, b: {} };
    m.maxRow = Math.max(m.maxRow, r);
    m.maxCol = Math.max(m.maxCol, c);
    return m.cells[k];
  }
  const border = (r, c, side, style) => { cell(r, c).b[side] = style; };
  const vline = (r, lane) => border(r, colL(lane), 'right', 'SOLID');

  // Vandret linje fra midten af bane a til midten af bane b (a < b).
  function hline(r, a, b, side, style) {
    if (a >= b) return;
    border(r, colR(a), side, style);
    border(r, colX(a), side, style);
    for (let l = a + 1; l < b; l++) for (const c of [colL(l), colR(l), colX(l)]) border(r, c, side, style);
    border(r, colL(b), side, style);
  }

  function step(r, lane, name, initial) {
    const c = cell(r, colL(lane));
    cell(r, colR(lane));
    Object.assign(c, { text: name, merge: 2, box: initial ? 'DOUBLE' : 'SOLID', bold: true });
  }

  function transition(r, lane, label) {
    vline(r, lane);
    border(r, colL(lane), 'bottom', 'SOLID_THICK');
    border(r, colR(lane), 'bottom', 'SOLID_THICK');
    Object.assign(cell(r, colX(lane)), { text: label, label: true });
  }

  function jump(r, lane, target) {
    const c = cell(r, colL(lane));
    cell(r, colR(lane));
    Object.assign(c, { text: '▼ ' + target, merge: 2 });
  }

  function width(chain) {
    let w = 1;
    for (const it of chain) {
      if (it[0] === 'ALT' || it[0] === 'PAR') w = Math.max(w, it[1].reduce((s, b) => s + width(b), 0));
    }
    return w;
  }

  // Tegner en kæde fra (row, lane). Returnerer næste ledige række, og om
  // linjen fortsætter nedad (false hvis kæden slutter med et hop).
  function chain(items, lane, row, first, pr) {
    for (const [i, it] of items.entries()) {
      const k = it[0];
      if (i > 0 || !first) { vline(row, lane); row++; }
      if (k === 'S') {
        step(row++, lane, it[1], initial);
        initial = false;
      } else if (k === 'T') {
        transition(row++, lane, it[1] + (pr && i === 0 ? ' (' + pr + ')' : ''));
      } else if (k === 'JUMP') {
        jump(row++, lane, it[1]);
        return { row, open: false };
      } else {
        const style = k === 'ALT' ? 'SOLID' : 'DOUBLE';
        const lanes = [];
        let l = lane;
        for (const b of it[1]) { lanes.push(l); l += width(b); }
        // Forgreningen: bundkant på den forbindelsesrække, der lige er tegnet.
        hline(row - 1, lanes[0], lanes[lanes.length - 1], 'bottom', style);
        const res = it[1].map((b, n) => chain(b, lanes[n], row, false, k === 'ALT' && prio ? n + 1 : null));
        const end = Math.max(...res.map(x => x.row));
        const open = lanes.filter((_, n) => res[n].open);
        // Fyld korte grene op med lodret linje, og tegn samlingen.
        for (const [n, x] of res.entries()) if (x.open) for (let r = x.row; r <= end; r++) vline(r, lanes[n]);
        if (open.length) hline(end, Math.min(lane, ...open), Math.max(...open), 'bottom', style);
        row = end + 1;
        vline(row++, lane);
        if (k === 'ALT') step(row++, lane, it[2], false);
        else transition(row++, lane, it[2]);
      }
    }
    return { row, open: true };
  }

  chain(items, 0, FOERSTE_RAEKKE, true, null);
  return m;
}

// ---------------------------------------------------------------------------
// Google Sheets: læs SFCSL fra ét ark, tegn SFC i et andet.
// ---------------------------------------------------------------------------

const ARK_SFCSL = 'SFCSL';
const ARK_SFC = 'SFC';
const VIS_PRIORITET = true;      // vis (1), (2) ... på alternative grene
const TEGN_AUTOMATISK = true;    // tegn igen, hver gang SFCSL-arket ændres

const EKSEMPEL = [
  '// Hurtig start',
  'S1 t2 S2 t3 S3(',
  '  t4 S4 t5',
  '  t6 S5 t7',
  '  S6) t8[',
  '    S7 t9 S8',
  '    S9',
  '    t10]',
  'S99',
];

// Køres automatisk, når regnearket åbnes, og tilføjer menuen "SFCSL".
function onOpen() {
  SpreadsheetApp.getUi().createMenu('SFCSL')
    .addItem('Tegn SFC', 'tegnSFC')
    .addSeparator()
    .addItem('Opret ark med eksempel', 'opretArk')
    .addToUi();
}

// Køres automatisk ved hver redigering. Tegner igen, hvis SFCSL-arket blev ændret.
function onEdit(e) {
  if (TEGN_AUTOMATISK && e && e.range.getSheet().getName() === ARK_SFCSL) tegnSFC();
}

function opretArk() {
  const ss = SpreadsheetApp.getActive();
  let ind = ss.getSheetByName(ARK_SFCSL);
  if (!ind) ind = ss.insertSheet(ARK_SFCSL);
  if (ind.getLastRow() === 0) {
    ind.getRange(1, 1, EKSEMPEL.length, 1).setValues(EKSEMPEL.map(l => [l]));
    ind.setColumnWidth(1, 300);
    ind.getRange('A:A').setFontFamily('Courier New');
  }
  if (!ss.getSheetByName(ARK_SFC)) ss.insertSheet(ARK_SFC);
  tegnSFC();
}

// Læser hele kolonne A i SFCSL-arket. Hver celle er én linje, men en celle
// må også indeholde flere linjer (Ctrl+Enter).
function laesSFCSL() {
  const ark = SpreadsheetApp.getActive().getSheetByName(ARK_SFCSL);
  if (!ark) throw new Error('Arket "' + ARK_SFCSL + '" findes ikke. Brug menuen SFCSL > Opret ark med eksempel.');
  const n = ark.getLastRow();
  if (n === 0) return '';
  return ark.getRange(1, 1, n, 1).getDisplayValues().map(r => r[0]).join('\n');
}

function tegnSFC() {
  const ss = SpreadsheetApp.getActive();
  const ark = ss.getSheetByName(ARK_SFC) || ss.insertSheet(ARK_SFC);
  rydArk(ark);
  const status = ark.getRange('A1');
  let items;
  try {
    const tekst = laesSFCSL();
    if (!tekst.trim()) { status.setValue('Skriv et SFCSL-program i arket "' + ARK_SFCSL + '".'); return; }
    items = parse(tekst);
  } catch (e) {
    status.setValue('Fejl: ' + e.message).setFontColor('#b3261e').setFontWeight('bold');
    return;
  }
  const fejl = validate(items);
  if (fejl.length) {
    status.setValue('Programmet bryder reglerne: ' + fejl.join(' · ')).setFontColor('#9a5b00').setFontWeight('bold');
  } else {
    status.setValue('Gyldigt SFCSL-program.').setFontColor('#1d7a46');
  }
  skrivModel(ark, layoutSFC(items, VIS_PRIORITET));
}

function rydArk(ark) {
  ark.getRange(1, 1, ark.getMaxRows(), ark.getMaxColumns()).breakApart();
  ark.clear();
}

function a1(r, c, w) {
  const kol = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  return kol(c) + r + (w > 1 ? ':' + kol(c + w - 1) + r : '');
}

// Skriver layoutet ind i arket med så få kald som muligt (Apps Script er
// langsomt, når man ændrer én celle ad gangen).
function skrivModel(ark, m) {
  if (ark.getMaxColumns() < m.maxCol + 1) ark.insertColumnsAfter(ark.getMaxColumns(), m.maxCol + 1 - ark.getMaxColumns());
  if (ark.getMaxRows() < m.maxRow + 1) ark.insertRowsAfter(ark.getMaxRows(), m.maxRow + 1 - ark.getMaxRows());

  ark.setColumnWidth(1, 20);
  for (let c = FOERSTE_KOLONNE; c <= m.maxCol; c++) ark.setColumnWidth(c, (c - FOERSTE_KOLONNE) % 3 === 2 ? 70 : 28);
  ark.setRowHeights(FOERSTE_RAEKKE, m.maxRow - FOERSTE_RAEKKE + 1, 22);

  const rows = m.maxRow - FOERSTE_RAEKKE + 1, cols = m.maxCol - FOERSTE_KOLONNE + 1;
  const values = Array.from({ length: rows }, () => Array(cols).fill(''));
  const kanter = {}, trin = [], labels = [];
  const kant = (key, ref) => (kanter[key] = kanter[key] || []).push(ref);

  for (const k in m.cells) {
    const x = m.cells[k];
    if (x.text) values[x.r - FOERSTE_RAEKKE][x.c - FOERSTE_KOLONNE] = x.text;
    if (x.merge) {
      const ref = a1(x.r, x.c, x.merge);
      ark.getRange(ref).merge();
      trin.push(ref);
      if (x.box) kant('box|' + x.box, ref);
    }
    if (x.label) labels.push(a1(x.r, x.c));
    for (const side in x.b) kant(side + '|' + x.b[side], a1(x.r, x.c));
  }

  ark.getRange(FOERSTE_RAEKKE, FOERSTE_KOLONNE, rows, cols).setValues(values);
  if (trin.length) ark.getRangeList(trin).setHorizontalAlignment('center').setVerticalAlignment('middle').setFontWeight('bold');
  if (labels.length) ark.getRangeList(labels).setHorizontalAlignment('left').setVerticalAlignment('bottom').setFontSize(9);

  for (const key in kanter) {
    const [side, style] = key.split('|');
    const s = SpreadsheetApp.BorderStyle[style];
    const all = side === 'box';
    ark.getRangeList(kanter[key]).setBorder(
      all || side === 'top', all || side === 'left', all || side === 'bottom', all || side === 'right',
      null, null, '#000000', s);
  }
}
