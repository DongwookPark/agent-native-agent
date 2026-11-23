'use strict';
// ontology-tools.js — 인터뷰로 만든 온톨로지(work-graph.json의 classes·relations·attributes·individuals)를
// OWL/RDF Turtle로 쓰고, 규칙 검사를 하고, 쉬운 말 요약 문장을 만든다. Work 화면이 GET /api/onto로 읽는다.
//
// 항목 모양(work-ontology.js 참고):
//   classes:     { id, name, label, comment, parent, external, externalMode }
//                parent = 다른 class의 id · external = 표준 온톨로지의 IRI(standards/), externalMode = 'equivalent' | 'subClassOf'(기본)
//   relations:   { id, name, label, comment, domain, range, functional, external }
//                domain·range = class id, 또는 그 배열(여러 개 = 그중 하나, owl:unionOf)
//   attributes:  { id, name, label, comment, domain, datatype, functional, unit }
//                datatype = string|integer|decimal|boolean|date|dateTime · unit = QUDT 단위 코드(UNITS)
//   individuals: { id, class, name, label, <attribute name>: 값, <relation name>: 다른 individual의 id(또는 배열) }
//                실제 기계·물질(1번 반응기, 에탄올) — 속성·관계 이름을 그대로 필드로 쓴다

const BASE_IRI = process.env.ANA_ONTO_IRI || 'http://example.org/onto#';
const DATATYPES = ['string', 'integer', 'decimal', 'boolean', 'date', 'dateTime'];
// QUDT 단위(https://www.qudt.org/) — IRI는 http://qudt.org/vocab/unit/<코드>. 통화는 CCY_<ISO 4217>
const QUDT = 'http://qudt.org/vocab/unit/';
const UNITS = {
  KiloGM: 'kg', GM: 'g', TONNE: 't', L: 'L', M3: 'm³', DEG_C: '℃', K: 'K',
  SEC: '초', MIN: '분', HR: '시간', DAY: '일', KiloPA: 'kPa', BAR: 'bar', KiloW: 'kW',
  M: 'm', MilliM: 'mm', PERCENT: '%', CCY_KRW: '원', CCY_USD: '$',
};
const LOCAL = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const UPPER = /^[A-Z][A-Za-z0-9]*$/;
const LOWER = /^[a-z][A-Za-z0-9]*$/;
const IRI = /^https?:\/\/[^\s<>"{}|\\^`]+$/;
const RESERVED = new Set(['id', 'list', 'class', 'name', 'label', 'comment', 'at', 'by']);   // individuals에서 속성·관계가 아닌 필드

const arr = (s, k) => (Array.isArray(s && s[k]) ? s[k].filter((x) => x && x.id != null) : []);
const lit = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
const str = (v) => String(v == null ? '' : v).trim();
const ids = (v) => (Array.isArray(v) ? v : [v]).map(str).filter(Boolean);   // 하나 또는 여러 개의 id
// 한글 조사: 마지막 글자에 받침이 있으면 앞, 없으면 뒤(한글이 아니면 둘 다 보인다)
function josa(w, a, b) {
  const c = String(w).trim().replace(/\s*\([^)]*\)$/, '').slice(-1).charCodeAt(0);   // '가격(원)'은 '가격'으로 본다
  if (c >= 0xac00 && c <= 0xd7a3) return w + ((c - 0xac00) % 28 ? a : b);
  return `${w}${a}(${b})`;
}

