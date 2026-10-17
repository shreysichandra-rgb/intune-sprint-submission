import {test,expect} from 'vitest';
import {resolveDate} from '../convex/rules';
import {reminderDue} from '../convex/pilotReminderRules';
const anchor=Date.parse('2026-10-16T17:09:00Z');
test.each(['today, 16 October 2026','today 16 October 2026','today, October 16, 2026'])('accepts consistent explicit reminder date %s',date=>{
 expect(resolveDate(date,anchor,'Asia/Kolkata')).toBe('2026-10-16');
 expect(reminderDue(date,'10:40 pm',anchor,'Asia/Kolkata')).toMatchObject({question:null,dueAt:Date.parse('2026-10-16T17:10:00Z'),time:'22:40'});
});
test.each(['today, 17 October 2026','today, 31 February 2026','today, 16 October','today, yesterday','today, tomorrow'])('does not guess for contradictory or incomplete date %s',date=>{
 expect(resolveDate(date,anchor,'Asia/Kolkata')).toBeNull();expect(reminderDue(date,'10:40 pm',anchor,'Asia/Kolkata').dueAt).toBeNull();
});
test('a stated past date never silently becomes tomorrow',()=>{
 expect(reminderDue('today, 16 October 2026','10:40 pm',Date.parse('2026-10-16T17:11:00Z'),'Asia/Kolkata')).toMatchObject({dueAt:null,question:'That reminder time has already passed. Which future date and time should I use?'});
});

 test('Hinglish aaj and an explicit IST clock preserve India day and reject a past time',()=>{
  expect(resolveDate('Aaj',Date.parse('2026-10-17T05:00:00Z'),'Asia/Kolkata')).toBe('2026-10-17');
  expect(reminderDue('Aaj','10:55 am IST',Date.parse('2026-10-17T05:00:00Z'),'Asia/Kolkata')).toMatchObject({question:null,time:'10:55',dueAt:Date.parse('2026-10-17T05:25:00Z')});
  expect(reminderDue('Aaj','10:55 am IST',Date.parse('2026-10-17T05:35:00Z'),'Asia/Kolkata')).toMatchObject({dueAt:null,question:'That reminder time has already passed. Which future date and time should I use?'});
  expect(reminderDue('kal','10:55 am IST',Date.parse('2026-10-17T05:00:00Z'),'Asia/Kolkata').dueAt).toBeNull();
  expect(reminderDue('today','10:55 am PST',Date.parse('2026-10-17T05:00:00Z'),'Asia/Kolkata').dueAt).toBeNull();
 });
