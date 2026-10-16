import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const script=readFileSync(new URL('../public/pilot/ad-entry.js',import.meta.url),'utf8');
function run(search:string){const links=[{href:'https://wa.me/12025550100?text=Join'},{href:'https://example.convex.site/how-it-works.html'},{href:'https://other.example/?text=Join'},{href:'https://example.convex.site/pilot/checkout.html#private'}];runInNewContext(script,{URL,URLSearchParams,location:{search,href:'https://example.convex.site/'+search,origin:'https://example.convex.site'},document:{querySelectorAll:()=>links}});return links.map(l=>l.href);}
test('prefills encoded tag and carries it only through approved internal entry pages',()=>{const links=run('?ad=Ad01');expect(new URL(links[0]).searchParams.get('text')).toBe('Join — ad01');expect(new URL(links[1]).searchParams.get('ad')).toBe('ad01');expect(links[2]).toBe('https://other.example/?text=Join');expect(links[3]).toBe('https://example.convex.site/pilot/checkout.html#private');});
test.each(['','?ad=%3Cscript%3E','?ad='+ 'a'.repeat(33)])('normal Join unaffected for missing/invalid source %s',search=>expect(new URL(run(search)[0]).searchParams.get('text')).toBe('Join'));
