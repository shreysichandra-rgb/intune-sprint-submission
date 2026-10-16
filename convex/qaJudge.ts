// A provider may append its terminal marker after otherwise complete JSON.
// Strip only that known suffix; prose, partial JSON and other wrappers still fail.
export function parseQaJudgeOutput(raw:string){
 const text=raw.trim();
 return JSON.parse(text.endsWith('</final>')?text.slice(0,-8).trimEnd():text);
}
