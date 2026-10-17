import {test,expect} from 'vitest';
import {v4ReplyLanguage} from '../convex/v4Reply';
test.each(['Thoda hindi me samjaye please','Hindi mein samjhao','Please explain in Hindi','Hinglish mein batao'])('explicit language request is recognised: %s',text=>{
 expect(v4ReplyLanguage(text)).toBe('Hinglish (natural Roman Hindi mixed with English)');
});
test('explicit English request overrides Hindi script around it',()=>expect(v4ReplyLanguage('कृपया English में समझाओ')).toBe('English'));
test('a Hindi request in Devanagari stays Hindi',()=>expect(v4ReplyLanguage('हिंदी में समझाइए')).toBe('Hindi'));
test.each(['I have my food plan ready','Remind me today, 16 October 2026, at 11:19 pm to review my fictional packing list.','Show my saved doctor questions'])('current English message explicitly selects English: %s',text=>expect(v4ReplyLanguage(text)).toBe('English'));
test.each(['','123','?!'])('non-language input stays unspecified: %s',text=>expect(v4ReplyLanguage(text)).toBeNull());

test('ordinary English explain request does not become the language-only help shortcut',async()=>{
 const {languageExplanationReply}=await import('../convex/v4Language');
 const state={control:{tracking:'active',storage:true,safetyPaused:false},access:{mode:'active_paid'}};
 expect(languageExplanationReply('Please explain it',state,true)).toBeNull();
 expect(languageExplanationReply('Please explain in English',state,true)).toContain('Of course.');
});
