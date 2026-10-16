import {test,expect} from 'vitest';
import {dateLabel,eventLabel} from '../convex/replyCopy';
import {resolveWhen,localDate} from '../convex/rules';
const zone='Asia/Kolkata';
test('India midnight uses calendar dates and has no seasonal offset change',()=>{
 for(const month of ['01','07']){
  const before=Date.parse(`2026-${month}-05T18:29:59Z`),after=before+1000;
  expect(localDate(before,zone)).toBe(`2026-${month}-05`);
  expect(localDate(after,zone)).toBe(`2026-${month}-06`);
  expect(resolveWhen({datePhrase:'yesterday',timePhrase:null},before,zone).date).toBe(`2026-${month}-04`);
 }
});
test('explicit dates, correction dates, exact and approximate precision are displayed without invented times',()=>{
 const now=Date.parse('2026-10-06T10:00:00+05:30');
 expect(dateLabel('2026-09-28',zone,now)).toBe('28 September');
 expect(dateLabel('2025-09-28',zone,now)).toBe('28 September 2025');
 expect(resolveWhen({datePhrase:'2026-09-28',timePhrase:null},now,zone)).toEqual({question:null,date:'2026-09-28',time:null});
 expect(resolveWhen({datePhrase:'2026-02-30',timePhrase:null},now,zone).question).toBeTruthy();
 expect(resolveWhen({datePhrase:null,timePhrase:'4pm'},now,zone).question).toContain('Which day');
 expect(resolveWhen({datePhrase:null,timePhrase:null},now,zone).date).toBeNull();
 expect(eventLabel('brain fog','2025-09-28',null,'date-only',1,zone)).not.toContain('am');
});
test('formatting preserves an existing non-India profile rather than replacing its timezone',()=>{
 const now=Date.parse('2026-10-06T01:00:00Z');
 expect(dateLabel('2026-10-06',zone,now)).toBe('today');
 expect(dateLabel('2026-10-05','America/New_York',now)).toBe('today');
});
