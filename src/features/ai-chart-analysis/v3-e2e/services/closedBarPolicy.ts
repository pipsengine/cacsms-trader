export type ConfirmableEvent='BOS'|'CHOCH'|'BREAKOUT'|'RETEST'|'SUPERTREND_TRANSITION'|'STAGE_7';
export function mayConfirm(event:ConfirmableEvent,barClosed:boolean){return barClosed===true}
export function confirmationLabel(barClosed:boolean){return barClosed?'CONFIRMED':'DEVELOPING'}
