import {test,expect} from 'vitest';
import {recoverV4ClockAnswer} from '../convex/v4Action';
function fixture(){return {a:{messageId:'new',text:'6 pm'},c:{now:Date.parse('2026-10-17T09:00:00Z'),reminderDeliveryConfigured:true,state:{onboardingIntroduced:true,access:{mode:'active_paid'},control:{storage:true,tracking:'active',safetyPaused:false},tasks:[{id:'reminder-pending:source',sourceMessageId:'source',targetId:'packing',topic:'reminder time',question:'What time?'}],records:[{id:'packing',kind:'task',date:'2026-10-18',time:null}],reminders:[]},sources:[{messageId:'source',role:'user',canSave:true,text:'Remind me tomorrow about my fictional packing list',at:Date.parse('2026-10-17T08:00:00Z')}]}} as any;}
test.each(['two questions','wrong question','missing day','missing target','wrong kind','expired','paused','withdrawn','safety paused','blocked source','unconfigured','quoted','multiple clocks','negation','changed purpose','safety signal'])('schema recovery refuses %s',condition=>{
 const {c,a}=fixture();let proposals:any[]=[];
 if(condition==='two questions')c.state.tasks.push({...c.state.tasks[0],id:'other'});
 if(condition==='wrong question')c.state.tasks[0].question='Which day?';
 if(condition==='missing day')c.state.records[0].date=null;
 if(condition==='missing target')c.state.tasks[0].targetId='missing';
 if(condition==='wrong kind')c.state.records[0].kind='plan';
 if(condition==='expired')c.state.access.mode='expired';
 if(condition==='paused')c.state.control.tracking='paused';
 if(condition==='withdrawn')c.state.control.storage=false;
 if(condition==='safety paused')c.state.control.safetyPaused=true;
 if(condition==='blocked source')c.sources[0].canSave=false;
 if(condition==='unconfigured')c.reminderDeliveryConfigured=false;
 if(condition==='quoted')a.quotedMessageId='old';
 if(condition==='multiple clocks')a.text='6 pm or 8 pm';
 if(condition==='negation')a.text='not 6 pm';
 if(condition==='changed purpose')a.text='6 pm for a different list';
 if(condition==='safety signal')proposals=[{safety:{intent:'emergency'}}];
 const before=structuredClone(c);expect(recoverV4ClockAnswer(c,a,proposals)).toBeNull();expect(c).toEqual(before);
});
test('two schema-invalid proposals can recover only the owned clock slot without modifying input state',()=>{const {c,a}=fixture(),before=structuredClone(c);const p=recoverV4ClockAnswer(c,a,[{actions:[{type:'bad'}]},{actions:[{type:'bad'}]}]);expect(p?.actions).toHaveLength(1);expect(p?.actions[0]).toMatchObject({type:'reminder',targetId:'packing',timePhrase:'6 pm',datePhrase:'2026-10-18'});expect(c).toEqual(before);});
