import {test,expect} from 'vitest';import {resolveDate,resolveTime,resolveWhen} from '../convex/rules';
const now=Date.parse('2026-10-09T04:30:00Z'),tz='Asia/Kolkata';
test.each(['1 October 2026','1st October 2026','October 1, 2026','Oct 1st 2026','on 1 October 2026'])('explicit named-month date resolves without asking again: %s',phrase=>expect(resolveDate(phrase,now,tz)).toBe('2026-10-01'));
test.each(['1 Sept 2026','September 1 2026','1st Sep 2026','1 Sept. 2026'])('September abbreviations preserve the actual date: %s',phrase=>expect(resolveDate(phrase,now,tz)).toBe('2026-09-01'));
test.each(['1 October','August 21','1/10/26','31 February 2026','February 29 2026','April 31 2026'])('missing years, ambiguous numbers and impossible dates are never guessed: %s',phrase=>expect(resolveDate(phrase,now,tz)).toBe(null));
test('named-month leap dates and future event checks use unchanged calendar rules',()=>{expect(resolveDate('29 February 2024',now,tz)).toBe('2024-02-29');expect(resolveWhen({datePhrase:'10 October 2026',timePhrase:null},now,tz).question).not.toBe(null);});
test.each([['9:00 a.m.','09:00'],['1:30 p.m.','13:30'],['09:00','09:00'],['13:30','13:30'],['23:59','23:59']])('explicit clock format %s preserves its time', (phrase,time)=>expect(resolveTime(phrase)).toBe(time));
test.each(['9:00','13pm','24:00','09:60','noon-ish'])('ambiguous or invalid clock %s is not guessed',phrase=>expect(resolveTime(phrase)).toBe(null));
