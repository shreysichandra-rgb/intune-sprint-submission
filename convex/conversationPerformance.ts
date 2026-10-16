// Lossless prompt projection: keep all facts, pending questions, dates, quotes and permissions.
// Only remove duplicate data or internal control metadata the model never acts on.
export function compactConversation(conversation:any){
 if(!conversation)return conversation;const quote=conversation.quoted;
 return {...conversation,recentTurns:(conversation.recentTurns??[]).filter((t:any)=>!quote||t.messageId!==quote.messageId)};
}
export function compactMeaningContext(context:any){const {userId,jobId,version,plan,...meaning}=context;return {...meaning,...(context.conversation?{conversation:compactConversation(context.conversation)}:{})};}
export function compactSource(source:any){const {english,text,...rest}=source;return {...rest,original:text,text:english};}
// Strict standalone read requests only. Mixed updates and ambiguous references keep verification.
export function directRecordRequest(text:string):boolean{
 const q=text.trim().toLowerCase().replace(/’/g,"'").replace(/[.!?]+$/,'').replace(/\s+/g,' ');
 return /^(?:please )?(?:(?:show|give|send) me (?:my (?:saved )?(?:records|information)|what you (?:have |\'ve )?(?:saved|kept|remembered)(?: about me)?)|what (?:have you|did you) (?:save|saved|keep|kept|remember|remembered)(?: about me)?|what do you remember(?: about me)?)$/.test(q);
}

export function directLegacyHistoryRequest(text:string):boolean{const q=text.trim().toLowerCase().replace(/[.!?]+$/,'');return /^(?:what (?:all )?are you (?:keeping track of|remembering)(?: for me| about me)?|(?:please )?(?:show|see|retrieve)(?: me)?(?: my| the)? (?:records|stored (?:records|information)|saved (?:records|information)|history))$/.test(q);}
export function directWeeklyRequest(text:string):boolean{const q=text.trim().toLowerCase().replace(/[.!?]+$/,'');return /^(?:(?:please )?(?:(?:show|give|send)(?: me)? (?:my |the |a )?)?)?(?:summary|pilot summary|seven.day summary|weekly summary|summary(?: for)? this week|this week's summary|this week summary)$/.test(q);}

// Server-owned profile and the actual unfinished question also matter when the
// delivered welcome has no incoming turn, or temporary history has expired.
export function normalizationProfileContext(context:any){return {preferredName:context.preferredName??null,nameAsked:context.nameAsked===true,timezone:context.timezone,askedQuestion:(context.pending??[]).find((p:any)=>p.id===context.askedPendingId)??null};}
