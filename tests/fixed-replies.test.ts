import {test,expect,vi,afterEach} from 'vitest';
import {failedUpdateReply,pausedReply,notNowReply,accessEndedReply,notStartedReply,commands_Resumed_Future_messages_you_ve_agreed_to} from '../convex/copy';
afterEach(()=>vi.unstubAllEnvs());
test('founder-approved fixed replies keep their exact wording (22 Oct)',()=>{
 expect(failedUpdateReply).toBe('Sorry, that one didn’t go through 😕 Nothing new was saved, and everything from before is safe. Could you send it again?');
 expect(pausedReply).toBe('Done, reminders are paused 👍 Everything you’ve saved is still here. Send Resume whenever you want them back.');
 expect(commands_Resumed_Future_messages_you_ve_agreed_to).toBe('Welcome back 👍 Your reminders are on again. I won’t send the ones you missed while you were away.');
 expect(notNowReply).toBe('No problem 🙂 Your notes stay right here whenever you need them.');
 expect(accessEndedReply('coupon')).toBe('Your InTune week has ended, so I couldn’t save that one. Everything you saved before is still here to look at, correct or delete. Send Pay if you’d like another week.');
});
test('a trial user hears free trial, not week; free-for-24-hours only while the trial is on',()=>{
 expect(accessEndedReply('trial')).toMatch(/^Your free trial has ended, so I couldn’t save that one\./);expect(accessEndedReply('trial')).not.toContain('week has ended');
 vi.stubEnv('INTUNE_TRIAL_ENABLED','1');expect(notStartedReply()).toBe('I can’t save new things just yet. Send Join to start (free for 24 hours), or enter your coupon if you have one. Anything you saved before is still here.');
 vi.stubEnv('INTUNE_TRIAL_ENABLED','0');expect(notStartedReply()).not.toContain('free for 24 hours');
});
import {explainedFailureReply} from '../convex/copy';
test('a refusal she can act on is explained instead of the generic failure (overnight sweep 22 Oct)',()=>{
 expect(explainedFailureReply('That time is after this paid pilot ends. No tracking reminder was scheduled.')).toMatch(/^That’s after your InTune week ends/);
 expect(explainedFailureReply('The stated date needs clarification.')).toBe('Which date did you mean? I haven’t saved it yet.');
 expect(explainedFailureReply('What year was 8 October?')).toBe('What year was 8 October? I haven’t saved it yet.');
 expect(explainedFailureReply('An action has no supporting owned user message.')).toBeNull();
});
test('a tangled multi-reminder failure asks for one reminder per message instead of a bare send-again',()=>{
 for(const e of ['Reminder purpose continuation was not independently confirmed. Ask one genuine ambiguity question; do not claim scheduling.','Contextual sources are only permitted for reminders'])expect(explainedFailureReply(e)).toMatch(/each reminder as its own message/);
});
test('a missing saved record is not explained as a reminder problem',()=>{expect(explainedFailureReply('The intended saved record is unavailable for this test user.')).toBeNull();});
