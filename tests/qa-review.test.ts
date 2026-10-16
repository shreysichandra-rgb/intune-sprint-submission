import {describe,it,expect} from 'vitest';
import {reviewHealth,liveTimingSummary} from '../src/qaReview';
describe('private review evidence summary',()=>{
 const conversation={_id:'c1',scenarioId:'fictional',status:'completed',judgeStatus:'completed',judgeVerdict:{verdict:'pass'}};
 const turn={conversationId:'c1',status:'completed',checks:[{passed:true}]};
 it('counts only complete checked and judged conversations as passed',()=>{
  expect(reviewHealth({run:{scenarios:[{id:'fictional',steps:[1,2]}]},conversations:[conversation],turns:[turn,turn]}).passed).toBe(1);
  expect(reviewHealth({run:{scenarios:[{id:'fictional',steps:[1,2]}]},conversations:[conversation],turns:[turn]}).unreviewed).toBe(1);
 });
 it('does not confuse finished execution with passed review',()=>{
  const health=reviewHealth({conversations:[{...conversation,judgeVerdict:{verdict:'fail'}}],turns:[turn]});expect(health.failed).toBe(1);expect(health.passed).toBe(0);
 });
 it('separates unavailable judge evidence and failed deterministic checks',()=>{
  expect(reviewHealth({conversations:[{...conversation,judgeStatus:'not_run',judgeVerdict:null}],turns:[turn]}).unreviewed).toBe(1);
  expect(reviewHealth({conversations:[conversation],turns:[{...turn,checks:[{passed:false}]}]}).failed).toBe(1);
 });
 it('keeps proposed fixes separate from verified and dismissed findings',()=>{
  expect(reviewHealth({issues:[{status:'open'},{status:'in_progress'},{status:'fixed'},{status:'verified'},{status:'dismissed'}]})).toMatchObject({openIssues:2,awaitingRepeat:1});
 });
});

it('shows nested processing and AI timings without adding overlapping durations',()=>{
 expect(liveTimingSummary([{scope:'message',totalMs:8100},{scope:'v4',totalMs:7000,stages:[{aiCalls:1},{aiCalls:2}]},{scope:'delivery',totalMs:550}])).toBe('8.1s processing · 3 AI calls · 0.6s send request');
 expect(liveTimingSummary()).toBe('');
});
