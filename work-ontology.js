'use strict';
// work-ontology.js — 워크 온톨로지: 이 ANA의 업무 항목이 어떤 종류이고 서로 어떻게 이어지는지.
// Knowledge › Ontology가 이 선언을 그대로 보이고, graph-index.js가 이걸로 업무 항목과 연결을 그래프로 만든다.
//
// 베이스는 아무 종류도 선언하지 않는다 — Work 화면이 없는 ANA의 그래프는 비어 있어야 맞다.
// 에이전트가 PRD에서 Work 화면을 만들면(견적·리드·주문…) 그 데이터를 work-graph.json에 종류마다 배열 하나로 두고
// 여기에 종류를 선언한다. 그러면 그 항목이 지식그래프와 한 그래프에 들어가고(개체의 items, 사실의 끝점),
// 데이터 변경 제안(POST /api/agent {diff:{add:[{list:'quotes', …}]}})이 그 배열에 적용된다.
//
// classes:   { id, label, desc, list, title }
//            list  = work-graph.json에서 이 종류의 항목이 든 배열 이름
//            title = 항목의 이름을 정하는 함수(없으면 title → name → text 첫 줄)
// relations: { id, label, desc, from[], to[], made, field }
//            made: 'explicit' — 사람·에이전트가 연결로 만든다(work-graph.json links[], POST /api/link)
//                  'derived'  — 항목의 필드에서 계산한다. field = 'Class.prop'
//                               to가 Day면 그 필드의 날짜(YYYY-MM-DD)로 Day 노드(day:YYYY-MM-DD)를 만들어 잇고,
//                               아니면 그 필드의 id(하나 또는 배열)로 잇는다
//
// 예) 견적 ANA:
//   classes: [
//     { id: 'Lead',  label: 'Lead',  list: 'leads',  desc: 'A company that asked for a price', title: (x) => x.name },
//     { id: 'Quote', label: 'Quote', list: 'quotes', desc: 'A price we sent' },
//     { id: 'Day',   label: 'Day',   desc: 'A calendar day (computed from dates)' },
//   ],
//   relations: [
//     { id: 'QUOTE_FOR',  label: 'quote for',  from: ['Quote'], to: ['Lead'], made: 'derived',  field: 'Quote.lead', desc: 'The lead this quote was sent to' },
//     { id: 'SENT_ON',    label: 'sent on',    from: ['Quote'], to: ['Day'],  made: 'derived',  field: 'Quote.sentAt' },
//     { id: 'REFERS_TO',  label: 'refers to',  from: ['*'],     to: ['*'],    made: 'explicit', desc: 'Manual reference between two work items' },
//   ],

// 온톨로지 도우미: 사람이 인터뷰로 만드는 온톨로지 자체가 업무 항목이다(OWL 클래스·객체 속성·데이터 속성) + .ttl 설명.
const nameOf = (x) => x.label ? `${x.label} (${x.name || ''})` : (x.name || '');
module.exports = {
  classes: [
    { id: 'OntoClass',     label: 'Class',       list: 'classes',      title: nameOf, desc: 'A concept in the ontology being built (owl:Class) — name, label, comment, parent' },
    { id: 'OntoRelation',  label: 'Relation',    list: 'relations',    title: nameOf, desc: 'A link between two classes (owl:ObjectProperty) — name, label, comment, domain, range, functional' },
    { id: 'OntoAttribute', label: 'Attribute',   list: 'attributes',   title: nameOf, desc: 'A value a class carries (owl:DatatypeProperty) — name, label, comment, domain, datatype, functional' },
    { id: 'Explanation',   label: 'Explanation', list: 'explanations', title: (x) => x.title || x.file || 'Explanation', desc: 'A plain-language explanation of an uploaded .ttl file' },
    { id: 'Individual',    label: 'Individual',  list: 'individuals',  title: nameOf, desc: 'A real thing of a class (reactor R-01, ethanol) — class, name, label, and a field per attribute/relation name' },
    { id: 'Question',      label: 'Question',    list: 'questions',    title: (x) => x.text || 'Question', desc: 'A question the ontology should answer (competency question) — text, status answerable|missing|open, needs, note' },
  ],
  relations: [
    { id: 'SUBCLASS_OF', label: 'subclass of', from: ['OntoClass'],     to: ['OntoClass'], made: 'derived', field: 'OntoClass.parent',     desc: 'rdfs:subClassOf' },
    { id: 'DOMAIN',      label: 'domain',      from: ['OntoRelation'],  to: ['OntoClass'], made: 'derived', field: 'OntoRelation.domain',  desc: 'The class the relation starts from' },
    { id: 'RANGE',       label: 'range',       from: ['OntoRelation'],  to: ['OntoClass'], made: 'derived', field: 'OntoRelation.range',   desc: 'The class the relation points to' },
    { id: 'ATTRIBUTE_OF', label: 'attribute of', from: ['OntoAttribute'], to: ['OntoClass'], made: 'derived', field: 'OntoAttribute.domain', desc: 'The class that carries this attribute' },
    { id: 'INSTANCE_OF', label: 'instance of', from: ['Individual'], to: ['OntoClass'], made: 'derived', field: 'Individual.class', desc: 'The class this real thing belongs to' },
    { id: 'NEEDS',       label: 'needs',       from: ['Question'],   to: ['OntoClass', 'OntoRelation', 'OntoAttribute'], made: 'derived', field: 'Question.needs', desc: 'Classes, relations and attributes needed to answer the question' },
  ],
};
