import {test,expect} from 'vitest';
import {untranslatedQuoteReply} from '../convex/v4Language';

test('English request with a quote-only Hinglish reply needs an English explanation',()=>{
 const ask='Please reply in English. Show the sleep note I just shared.';
 expect(untranslatedQuoteReply(ask,'Your note says: “Is hafte meri neend baar baar toot rahi hai.”')).toBe(true);
 expect(untranslatedQuoteReply(ask,'Your note says: “इस हफ्ते मेरी नींद बार बार टूट रही है।”')).toBe(true);
 expect(untranslatedQuoteReply(ask,'Your note says your sleep has been breaking again and again this week: “Is hafte meri neend baar baar toot rahi hai.”')).toBe(false);
 expect(untranslatedQuoteReply(ask,'Your note says your sleep has been repeatedly interrupted this week.')).toBe(false);
 expect(untranslatedQuoteReply('Show the sleep note I just shared.','Your note says: “Is hafte meri neend baar baar toot rahi hai.”')).toBe(false);
 expect(untranslatedQuoteReply(ask,'Your note says: “I slept badly.”')).toBe(false);
 expect(untranslatedQuoteReply('Show my original wording in English please.','Your note says: “Is hafte meri neend baar baar toot rahi hai.”')).toBe(false);
});

import {preserveV4Question,lastV4Question} from '../convex/v4Reply';
test('a question whose question mark sits inside a quote is not asked twice (real-AI replay of 13 Oct chat)',()=>{
 expect(preserveV4Question('I’ve noted that you wake frequently. Would you like me to save “How can I avoid waking up frequently at night?”','Would you like me to save it?')).toBe('I’ve noted that you wake frequently. Would you like me to save it?');
 expect(preserveV4Question('Saved your question: “Can we talk about my sleep?”','What else?')).toBe('Saved your question: “Can we talk about my sleep?” What else?');
 expect(preserveV4Question('Your corrected question is: “Could we review my cycle notes?”',null)).toBe('Your corrected question is: “Could we review my cycle notes?”');
});
test('stripping a question keeps the closing quote of the sentence before it',()=>{
 expect(preserveV4Question('Your notes are: “I feel bloated after dinner” and “my knees ache in the morning.” Would you like me to remove the knee-ache note?',null)).toBe('Your notes are: “I feel bloated after dinner” and “my knees ache in the morning.”');
});
test('the last question after a closed quote does not start with the closing quote mark',()=>{
 expect(lastV4Question('For example, you can tell me, “I usually do physio on Mondays and Thursdays.” What would you like help remembering?')).toBe('What would you like help remembering?');
});
