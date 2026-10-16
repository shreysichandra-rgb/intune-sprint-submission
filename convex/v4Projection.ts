/** The remembering model has semantic states; pilotItems has operational states. */
export function pilotItemState(state:string):'planned'|'pending'|'completed'|'skipped'|'held'|'ordered'|'received'|'paused'|'stopped' {
 if(['unchecked','ongoing','historical'].includes(state))return 'planned';
 if(!['planned','pending','completed','skipped','held','ordered','received','paused','stopped'].includes(state))throw Error('Unsupported saved item state');
 return state as ReturnType<typeof pilotItemState>;
}
