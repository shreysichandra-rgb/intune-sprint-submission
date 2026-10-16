import {test,expect} from 'vitest';
import {itemsReply} from '../convex/pilotMemory';
test('summary gives current corrected appointment date and preserves original wording',()=>{
 const user:any={startDate:'2026-10-11',endDate:'2026-10-18',v4Records:[{id:'appointment',kind:'appointment',date:'2026-10-16',time:'9am',state:'planned'}]};
 const item:any={_id:'appointment',kind:'appointment',title:'doctor appointment',text:'doctor appointment next Saturday',state:'planned'};
 const reply=itemsReply({items:[item],events:[]},user,'week');
 expect(reply).toContain('16 Oct 2026');expect(reply).toContain('9am');expect(reply).toContain('doctor appointment next Saturday');
});
test('summary names stored meal choices instead of presenting them as unfinished tasks',()=>{
 const user:any={startDate:'2026-10-11',endDate:'2026-10-18',v4Records:[{id:'choice',kind:'meal_choice',date:null,time:null,state:'planned'}]};
 expect(itemsReply({items:[{_id:'choice',kind:'task',title:'breakfast',text:'oats with yoghurt',state:'planned'} as any],events:[]},user,'week')).toContain('meal choice: breakfast');
});
