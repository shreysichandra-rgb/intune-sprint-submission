export function matchCommand(text: string) {
  const standalone=text.trim().toLowerCase().replace(/[.!]+$/,'').trim();
  if(/^(?:please )?(?:delete|erase|forget) all (?:of )?my (?:saved )?(?:information|info|data|records|details)(?: please)?$/.test(standalone))return 'delete';
  switch (text.toLowerCase()) {
    case 'pause': return 'pause';
    case 'resume': return 'resume';
    case 'stop': return 'stop';
    case 'start': return 'start';
    case 'delete my pilot data': return 'delete';
    case 'what have i told you this week?': return 'summary';
    default: return null;
  }
}

// Retrieval is read-only and takes priority over every open clarification.
export function matchRetrieval(text:string):'plan'|'week'|null {
 const question=text.trim().toLowerCase().replace(/’/g,"'").replace(/\?$/,'');
 if(["what's my current plan","what is my current plan","what's my plan","what is my plan","how is my plan going","how's my plan going","what's my progress","what is my progress","what's my plan progress","what is my plan progress"].includes(question))return 'plan';
 if(["what have i told you this week","what did i tell you this week","show me my week","show me this week's records"].includes(question))return 'week';
 return null;
}

// Match the entire message so greetings with actual content still reach interpretation.
export function matchGreeting(text:string){
 return /^(hi|hello|hey)$/i.test(text.trim());
}

// Only this standalone closing phrase; updates and control commands keep their routes.
export function matchFarewell(text:string){
 return /^okay\s+bye[.!]?$/i.test(text.trim());
}

export function matchHelp(text:string){
 const question=text.toLowerCase().replace(/[?.!,;:]+/g,' ').replace(/\bu\b/g,'you').replace(/\bur\b/g,'your').trim().replace(/\s+/g,' ').replace(/^(?:(?:hi|hey|so|and|ok|okay|please) )+/,'');
 const phrases=['what are your capabilities','what can you help me with','what can you do','how does this work','you tell me what all can you help me with','tell me what you can do'];
 const words=question.split(' ');
 // Match a whole help question. Extra report text, counts and control commands
 // must keep their existing routes. Short words require an exact match.
 return phrases.some(phrase=>{
  const expected=phrase.split(' ');
  if(words.length!==expected.length)return false;
  let mistakes=0;
  for(let i=0;i<words.length;i++){
   if(words[i]===expected[i])continue;
   if(expected[i].length<4)return false;
   const distance=spellingDistance(words[i],expected[i]);
   if(distance>(expected[i].length>=9?2:1))return false;
   mistakes+=distance;
   if(mistakes>2)return false;
  }
  return true;
 });
}
// Insertions, omissions, substitutions and neighbouring swapped letters.
function spellingDistance(actual:string,expected:string){
 if(Math.abs(actual.length-expected.length)>2)return 3;
 const rows=Array.from({length:actual.length+1},()=>Array<number>(expected.length+1).fill(0));
 for(let i=0;i<=actual.length;i++)rows[i][0]=i;
 for(let j=0;j<=expected.length;j++)rows[0][j]=j;
 for(let i=1;i<=actual.length;i++)for(let j=1;j<=expected.length;j++){
  rows[i][j]=Math.min(rows[i-1][j]+1,rows[i][j-1]+1,rows[i-1][j-1]+(actual[i-1]===expected[j-1]?0:1));
  if(i>1&&j>1&&actual[i-1]===expected[j-2]&&actual[i-2]===expected[j-1])rows[i][j]=Math.min(rows[i][j],rows[i-2][j-2]+1);
 }
 return rows[actual.length][expected.length];
}
// Only standalone requests to track an existing activity, not completion reports.
export function matchPlanWithoutTarget(text:string){
 const request=text.trim().replace(/[?.!]$/,'').trim();
 const match=request.match(/^(?:track my |can you help me track my )(workouts|training)$|^my (workout|training) schedule$/i);
 return match?.[1]??match?.[2]??null;
}
export function parsePlanTarget(text:string){
 const answer=text.trim().toLowerCase().replace(/[.!]$/,'');
 const match=answer.match(/^(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)(?: times?)?$/);
 if(!match)return null;
 const words=['one','two','three','four','five','six','seven','eight','nine','ten'];
 const number=/^\d+$/.test(match[1])?Number(match[1]):words.indexOf(match[1])+1;
 return number>=1&&number<=250?number:null;
}

// Whole-message conversational replies only; reports and commands keep their routes.
export function matchConversationReply(text:string):'uncertainty'|'doingWell'|null{
 const reply=text.toLowerCase().replace(/’/g,"'").replace(/[?.!,;:]+/g,' ').trim().replace(/\s+/g,' ');
 if(["i don't know you tell me","you tell me","what do you suggest"].includes(reply))return 'uncertainty';
 return reply==='going good'?'doingWell':null;
}

// Reject contradictory interpretation of clear single-job updates; never reroute or count a guess.
export function isStandaloneWorkoutUpdate(text:string){
 const value=text.toLowerCase().trim().replace(/[.!]$/,'');
 return /^(?:(?:i )?(?:did|finished|completed) (?:my |a )?(?:workout|training|strength session)|(?:my )?(?:workout|training|strength session) (?:done|finished|completed))(?: (?:today|yesterday|\d+ days? ago))?$/.test(value);
}
export function isStandaloneBodyUpdate(text:string,items:string[]){
 const value=text.toLowerCase().trim().replace(/[.!]$/,'');
 return items.some(item=>{const name=item.toLowerCase();if(!value.startsWith(name))return false;return /^(?: (?:today|yesterday|last night|\d+ days? ago))?$/.test(value.slice(name.length));});
}
