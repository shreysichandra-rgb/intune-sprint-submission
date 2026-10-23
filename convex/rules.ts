import * as copy from './copy';
export {summaryText} from './copy';
import {summaryText} from './copy';
import {clockLabel,dateLabel} from './replyCopy';
// Pure code owns calendar arithmetic, counting, ambiguity checks and deduplication.
export const MAX_RECORDS = 250;
export function localDate(now: number, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function resolveDate(phrase: string | null, now: number, timezone: string): string | null {
  const today = localDate(now, timezone);
  const p = phrase?.trim().toLowerCase();
  if (p === 'aaj' || p === 'आज') return today;
  if (p === 'today' || p === 'last night' || p === 'this morning' || p === 'right now') return today;
  if (p&&/^this (?:morning|afternoon|evening|night)$/.test(p)) return today;
  if (p&&/^yesterday (?:morning|afternoon|evening|night)$/.test(p)) return shiftDate(today,-1);
  if (p === 'yesterday') return shiftDate(today, -1);
  // A user may give both today and its explicit date. Accept only agreement;
  // keep contradictory dates unresolved rather than shifting a reminder.
  const labelledToday=p?.match(/^today(?:\s*,\s*|\s+)(.+)$/);
  if(labelledToday){
    if(!/\b\d{4}$/.test(labelledToday[1])||/\btoday\b/.test(labelledToday[1]))return null;
    const explicit=resolveDate(labelledToday[1],now,timezone);
    return explicit===today?explicit:null;
  }
  const ago = p?.match(/^(\d{1,3}) days? ago$/);
  if (ago) return shiftDate(today, -Number(ago[1]));
  // A named month plus an explicit four-digit year is unambiguous.
  // Missing years and numeric day/month ordering still require clarification.
  const months:Record<string,string>={jan:'01',january:'01',feb:'02',february:'02',mar:'03',march:'03',apr:'04',april:'04',may:'05',jun:'06',june:'06',jul:'07',july:'07',aug:'08',august:'08',sep:'09',sept:'09',september:'09',oct:'10',october:'10',nov:'11',november:'11',dec:'12',december:'12'};
  const named=p?.replace(/^on\s+/,'').replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\./g,'$1');
  const dayFirst=named?.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)[,\s-]+(\d{4})$/);
  const monthFirst=named?.match(/^([a-z]+)[\s-]+(\d{1,2})(?:st|nd|rd|th)?[,\s-]+(\d{4})$/);
  const month=dayFirst?.[2]??monthFirst?.[1],day=dayFirst?.[1]??monthFirst?.[2],year=dayFirst?.[3]??monthFirst?.[3];
  if(month&&months[month]&&day&&year){const date=year+'-'+months[month]+'-'+day.padStart(2,'0');if(Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date)return date;return null;}
  if (p && /^\d{4}-\d{2}-\d{2}$/.test(p) && Number.isFinite(Date.parse(p + 'T12:00:00Z')) && new Date(p + 'T12:00:00Z').toISOString().slice(0,10) === p) return p;
  return null;
}
export function resolveTime(phrase: string | null): string | null {
  const cleaned=phrase?.trim().toLowerCase().replace(/\./g,'').replace(/\s+ist$/,'');
  const clock=cleaned?.replace(/^(?:around |about |at |approximately |~)/,'');
  if(clock&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock))return clock;
  // Hinglish: "subah 9 baje", "shaam 7 baje", "9 baje raat".
  const baje=cleaned?.match(/^(?:(subah|sube|savere|sawere|dopahar|dopehar|shaam|sham|raat)\s+)?(\d{1,2})(?::(\d{2}))?\s*baje(?:\s+(subah|sube|savere|sawere|dopahar|dopehar|shaam|sham|raat))?$/);
  if(baje&&(baje[1]||baje[4])&&+baje[2]>=1&&+baje[2]<=12&&+(baje[3]||0)<=59){const part=(baje[1]||baje[4])!,h=+baje[2];const pm=/^(?:shaam|sham)$/.test(part)||/^dop/.test(part)&&h!==12&&h<=6||part==='raat'&&h>=6&&h<12;const hour=part==='raat'&&h===12?0:pm?h%12+12:/^(?:subah|sube|savere|sawere)$/.test(part)?h%12:h;return String(hour).padStart(2,'0')+':'+(baje[3]||'00');}
  const match = cleaned?.match(/^(?:around |about |at |approximately |~)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!match || +match[1] < 1 || +match[1] > 12 || +(match[2] || 0) > 59) return null;
  return String(+match[1] % 12 + (match[3] === 'pm' ? 12 : 0)).padStart(2, '0') + ':' + (match[2] || '00');
}
export function resolveWhen(p: { datePhrase: string | null; timePhrase: string | null }, now: number, timezone: string) {
  const time = p.datePhrase?.toLowerCase()==='right now'&&!p.timePhrase ? new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now) : resolveTime(p.timePhrase);
  if (p.timePhrase && !time) return { question: copy.rules_What_time_did_this_happen_Please_use, date: null, time: null };
  let date = resolveDate(p.datePhrase, now, timezone);
  if (!p.datePhrase && time) {
    const localTime = new Intl.DateTimeFormat('en-GB', {timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now);
    if (time > localTime) return { question: copy.rules_Which_day_did_this_happen_at({timePhrase: p.timePhrase}), date: null, time };
    date = localDate(now, timezone);
  }
  if (!date) return { question: copy.rules_Which_day_did_this_happen_I_haven, date: null, time };
  if (date === localDate(now, timezone) && time) {
    const localTime = new Intl.DateTimeFormat('en-GB', {timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now);
    if (time > localTime) return { question: copy.rules_Which_day_did_this_happen_at_2({timePhrase: p.timePhrase}), date: null, time };
  }
  if (date > localDate(now, timezone)) return { question: copy.rules_Which_day_did_this_happen_The_date, date: null, time };
  return { question: null, date, time };
}
export function inWindow(date: string, start: string, end: string) { return date >= start && date <= end; }
export function summary(records: any[], start: string, end: string) {
  const inWindowRecords = records.filter(r => inWindow(r.occurrenceDate, start, end));
  const byItem: Record<string, number> = {};
  for (const record of inWindowRecords) byItem[record.trackedItem] = (byItem[record.trackedItem] || 0) + 1;
  return { totalStored: records.length, sevenDayCount: inWindowRecords.length, byItem, windowStart: start, windowEnd: end, records, inWindowRecords };
}



// Preserve a stated part of the day without inventing a clock time.
export function reportedTimePhrase(datePhrase:string|null,timePhrase:string|null){const p=timePhrase??datePhrase;return p&&/^(?:this |yesterday |last )?(?:morning|afternoon|evening|night)$/i.test(p.trim())?p.trim():undefined;}
