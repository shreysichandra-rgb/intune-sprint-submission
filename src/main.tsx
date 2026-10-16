import * as copy from '../convex/copy';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexProvider, ConvexReactClient, useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import './style.css';
const client = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
type Pair = {A: string; B: string};
function App() {
  const [pair, setPair] = useState<Pair | null>(() => {try {return JSON.parse(localStorage.getItem('fictional-test-pair') || 'null');} catch {return null;}});
  const [user, setUser] = useState<'A' | 'B'>('A');
  const [text, setText] = useState('Brain fog today around 9am.');
  const [target, setTarget] = useState('');
  const [completionTarget,setCompletionTarget] = useState('');
  const [last, setLast] = useState<any>(null);
  const [details, setDetails] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const createPair = useMutation(api.tracking.createTestPair);
  const send = useAction(api.messages.send);
  const forget = useMutation(api.tracking.forget);
  const resolve = useMutation(api.tracking.resolvePending);
  const resolvePlan = useMutation(api.plans.resolve);
  const token = pair?.[user];
  const view = useQuery(api.tracking.getSummary, token ? {token} : 'skip');
  const planView = useQuery(api.plans.getPlan, token ? {token} : 'skip');
  async function perform(fn: () => Promise<any>) {
    setBusy(true); setError(''); setDetails(false);
    try {const result = await fn(); setLast(result); if (result?.outcome === 'error') setError(result.message);} catch {setError(copy.webConnectionFailure);} finally {setBusy(false);}
  }
  return <main>
    <header><small>FIRST SLICE · FICTIONAL DATA ONLY</small><h1>Seven-day keeper</h1><p>Tell me what happened in a made-up message. I’ll keep track, and you can correct it or ask for your week.</p></header>
    <aside><strong>Test setup</strong><p>Both fictional users chose <b>brain fog</b> and <b>poor sleep</b>. Window: {view ? `${view.windowStart}–${view.windowEnd}` : 'seven local calendar days'}, {view?.user.timezone || 'Asia/Kolkata'}. Dates use the server’s saved message-received time.</p><p>Use made-up messages on this test page. InTune gives no medical advice. This page does not send WhatsApp messages or reminders.</p></aside>
    {!pair ? <button disabled={busy} onClick={() => perform(async () => {const p = await createPair({}); localStorage.setItem('fictional-test-pair', JSON.stringify(p)); setPair(p as Pair); return {message:copy.fictionalSessionReady};})}>Start fictional test session</button> : <>
      <section><label>Act as fictional user<select value={user} onChange={e => {setUser(e.target.value as 'A'|'B');setTarget('');setCompletionTarget('');setLast(null);setDetails(false);setError('');}} disabled={busy}><option value="A">User A</option><option value="B">User B</option></select></label><p>Each choice uses its own private test access token. A summary request only returns records for that token.</p></section>
      <form onSubmit={e => {e.preventDefault();perform(() => send({token:token!, text, messageId:crypto.randomUUID(), ...(target ? {targetId:target as any} : {}), ...(completionTarget ? {completionTargetId:completionTarget as any} : {})}));}}>
        <label>Your made-up message<textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} required /></label>
        <label>Occurrence for a correction or reference<select value={target} onChange={e => {setTarget(e.target.value);setCompletionTarget('');}}><option value="">Choose only when needed</option>{view?.records.map((r:any) => <option key={r._id} value={r._id}>{r.trackedItem} · {r.occurrenceDate} {r.occurrenceTime || '(time unknown)'} · {r._id.slice(-6)}</option>)}</select></label>
        {planView && planView.records.length > 0 && <label>Plan completion for a correction<select value={completionTarget} onChange={e => {setCompletionTarget(e.target.value);setTarget('');}}><option value="">Use the latest completion when clear</option>{planView.records.map((r:any)=><option key={r._id} value={r._id}>{r.completionDate} · {r.status} · {r.rawText}</option>)}</select></label>}
        <button disabled={busy}>{busy ? 'Reading message…' : 'Send test message'}</button><button type="button" disabled={busy} onClick={() => {setLast({outcome:'summary', view});setDetails(false);setError('');}}>Show my seven-day summary</button>
      </form>
      {planView && <section aria-label="Plan progress"><h2>Your typed plan</h2>{planView.plan ? <><strong>{planView.plan.activity} · {planView.progress}</strong><p>{planView.plan.state === 'closed' ? copy.webPlanClosed : copy.webPlanCounting}</p><p>Completed dates: {planView.dates.length ? planView.dates.join(', ') : 'none'}</p>{planView.records.map((r:any)=><article key={r._id}><strong>{r.status} · {r.completionDate}</strong><p>{r.rawText}</p>{r.correctionText && <p>Correction: {r.correctionText}</p>}</article>)}</> : <p>{copy.webPlanNotConfirmed}</p>}
        {planView.pending.map((p:any)=><article key={p._id}><p>{p.reason}</p>{p.kind === 'confirmation' ? <button disabled={busy} onClick={()=>perform(()=>resolvePlan({token:token!,pendingId:p._id,choice:'confirm'}))}>Confirm this plan</button> : p.kind === 'duplicate' ? <><button disabled={busy} onClick={()=>perform(()=>resolvePlan({token:token!,pendingId:p._id,choice:'same'}))}>Same session</button><button disabled={busy} onClick={()=>perform(()=>resolvePlan({token:token!,pendingId:p._id,choice:'new'}))}>New session</button></> : <PlanDate busy={busy} submit={(date:string)=>perform(()=>resolvePlan({token:token!,pendingId:p._id,choice:'confirm',datePhrase:date}))}/>}
          <button disabled={busy} onClick={()=>perform(()=>resolvePlan({token:token!,pendingId:p._id,choice:'discard'}))}>Discard plan question</button></article>)}
        <button disabled={busy} onClick={()=>perform(()=>send({token:token!,text:'how is my plan going?',messageId:crypto.randomUUID()}))}>How is my plan going?</button>
      </section>}
      {view && <section aria-label="Seven-day summary"><h2>User {user} · seven-day summary</h2><p><b>{view.sevenDayCount}</b> in the seven-day window · <b>{view.totalStored}</b> total stored</p>
        <h3>Stored occurrences</h3>{view.records.length === 0 && <p>No occurrences stored for this user.</p>}{view.records.map((r:any) => <article key={r._id}><strong>1 occurrence · {r.trackedItem}</strong><p>{r.occurrenceDate} {r.occurrenceTime || '(time unknown)'}</p><p>{r.rawText}</p><button disabled={busy} onClick={() => perform(() => forget({token:token!, occurrenceId:r._id}))}>Forget this</button></article>)}
        <h3>Unresolved messages · not counted</h3>{view.pending.length === 0 && <p>None.</p>}{view.pending.map((p:any) => <article key={p._id}><p>{p.rawText}</p><strong>{p.reason}</strong>{p.kind === 'possible_duplicate' ? <div><button disabled={busy} onClick={() => perform(() => resolve({token:token!, pendingId:p._id,choice:'same'}))}>Same episode</button><button disabled={busy} onClick={() => perform(() => resolve({token:token!,pendingId:p._id,choice:'new'}))}>New episode</button></div> : <Clarification pending={p} busy={busy} records={view.records} submit={(date:string,id:string) => perform(() => resolve({token:token!,pendingId:p._id,choice:'clarify', ...(date ? {datePhrase:date}:{}), ...(id ? {targetId:id as any}:{})}))}/>}<button disabled={busy} onClick={() => perform(() => resolve({token:token!,pendingId:p._id,choice:'discard'}))}>Discard unresolved message</button></article>)}
      </section>}
    </>}
    {error && <p role="alert" className="error">{error}</p>}
    {last?.message && <section aria-label="Latest reply"><p>{last.message}</p></section>}
    {(view || last) && <section><details open={details} onToggle={e => setDetails(e.currentTarget.open)}><summary>Show details</summary><h2>Raw stored records</h2><pre>{JSON.stringify(view?.records ?? [],null,2)}</pre><h2>Raw plan view</h2><pre data-testid="raw-plan">{JSON.stringify(planView ?? null,null,2)}</pre><h2>Full raw server response</h2><pre data-testid="raw-response">{JSON.stringify(last,null,2)}</pre></details></section>}
    <footer>AI limits: 350 reply tokens; 20 AI calls per user per hour; 60 AI calls across the app per hour. No automatic retries.</footer>
  </main>;
}
function PlanDate({busy,submit}:any){
  const [date,setDate]=useState('');
  return <div><label>Completion day (today, yesterday, or YYYY-MM-DD)<input value={date} onChange={e=>setDate(e.target.value)}/></label><button disabled={busy || !date.trim()} onClick={()=>submit(date)}>Confirm completion day</button></div>;
}
function Clarification({pending,busy,records,submit}:any) {
  const [date,setDate] = useState(''); const [id,setId] = useState('');
  return <div><label>Confirmed date (today, yesterday, 8 days ago, or YYYY-MM-DD)<input value={date} onChange={e=>setDate(e.target.value)}/></label><label>Earlier occurrence, if needed<select value={id} onChange={e=>setId(e.target.value)}><option value="">Choose an occurrence</option>{records.map((r:any)=><option value={r._id} key={r._id}>{r.trackedItem} {r.occurrenceDate} · {r._id.slice(-6)}</option>)}</select></label><button disabled={busy} onClick={()=>submit(date,id)}>Confirm clarification</button></div>;
}
createRoot(document.getElementById('root')!).render(<ConvexProvider client={client}><App/></ConvexProvider>);
