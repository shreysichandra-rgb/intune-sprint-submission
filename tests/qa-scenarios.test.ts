import {describe,it,expect} from 'vitest';
import {QA_SCENARIOS,QA_CORPUS_VERSION,QA_FIXED_START,QA_TIMEZONE,QA_SMOKE_SCENARIO_IDS,QA_RUBRIC,selectQaScenarios,checkQaExpectation,type QaObserved} from '../convex/qaScenarios';
const fresh=():QaObserved=>({reply:'',records:[],profile:{name:null},introduced:false,tracking:'active',safetyPaused:false,reminders:[],tasks:[]});
describe('fictional V4 QA corpus',()=>{
 it('is reproducible, bounded and has no customer phone fixtures',()=>{
  expect(QA_CORPUS_VERSION).toMatch(/^v4-fictional-/);expect(QA_TIMEZONE).toBe('Asia/Kolkata');expect(new Date(QA_FIXED_START).toISOString()).toBe('2026-10-11T03:30:00.000Z');
  expect(QA_SCENARIOS).toHaveLength(45);expect(new Set(QA_SCENARIOS.map(s=>s.id)).size).toBe(QA_SCENARIOS.length);
  expect(QA_SMOKE_SCENARIO_IDS).toHaveLength(5);expect(selectQaScenarios().reduce((n,s)=>n+s.steps.length,0)).toBe(21);
  for(const s of QA_SCENARIOS){expect(s.seed).toBeGreaterThan(0);expect(s.simulation.maxAdditionalTurns).toBeLessThanOrEqual(2);expect(s.persona.facts.length).toBeGreaterThan(0);expect(s.steps.length).toBeLessThanOrEqual(s.id==='guided-grocery-physio'?10:6);expect(JSON.stringify(s)).not.toMatch(/\+91\s?\d{10}|\b\d{10}\b/);}
 });
 it('has valid original-source links, duplicate identity and fault annotations',()=>{
  for(const scenario of QA_SCENARIOS){const earlier=new Map<string,string>();for(const step of scenario.steps){expect(earlier.has(step.id)).toBe(false);expect(step.text.trim().length).toBeGreaterThan(0);expect(step.rationale.trim().length).toBeGreaterThan(0);expect(Object.keys(step.expected).length).toBeGreaterThan(0);if(step.quotedStepId)expect(earlier.has(step.quotedStepId)).toBe(true);if(step.duplicateOf){expect(earlier.has(step.duplicateOf)).toBe(true);expect(step.text).toBe(earlier.get(step.duplicateOf));}if(step.advanceMinutes!==undefined)expect(step.advanceMinutes).toBeGreaterThanOrEqual(0);earlier.set(step.id,step.text);}}
  const recovery=QA_SCENARIOS.find(s=>s.id==='recovery-idempotency')!;expect(recovery.steps.filter(s=>s.parallelGroup==='fast')).toHaveLength(2);expect(recovery.steps[0].fault).toBe('save_failure');
  expect(QA_SCENARIOS.find(s=>s.id==='separate-owner')!.linkedOwnerScenarioId).toBe(recovery.id);
 });
 it('checks exact matching saved-state expectations independently of a judge',()=>{
  const observed=fresh();observed.reply='Kept physio for yesterday.';observed.records=[{id:'owned-plan',kind:'plan',label:'physio',text:'physio three times a week',date:null,state:'planned',targetNumber:3},{id:'owned-event',kind:'event',text:'Physio',date:'2026-10-10',state:'completed'}];
  expect(checkQaExpectation({records:[{kind:'plan',textIncludes:'physio',targetNumber:3,count:1},{kind:'event',textIncludes:'Physio',date:'2026-10-10',state:'completed',count:1}]},observed).every(c=>c.passed)).toBe(true);
  observed.records.push({...observed.records[1],id:'duplicate'});expect(checkQaExpectation({records:[{kind:'event',textIncludes:'Physio',count:1}]},observed)[0].passed).toBe(false);
 });
 it('allows only explicitly declared equivalent kinds and truthful disabled reminders',()=>{
  const observed=fresh();observed.records=[{id:'schedule',kind:'schedule',text:'physio Monday Wednesday Friday at 9 am',state:'planned',date:null}];expect(checkQaExpectation({records:[{kinds:['plan','schedule'],textIncludes:'physio'}]},observed)[0].passed).toBe(true);observed.records[0].kind='grocery';expect(checkQaExpectation({records:[{kinds:['plan','schedule'],textIncludes:'physio'}]},observed)[0].passed).toBe(false);
  const topic=QA_SCENARIOS.find(s=>s.id==='topic-pending')!;expect(topic.steps[0].expected.questionRequired).toBeUndefined();expect(topic.steps[0].expected.tasksAtLeast).toBeUndefined();expect(topic.steps[0].expected.noScheduledReminders).toBe(true);expect(QA_SCENARIOS.find(s=>s.id==='guided-grocery-physio')!.steps[0].expected.questionRequired).toBeUndefined();
 });
 it('detects replacement with a new health record even if total length is unchanged',()=>{
  const previous=fresh();previous.records=[{id:'old',kind:'event',text:'headache',date:'2026-10-11',state:'planned'}];
  const observed=structuredClone(previous);observed.records[0].id='new';expect(checkQaExpectation({noNewRecords:true},observed,previous)[0].passed).toBe(false);
  observed.records[0].id='old';observed.records[0].date='2026-10-10';expect(checkQaExpectation({noNewRecords:true},observed,previous)[0].passed).toBe(true);
  expect(checkQaExpectation({noNewRecords:true},observed)[0].passed).toBe(false);
 });
 it('fails dangerous control/name state and exposes expected/actual evidence',()=>{
  const observed=fresh();observed.profile.name='Other owner';observed.safetyPaused=true;observed.reminders=[{state:'active'}];
  const checks=checkQaExpectation({name:'Meera',safetyPaused:false,noScheduledReminders:true},observed);expect(checks.every(c=>!c.passed)).toBe(true);expect(checks[0]).toMatchObject({category:'ownership',severity:'critical',expected:'Meera',actual:'Other owner'});
 });
 it('allows a correction/removal but blocks new records after expiry and names the actual date',()=>{
  const exit=QA_SCENARIOS.find(s=>s.id==='expiry-boundary')!;expect(exit.steps[1].advanceMinutes).toBe(7*24*60);expect(exit.steps[1].expected.noNewRecords).toBe(true);expect(exit.steps[2].expected.records![0].textIncludes).toBe('62 kg');
  const temporal=QA_SCENARIOS.find(s=>s.id==='temporal-history')!;expect(temporal.steps[0].expected.records!.map(r=>r.date)).toEqual(['2025-08-21',null,'2026-10-10']);expect(temporal.steps[3].advanceMinutes).toBe(2880);
 });
 it('does not turn an unchosen alternative into a pending purchase',()=>{
  const observed=fresh();observed.records=[{id:'toast',kind:'grocery',text:'toast',state:'pending',date:null}];expect(checkQaExpectation({absentRecords:[{kind:'grocery',textIncludes:'toast',state:'pending'}]},observed)[0].passed).toBe(false);observed.records[0].state='unchecked';expect(checkQaExpectation({absentRecords:[{kind:'grocery',textIncludes:'toast',state:'pending'}]},observed)[0].passed).toBe(true);
 });
 it('selects independent immutable copies and rejects unknown or repeated IDs',()=>{
  const copy=selectQaScenarios(['name-smalltalk']);copy[0].steps[0].text='changed';expect(QA_SCENARIOS.find(s=>s.id==='name-smalltalk')!.steps[0].text).not.toBe('changed');expect(()=>selectQaScenarios(['missing'])).toThrow('Unknown');expect(()=>selectQaScenarios(['name-smalltalk','name-smalltalk'])).toThrow('Duplicate');
 });
 it('keeps a full triage rubric separate from deterministic correctness',()=>{
  expect(QA_RUBRIC).toHaveLength(10);expect(new Set(QA_RUBRIC.map(r=>r.category)).size).toBe(10);expect(QA_RUBRIC.filter(r=>r.severity==='critical').map(r=>r.category)).toEqual(['ownership','access_privacy','safety']);
 });
});

it('counts groceries by their own ingredient label rather than another ingredient in the source plan',()=>{const observed=fresh();observed.records=[{id:'avocado',kind:'grocery',label:'avocado',text:'My plan has paneer avocado and dahi',state:'unchecked',date:null},{id:'dahi',kind:'grocery',label:'dahi',text:'dahi',state:'unchecked',date:null}];expect(checkQaExpectation({records:[{kind:'grocery',textIncludes:'dahi',count:1,state:'unchecked'}]},observed).every(c=>c.passed)).toBe(true);});
