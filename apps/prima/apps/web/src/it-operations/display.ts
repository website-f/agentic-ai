/** Decimal input to integer sen. Blank/unknown is never a free rate. */
export function parseRinggit(value:string):number {
  const text=value.trim();
  if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(text))throw Error('Enter a non-negative MYR amount with at most two decimal places.');
  const [whole,fraction='']=text.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents>10000000000)throw Error('Amount is too large.');return cents;
}
export function ringgit(cents:number|null|undefined):string {
  if(cents==null)return 'Not configured / unknown';
  if(!Number.isSafeInteger(cents)||cents<0)return 'Amount could not be verified';
  return `RM ${(cents/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
export const assetKindLabels={LAPTOP:'Laptop',DESKTOP:'Desktop',PHONE:'Phone',TABLET:'Tablet',PRINTER:'Printer',NETWORK:'Network device',CCTV:'CCTV',OTHER:'Other device'} as const;

/** Validated server amount to sen; distinct from bounded human input parsing. */
export function amountSen(value:number):number {
 if(!Number.isFinite(value)||value<0||Number(value.toFixed(2))!==value)throw Error('Server amount could not be verified.');
 const cents=Math.round(value*100);if(!Number.isSafeInteger(cents))throw Error('Server amount exceeds safe precision.');return cents;
}
