/** Review counts describe evidence, never deployment readiness. */
export function reviewHealth(view:any){
 const turns=view?.turns??[],results:Record<string,string>={};let passed=0,failed=0,unreviewed=0;
 for(const conversation of view?.conversations??[]){
  const own=turns.filter((t:any)=>t.conversationId===conversation._id),scenario=view?.run?.scenarios?.find((s:any)=>s.id===conversation.scenarioId);
  const bad=own.some((t:any)=>t.status==='failed'||(t.checks??[]).some((c:any)=>c.passed===false))||conversation.status==='failed'||conversation.judgeVerdict?.verdict==='fail';
  const complete=conversation.status==='completed'&&conversation.judgeStatus==='completed'&&conversation.judgeVerdict?.verdict==='pass'&&own.length>0&&(!scenario||own.length===scenario.steps.length)&&own.every((t:any)=>t.status==='completed'&&Array.isArray(t.checks)&&t.checks.length>0&&t.checks.every((c:any)=>c.passed===true));
  if(bad){failed++;results[conversation._id]='Failed';}else if(complete){passed++;results[conversation._id]='Passed';}else{unreviewed++;results[conversation._id]='Unfinished or unjudged';}
 }
 const issues=view?.issues??[];return {passed,failed,unreviewed,results,openIssues:issues.filter((i:any)=>['open','in_progress'].includes(i.status)).length,awaitingRepeat:issues.filter((i:any)=>i.status==='fixed').length};
}

/** Nested durations overlap, so show them separately instead of summing them. */
export function liveTimingSummary(timings:any[]=[]){
 const processing=timings.find(t=>t.scope==='message'),ai=timings.find(t=>t.scope==='v4'),delivery=timings.find(t=>t.scope==='delivery');
 const calls=(ai?.stages??[]).reduce((n:number,s:any)=>n+(s.aiCalls??0),0),parts:string[]=[];
 if(typeof processing?.totalMs==='number')parts.push((processing.totalMs/1000).toFixed(1)+'s processing');
 if(ai&&calls)parts.push(calls+' AI calls');
 if(typeof delivery?.totalMs==='number')parts.push((delivery.totalMs/1000).toFixed(1)+'s send request');
 return parts.join(' · ');
}
