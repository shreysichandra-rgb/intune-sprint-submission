import {naturalTracking} from './naturalTracking';
export function matchTrackedChoice(text:string,alreadyChosen:string[]):string[]|null{
 const parsed=naturalTracking(text);
 return parsed?.setup?[...new Set([...alreadyChosen,...parsed.items])]:null;
}