function parts(s) {
  const classes = arr(s, 'classes'), relations = arr(s, 'relations'), attributes = arr(s, 'attributes'), individuals = arr(s, 'individuals');
  const byId = new Map(classes.map((c) => [String(c.id), c]));
  return { classes, relations, attributes, individuals, byId };
}
// 이 개념과 그 상위 개념들(속성·관계를 물려받는다)
function lineage(byId, id) {
  const out = []; let p = str(id); const seen = new Set();
  while (p && byId.has(p) && !seen.has(p)) { seen.add(p); out.push(p); p = str(byId.get(p).parent); }
  return out;
}
// 이름이 IRI 로컬 이름으로 못 쓰이면 쓸 수 있게 고친 이름(검사는 원래 이름으로 경고한다)
const safeLocal = (x) => { const n = str(x.name).replace(/[^A-Za-z0-9_-]/g, ''); return LOCAL.test(n) ? n : `item_${String(x.id).replace(/[^A-Za-z0-9_]/g, '')}`; };
const valueOk = (t, v) => {
  const x = str(v);
  if (t === 'integer') return /^-?\d+$/.test(x);
  if (t === 'decimal') return /^-?\d+(\.\d+)?$/.test(x);
  if (t === 'boolean') return /^(true|false)$/.test(x);
  if (t === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (t === 'dateTime') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(x);
  return true;
};

function toTurtle(s, opts = {}) {
  const iri = opts.iri || BASE_IRI;
  const { classes, relations, attributes, individuals, byId } = parts(s);
  const ref = (id) => { const c = byId.get(String(id)); return c ? ':' + safeLocal(c) : null; };
  const refs = (v) => { const l = ids(v).map(ref).filter(Boolean); return l.length > 1 ? `[ a owl:Class ; owl:unionOf ( ${l.join(' ')} ) ]` : l[0] || null; };
  const indById = new Map(individuals.map((x) => [String(x.id), x]));
  const units = attributes.some((a) => UNITS[str(a.unit)]);
  const out = [
    `@prefix : <${iri}> .`,
    '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    ...(units ? [`@prefix unit: <${QUDT}> .`] : []),
    '',
    `<${iri.replace(/[#/]$/, '')}> a owl:Ontology${opts.title ? ` ;\n    rdfs:label ${lit(opts.title)}@ko` : ''} .`,
  ];
  const block = (head, lines) => { out.push('', head + (lines.length ? ' ;\n    ' + lines.join(' ;\n    ') : '') + ' .'); };
  const meta = (x) => [str(x.label) && `rdfs:label ${lit(str(x.label))}@ko`, str(x.comment) && `rdfs:comment ${lit(str(x.comment))}@ko`].filter(Boolean);
  if (units) out.push('', '# 속성의 단위(QUDT) — https://www.qudt.org/', ':unit a owl:AnnotationProperty ;\n    rdfs:label "단위"@ko ;\n    rdfs:comment "이 속성 값의 단위. QUDT 단위 어휘(http://qudt.org/vocab/unit/)의 IRI"@ko .');

  if (classes.length) out.push('', '#### Classes');
  for (const c of classes) {
    const l = meta(c), p = c.parent ? ref(c.parent) : null, ext = str(c.external);
    if (p) l.unshift(`rdfs:subClassOf ${p}`);
    if (IRI.test(ext)) l.push(`${c.externalMode === 'equivalent' ? 'owl:equivalentClass' : 'rdfs:subClassOf'} <${ext}>`);
    block(`:${safeLocal(c)} a owl:Class`, l);
  }
  if (relations.length) out.push('', '#### Object properties');
  for (const r of relations) {
    const l = meta(r), d = refs(r.domain), g = refs(r.range), ext = str(r.external);
    if (d) l.unshift(`rdfs:domain ${d}`);
    if (g) l.splice(d ? 1 : 0, 0, `rdfs:range ${g}`);
    if (IRI.test(ext)) l.push(`rdfs:subPropertyOf <${ext}>`);
    block(`:${safeLocal(r)} a owl:ObjectProperty${r.functional === true ? ', owl:FunctionalProperty' : ''}`, l);
  }
  if (attributes.length) out.push('', '#### Datatype properties');
  for (const a of attributes) {
    const l = meta(a), d = ref(a.domain), t = DATATYPES.includes(str(a.datatype)) ? str(a.datatype) : 'string';
    l.unshift(`rdfs:range xsd:${t}`);
    if (d) l.unshift(`rdfs:domain ${d}`);
    if (UNITS[str(a.unit)]) l.push(`:unit unit:${str(a.unit)}`);
    block(`:${safeLocal(a)} a owl:DatatypeProperty${a.functional === true ? ', owl:FunctionalProperty' : ''}`, l);
  }
  if (individuals.length) out.push('', '#### Individuals (실제 기계·물질 등)');
  for (const x of individuals) {
    const c = ref(x.class), l = [str(x.label) && `rdfs:label ${lit(str(x.label))}@ko`, str(x.comment) && `rdfs:comment ${lit(str(x.comment))}@ko`].filter(Boolean);
    const line = lineage(byId, x.class);
    for (const a of attributes.filter((a) => line.includes(str(a.domain)))) {
      const t = DATATYPES.includes(str(a.datatype)) ? str(a.datatype) : 'string';
      const vals = (Array.isArray(x[a.name]) ? x[a.name] : [x[a.name]]).map(str).filter(Boolean);
      if (vals.length) l.push(`:${safeLocal(a)} ${vals.map((v) => (t === 'string' ? lit(v) : `${lit(v)}^^xsd:${t}`)).join(', ')}`);
    }
    for (const r of relations.filter((r) => ids(r.domain).some((d) => line.includes(d)))) {
      const to = ids(x[r.name]).map((id) => indById.get(id)).filter(Boolean).map((y) => ':' + safeLocal(y));
      if (to.length) l.push(`:${safeLocal(r)} ${to.join(', ')}`);
    }
    block(`:${safeLocal(x)} a owl:NamedIndividual${c ? ', ' + c : ''}`, l);
  }
  return out.join('\n') + '\n';
}

// 규칙 검사 — level: error(틀림) · warn(고치는 게 좋음) · info(참고)
function check(s) {
  const { classes, relations, attributes, individuals, byId } = parts(s);
  const out = [], add = (level, id, msg) => out.push({ level, id: id == null ? '' : String(id), msg });
  const all = [...classes.map((x) => ['class', x]), ...relations.map((x) => ['relation', x]), ...attributes.map((x) => ['attribute', x]), ...individuals.map((x) => ['individual', x])];
  const KO = { class: '개념', relation: '관계', attribute: '속성', individual: '실제 항목' };
  const who = (k, x) => `${KO[k]} '${str(x.label) || str(x.name) || x.id}'`;

  const seen = new Map();
  for (const [k, x] of all) {
    const n = str(x.name);
    if (!n) { add('error', x.id, `${who(k, x)}에 영문 이름(name)이 없어요.`); continue; }
    if (!LOCAL.test(n)) add('error', x.id, `${who(k, x)}의 이름 '${n}'은 IRI에 쓸 수 없어요(영문·숫자·_만, 숫자로 시작 불가).`);
    else if (k === 'class' && !UPPER.test(n)) add('warn', x.id, `개념 이름은 대문자로 시작하는 CamelCase가 관례예요: '${n}'.`);
    else if ((k === 'relation' || k === 'attribute') && !LOWER.test(n)) add('warn', x.id, `${KO[k]} 이름은 소문자로 시작하는 camelCase가 관례예요: '${n}'.`);
    const key = n.toLowerCase();
    if (seen.has(key)) add('error', x.id, `이름 '${n}'이 ${who(...seen.get(key))}와 겹쳐요.`); else seen.set(key, [k, x]);
    if (!str(x.label)) add('info', x.id, `${who(k, x)}에 한글 이름(label)이 없어요.`);
    if (k !== 'individual' && !str(x.comment)) add('info', x.id, `${who(k, x)}에 설명(comment)이 없어요.`);
    if ((k === 'class' || k === 'relation') && str(x.external) && !IRI.test(str(x.external))) add('error', x.id, `${who(k, x)}의 표준 연결 주소가 올바른 주소(http…)가 아니에요.`);
  }
  const missing = (v) => ids(v).some((id) => !byId.has(id));
  const none = (v) => !ids(v).length;
  for (const c of classes) {
    if (missing(c.parent)) add('error', c.id, `${who('class', c)}의 상위 개념이 없는 개념을 가리켜요.`);
    // 상위 개념 순환
    const path = new Set([String(c.id)]); let p = c.parent;
    while (p != null && p !== '' && byId.has(String(p))) {
      if (path.has(String(p))) { add('error', c.id, `${who('class', c)}의 상위 개념이 돌고 돌아 자기 자신으로 와요(순환).`); break; }
      path.add(String(p)); p = byId.get(String(p)).parent;
    }
  }
  for (const r of relations) {
    if (none(r.domain)) add('warn', r.id, `${who('relation', r)}이 어느 개념에서 시작하는지(domain) 정해지지 않았어요.`);
    else if (missing(r.domain)) add('error', r.id, `${who('relation', r)}의 시작 개념(domain)이 없는 개념이에요.`);
    if (none(r.range)) add('warn', r.id, `${who('relation', r)}이 어느 개념을 가리키는지(range) 정해지지 않았어요.`);
    else if (missing(r.range)) add('error', r.id, `${who('relation', r)}의 대상 개념(range)이 없는 개념이에요.`);
  }
  for (const a of attributes) {
    if (none(a.domain)) add('warn', a.id, `${who('attribute', a)}이 어느 개념의 것인지(domain) 정해지지 않았어요.`);
    else if (missing(a.domain)) add('error', a.id, `${who('attribute', a)}의 개념(domain)이 없는 개념이에요.`);
    if (!DATATYPES.includes(str(a.datatype))) add('warn', a.id, `${who('attribute', a)}의 값 종류(datatype)가 ${str(a.datatype) ? `'${str(a.datatype)}'로 알 수 없어요` : '없어요'} — string으로 내보내요.`);
    if (str(a.unit) && !UNITS[str(a.unit)]) add('warn', a.id, `${who('attribute', a)}의 단위 '${str(a.unit)}'를 알 수 없어요(쓸 수 있는 것: ${Object.keys(UNITS).join(', ')}).`);
    else if ((a.datatype === 'decimal' || a.datatype === 'integer') && !str(a.unit)) add('warn', a.id, `${who('attribute', a)}의 값은 숫자인데 단위가 없어요. 다른 시스템이 kg인지 t인지 알 수 없어요.`);
  }
  // 실제 항목: 개념이 있는지, 값이 그 개념의 속성·관계에 맞는지, 값 종류가 맞는지
  const indById = new Map(individuals.map((x) => [String(x.id), x]));
  for (const x of individuals) {
    if (none(x.class)) { add('error', x.id, `${who('individual', x)}이 어떤 개념인지 정해지지 않았어요.`); continue; }
    if (missing(x.class)) { add('error', x.id, `${who('individual', x)}의 개념이 없는 개념이에요.`); continue; }
    const line = lineage(byId, x.class);
    const myAttrs = attributes.filter((a) => line.includes(str(a.domain))), myRels = relations.filter((r) => ids(r.domain).some((d) => line.includes(d)));
    for (const k of Object.keys(x)) {
      if (RESERVED.has(k) || x[k] === '' || x[k] == null) continue;
      const a = myAttrs.find((y) => y.name === k), r = myRels.find((y) => y.name === k);
      if (!a && !r) { add('warn', x.id, `${who('individual', x)}에 '${k}' 값이 있는데, ${byId.get(str(x.class)).label || '이 개념'}에는 그런 속성·관계가 없어요.`); continue; }
      if (a) for (const v of (Array.isArray(x[k]) ? x[k] : [x[k]])) if (!valueOk(str(a.datatype), v)) add('warn', x.id, `${who('individual', x)}의 ${a.label || a.name} 값 '${str(v)}'이 ${a.datatype} 형식이 아니에요.`);
      if (r) for (const id of ids(x[k])) {
        const y = indById.get(id);
        if (!y) add('error', x.id, `${who('individual', x)}의 '${r.label || r.name}'이 없는 항목을 가리켜요.`);
        else if (!ids(r.range).some((g) => lineage(byId, y.class).includes(g))) add('warn', x.id, `${who('individual', x)}의 '${r.label || r.name}' 대상 '${y.label || y.name}'은 이 관계가 가리킬 수 있는 개념이 아니에요.`);
      }
    }
  }
  // 아무것과도 이어지지 않은 개념
  const used = new Set();
  for (const c of classes) if (c.parent != null && c.parent !== '') { used.add(String(c.parent)); used.add(String(c.id)); }
  for (const r of relations) [...ids(r.domain), ...ids(r.range)].forEach((id) => used.add(id));
  for (const a of attributes) used.add(String(a.domain));
  if (classes.length > 1) for (const c of classes) if (!used.has(String(c.id))) add('info', c.id, `${who('class', c)}은 다른 개념과 아직 이어지지 않았어요.`);
  const rank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// 쉬운 말 요약 문장
function sentences(s) {
  const { classes, relations, attributes, individuals, byId } = parts(s);
  const nm = (x) => str(x && x.label) || str(x && x.name) || '?';
  const cn = (v) => ids(v).map((id) => (byId.has(id) ? nm(byId.get(id)) : '?')).join('·') || '?';
  const out = [];
  for (const c of classes) {
    const bits = [];
    if (c.parent != null && c.parent !== '' && byId.has(String(c.parent))) bits.push(`${josa(nm(c), '은', '는')} ${cn(c.parent)}의 한 종류예요.`);
    const attrs = attributes.filter((a) => String(a.domain) === String(c.id)).map(nm);
    if (attrs.length) bits.push(`${josa(nm(c), '은', '는')} ${josa(attrs.join(', '), '을', '를')} 가져요.`);
    for (const r of relations.filter((r) => ids(r.domain).includes(String(c.id))))
      bits.push(`${josa(nm(c), '은', '는')} ${josa(cn(r.range), '과', '와')} '${nm(r)}' 관계로 이어져요${r.functional === true ? ' (하나만)' : ''}.`);
    const n = individuals.filter((x) => str(x.class) === String(c.id)).length;
    if (n) bits.push(`실제 ${nm(c)} ${n}개가 들어 있어요.`);
    out.push({ id: String(c.id), head: nm(c), comment: str(c.comment), external: str(c.external), lines: bits });
  }
  return out;
}

module.exports = { toTurtle, check, sentences, lineage, BASE_IRI, DATATYPES, UNITS, QUDT };
