import {test,expect} from 'vitest';
import {v4ReplyLanguage} from '../convex/v4Reply';
test.each(['Thoda hindi me samjaye please','Hindi mein samjhao','Please explain in Hindi','Hinglish mein batao'])('explicit language request is recognised: %s',text=>{
 expect(v4ReplyLanguage(text)).toBe('Hinglish (natural Roman Hindi mixed with English)');
});
test('explicit English request overrides Hindi script around it',()=>expect(v4ReplyLanguage('कृपया English में समझाओ')).toBe('English'));
test('a Hindi request in Devanagari stays Hindi',()=>expect(v4ReplyLanguage('हिंदी में समझाइए')).toBe('Hindi'));
test('ordinary English is not treated as a language-change request',()=>expect(v4ReplyLanguage('I have my food plan ready')).toBeNull());
