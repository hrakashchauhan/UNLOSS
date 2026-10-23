import {createHash} from 'node:crypto';

export const transitions:Record<string,string[]>={
  CREATED:['READY_FOR_DISPATCH','CANCELLED'], READY_FOR_DISPATCH:['OUT_FOR_DELIVERY','CANCELLED'],
  OUT_FOR_DELIVERY:['DELIVERY_ATTEMPTED','DELIVERED_VERIFIED','CUSTOMER_REJECTED','DELIVERY_FAILED','REDELIVERY_REQUESTED','RETURN_INITIATED'],
  DELIVERY_ATTEMPTED:['OUT_FOR_DELIVERY','REDELIVERY_REQUESTED','RETURN_INITIATED'],
  CUSTOMER_REJECTED:['REDELIVERY_REQUESTED','RETURN_INITIATED'], DELIVERY_FAILED:['OUT_FOR_DELIVERY','REDELIVERY_REQUESTED','RETURN_INITIATED'],
  REDELIVERY_REQUESTED:['READY_FOR_DISPATCH','RETURN_INITIATED'], RETURN_INITIATED:['RETURN_IN_TRANSIT'],
  RETURN_IN_TRANSIT:['RETURNED_TO_SELLER'], RETURNED_TO_SELLER:['REDELIVERY_REQUESTED']
};
export const isTransitionAllowed=(from:string,to:string)=>Boolean(transitions[from]?.includes(to));
export const hashToken=(token:string)=>createHash('sha256').update(token).digest('hex');
export function reportMonthBounds(month:string):[Date,Date]{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('month must be YYYY-MM');
  const [year,monthNumber]=month.split('-').map(Number) as [number,number];
  return [new Date(Date.UTC(year,monthNumber-1,1)-330*60_000),new Date(Date.UTC(year,monthNumber,1)-330*60_000)];
}
export const rewardEligible=(customerAccepted:boolean,verifiedHandoff:boolean)=>customerAccepted&&verifiedHandoff;
