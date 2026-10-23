// Lab-only calendar handling. Relative dates use the source message clock.
import {localDate,shiftDate,resolveDate as existingResolveDate} from './rules';
export function resolveLabDate(phrase:string|null,receivedAt:number,timezone:string):string|null {
 const day=localDate(receivedAt,timezone),p=phrase?.trim().toLowerCase().replace(/^on\s+/,'');
 const weekday=p?.match(/^(?:(next|this|coming)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
 if(weekday){const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];const current=new Date(day+'T12:00:00Z').getUTCDay(),wanted=names.indexOf(weekday[2]);let gap=(wanted-current+7)%7;if(gap===0&&weekday[1]==='next')gap=7;return shiftDate(day,gap);}
 // Hindi/Hinglish phrases for something that already happened (this resolver dates reported events, never reminders).
 if(p&&/^(?:aaj|aj|आज)(?:\s+(?:subah|sawere|dopahar|shaam|sham|raat|सुबह|दोपहर|शाम|रात))?$/.test(p))return day;
 if(p&&/^(?:(?:kal|कल)\s+(?:raat|rat|subah|sawere|dopahar|shaam|sham|रात|सुबह|दोपहर|शाम)|beeti raat|pichhli raat|पिछली रात|बीती रात)$/.test(p))return shiftDate(day,-1);
 if(p&&/^(?:parso|parson|परसों)$/.test(p))return shiftDate(day,-2);
 if(p==='tomorrow')return shiftDate(day,1);
 if(p==='last night')return shiftDate(day,-1);
 if(p==='day before yesterday'||p==='the day before yesterday')return shiftDate(day,-2);
 return existingResolveDate(p??null,receivedAt,timezone);
}
export function labDateContext(at:number){return {indiaDate:localDate(at,'Asia/Kolkata'),indiaDateTime:new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'full',timeStyle:'long'}).format(at),relativeDates:{today:localDate(at,'Asia/Kolkata'),yesterday:shiftDate(localDate(at,'Asia/Kolkata'),-1),lastNight:shiftDate(localDate(at,'Asia/Kolkata'),-1),tomorrow:shiftDate(localDate(at,'Asia/Kolkata'),1),dayBeforeYesterday:shiftDate(localDate(at,'Asia/Kolkata'),-2)}};}
