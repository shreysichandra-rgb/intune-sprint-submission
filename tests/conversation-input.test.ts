import {test,expect} from 'vitest';
import {z} from 'zod';
import {sourceUnits,extractionInput,decodeSources} from '../convex/conversationInput';
import {validateEnvelope} from '../convex/conversationProtocol';
const anchor=Date.parse('2026-10-07T09:00:00+05:30');
const body={k:'body',l:'hot flash',b:'hot flashes',r:null,n:1,d:'today',t:null,x:false,s:'reported'};
test('every source clause is required by provider schema, including narrative and denial',()=>{
 const input=extractionInput('hot flash today but no night sweats today',{plan:null});const json:any=z.toJSONSchema(input.schema);expect(json.properties.meanings.required).toEqual(['u0','u1']);expect(input.schema.safeParse({v:2,meanings:{u0:[body]}}).success).toBe(false);expect(JSON.stringify(json)).not.toContain('oneOf');
});
test('model cannot rewrite source quotes and narrative remains grounded',()=>{
 const text='ugh hot flash today';const input=extractionInput(text,{plan:null});const decoded=decodeSources({v:2,meanings:{u0:[body]}},input.sources,anchor,'Asia/Kolkata',text);expect(decoded.ops[0].q).toBe(text);expect(validateEnvelope(text,decoded)).toEqual(decoded);
});
test('missing source meanings cannot be decoded as a partial save',()=>{
 const text='hot flash today but period started today';expect(()=>decodeSources({v:2,meanings:{u0:[body]}},sourceUnits(text),anchor,'Asia/Kolkata',text)).toThrow('Incomplete source');
});
test('date-like time field uses existing calendar resolver without inventing a phrase',()=>{
 const text='hot flash right now';const value={v:2,meanings:{u0:[{...body,d:null,t:'right now'}]}};const decoded=decodeSources(value,sourceUnits(text),anchor,'Asia/Kolkata',text);expect(decoded.ops[0]).toMatchObject({d:'right now',t:null});expect(validateEnvelope(text,decoded).ops).toHaveLength(1);
});
test('actual clock time is preserved and unsupported dates still fail evidence validation',()=>{
 const text='hot flash at 4pm';const decoded=decodeSources({v:2,meanings:{u0:[{...body,d:null,t:'at 4pm'}]}},sourceUnits(text),anchor,'Asia/Kolkata',text);expect(decoded.ops[0]).toMatchObject({d:null,t:'at 4pm'});expect(()=>validateEnvelope(text,{v:2,ops:[{...decoded.ops[0],d:'yesterday'}]})).toThrow('Ungrounded date');
});
test('irrelevant question filters and control record targets are removed without granting permission',()=>{
 const text='pause reminders. What happened this week?';const decoded=decodeSources({v:2,meanings:{u0:[{k:'control',command:'pause',target:'reminders'}],u1:[{k:'question',scope:'week',l:'this week'}]}},sourceUnits(text),anchor,'Asia/Kolkata',text);expect(decoded.ops[0]).toMatchObject({target:null});expect(decoded.ops[1]).toMatchObject({l:null});expect(validateEnvelope(text,decoded).ops).toHaveLength(2);
});

test('inherited subjects resolve from the selected report, never from a date label',()=>{
 const text='three hot flashes yesterday and one today lol',sources=sourceUnits(text);
 const report={k:'body',l:'hot flashes',b:'hot flashes',r:null,n:3,d:'yesterday',t:null,x:false,s:'reported'};
 const result=decodeSources({v:2,meanings:{u0:[report],u1:[{...report,l:'today',r:0,n:1,d:'today'}]}},sources,Date.parse('2026-10-07T09:00:00+05:30'),'Asia/Kolkata',text);
 expect((result.ops[1] as any).l).toBe('hot flashes');
});

test('an explicitly named independent subject cannot be redirected by an inheritance pointer',()=>{
 const text='hot flash today and brain fog today',input=extractionInput(text,{plan:null});
 const op={k:'body',l:'hot flash',b:'hot flashes',r:null,n:1,d:'today',t:null,x:false,s:'reported'};
 const decoded=decodeSources({v:2,meanings:{u0:[op],u1:[{...op,l:'brain fog',b:'brain fog',r:0}]}},input.sources,anchor,'Asia/Kolkata',text);
 expect((decoded.ops[1] as any).r).toBeNull();expect((decoded.ops[1] as any).l).toBe('brain fog');expect(()=>validateEnvelope(text,decoded)).not.toThrow();
});

test('an inherited count token cannot become a new symptom label',()=>{
 const text='three hot flashes yesterday and one today lol',input=extractionInput(text,{plan:null});
 const op={k:'body',l:'hot flashes',b:'hot flashes',r:null,n:3,d:'yesterday',t:null,x:false,s:'reported'};
 const result=decodeSources({v:2,meanings:{u0:[op],u1:[{...op,l:'one',r:0,n:1,d:'today'}]}},input.sources,anchor,'Asia/Kolkata',text);
 expect((result.ops[1] as any).l).toBe('hot flashes');expect(()=>validateEnvelope(text,result)).not.toThrow();
});

test('food text corrections cannot target a completion and completion corrections cannot target food',()=>{
 const text='Actually correct my food plan to oats with kefir';const semantic:any=[{id:'u0',text,start:0,end:text.length,english:text,observation:false,risk:'none',purpose:'correction'}];
 const input=extractionInput(text,{pilotMode:'v3',responsibilities:[{id:'food-owned',kind:'food',title:'food plan'}],itemEvents:[{id:'event-owned'}],body:[],cycle:[],completions:[]},semantic);
 const base={v:2,verified:{u0:true},meanings:{u0:[{k:'item_update',target:'food-owned',state:'pending',replacement:'oats with kefir',a:text}]}};
 expect(input.schema.safeParse(base).success).toBe(true);expect(input.schema.safeParse({...base,meanings:{u0:[{...base.meanings.u0[0],target:'event-owned'}]}}).success).toBe(false);
 const event={k:'item_correct',target:'food-owned',d:null,status:null,a:text};expect(input.schema.safeParse({...base,meanings:{u0:[event]}}).success).toBe(false);expect(input.schema.safeParse({...base,meanings:{u0:[{...event,target:'event-owned'}]}}).success).toBe(true);
 const noEvents=extractionInput(text,{pilotMode:'v3',responsibilities:[{id:'food-owned',kind:'food',title:'food plan'}],itemEvents:[]},semantic);expect(noEvents.schema.safeParse({...base,meanings:{u0:[{...event,target:null}]}}).success).toBe(false);
});

test('a new shopping source cannot choose an unrelated food or workout update target',()=>{const text='I need to order rice and lentils';const semantic:any=[{id:'u0',text,start:0,end:text.length,english:text,observation:false,risk:'none',purpose:'other'}];const input=extractionInput(text,{pilotMode:'v3',responsibilities:[{id:'food-owned',kind:'food',title:'25 g protein'},{id:'plan-owned',kind:'plan',title:'swimming'}],itemEvents:[],pending:[]},semantic);const base={v:2,verified:{u0:true},meanings:{u0:[{k:'item_update',target:'plan-owned',state:'pending',replacement:null,a:text}]}};expect(input.schema.safeParse(base).success).toBe(false);expect(input.schema.safeParse({...base,meanings:{u0:[{...base.meanings.u0[0],target:'food-owned'}]}}).success).toBe(false);});
