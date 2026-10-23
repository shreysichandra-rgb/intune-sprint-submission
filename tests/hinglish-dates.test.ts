import {test,expect} from 'vitest';
import {resolveLabDate} from '../convex/labTime';
const at=Date.parse('2026-10-21T06:00:00Z');
test('Hindi and Hinglish phrases date reported events (13 Oct-style chat, 22 Oct sweep)',()=>{
 for(const [p,d] of [['kal raat','2026-10-20'],['Kal raat','2026-10-20'],['kal subah','2026-10-20'],['कल रात','2026-10-20'],['aaj','2026-10-21'],['aaj subah','2026-10-21'],['parso','2026-10-19']] as const)expect(resolveLabDate(p,at,'Asia/Kolkata')).toBe(d);
 expect(resolveLabDate('kal',at,'Asia/Kolkata')).toBeNull(); // yesterday or tomorrow: ask, never guess
});
import {v4ReplyLanguage} from '../convex/v4Reply';
test('short Hinglish follow-ups keep a Hinglish reply; plain English stays English (overnight sweep 22 Oct)',()=>{
 for(const t of ['Aur bread bhi','Kya kya lena hai?','Doodh ghar pe hai'])expect(v4ReplyLanguage(t)).toMatch(/^Hinglish/);
 for(const t of ['Add bread too','What do I need?','I have everything at home'])expect(v4ReplyLanguage(t)).toBe('English');
});
