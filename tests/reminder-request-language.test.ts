import {test,expect} from 'vitest';
import {v4ReplyLanguage} from '../convex/v4Reply';
import {hasReminderRequest} from '../convex/reminderRequest';
test.each(['packing yaad dila dena','packing yaad dilana','packing yaad dila do','पैकिंग याद दिला देना'])('explicit reminder request %s',text=>expect(hasReminderRequest(text)).toBe(true));
test.each(['10:55 am IST','Meri list save kar do','yaad nahi hai','packing mat yaad dila dena','packing yaad mat dilana','पैकिंग याद मत दिलाना'])('does not infer permission from %s',text=>expect(hasReminderRequest(text)).toBe(false));

test('a Roman Hindi timing request stays Hinglish',()=>expect(v4ReplyLanguage('Aaj 12:30 pm IST par packing yaad dila dena.')).toContain('Hinglish'));
