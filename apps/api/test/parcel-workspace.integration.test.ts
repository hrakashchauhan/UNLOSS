import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { workflowFixture } from './workflow-fixture.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
const accounts: {id:string;email:string;cookie:string}[]=[];
let orderId='';
beforeAll(async()=>{
 f=await workflowFixture(true);
 for(const role of ['CUSTOMER','DELIVERY','CUSTOMER']){
  const email=`${randomUUID()}@example.invalid`;
  const rolePayload=role==='DELIVERY'?'DELIVERY':'CUSTOMER';
  const r=await f.request('/auth/register',{name:'Synthetic account',email,password:randomUUID(),role:rolePayload},false);
  expect(r.status).toBe(201); const user=await f.prisma.user.findUniqueOrThrow({where:{email}});
  if(role==='DELIVERY'){
   // Test fixture acts as an authorized reviewer; public signup cannot grant courier access.
   await f.prisma.roleMembership.update({where:{userId_role:{userId:user.id,role:'DELIVERY'}},data:{status:'ACTIVE'}});
   await f.prisma.deliveryProfile.update({where:{userId:user.id},data:{employer:'Synthetic Test Courier',deliveryReference:`TEST-${randomUUID()}`,reviewStatus:'APPROVED',phoneVerifiedAt:new Date()}});
  }
  await f.prisma.user.update({where:{id:user.id},data:{googleSubject:`synthetic-${randomUUID()}`}});
  accounts.push({id:user.id,email,cookie:r.headers.get('set-cookie')!.split(';')[0]!});
 }
});
afterAll(async()=>{
 if(!f)return;
 await f.prisma.deliveryEarning.deleteMany({where:{sellerId:f.seller.id}});
 await f.prisma.payoutTransfer.deleteMany({where:{deliveryUserId:{in:accounts.map(a=>a.id)}}});
 await f.close();
 const {integrationDatabase}=await import('./integration-helpers.js'); const {prisma}=integrationDatabase();
 await prisma.user.deleteMany({where:{id:{in:accounts.map(a=>a.id)}}});await prisma.$disconnect();
});
const call=(i:number,path:string,body?:unknown)=>f.request(path,body,false,{Cookie:accounts[i]!.cookie});
it('connects distinct verified accounts; rejects outsiders and unverified assignments',async()=>{
 const result=await f.create();orderId=result.order.id;
 expect((await f.request(`/orders/${orderId}/participants`,{customerEmail:accounts[0]!.email,courierEmail:accounts[0]!.email})).status).toBe(400);
 expect((await f.request(`/orders/${orderId}/participants`,{customerEmail:accounts[0]!.email,courierEmail:accounts[1]!.email})).status).toBe(200);
 const unapproved=await f.prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,name:'Synthetic Pending Courier',passwordHash:'synthetic',status:'ACTIVE',googleSubject:`synthetic-${randomUUID()}`,memberships:{create:{role:'DELIVERY',status:'PENDING'}},deliveryProfile:{create:{employer:'Test',deliveryReference:`P-${randomUUID()}`,reviewStatus:'PENDING'}}}});
 expect((await f.request(`/orders/${orderId}/participants`,{customerEmail:accounts[0]!.email,courierEmail:unapproved.email})).status).toBe(400);
 await f.prisma.user.delete({where:{id:unapproved.id}});
 expect((await call(2,`/workspace/parcels/${orderId}`)).status).toBe(404);
 expect((await call(0,`/workspace/parcels/${orderId}`)).status).toBe(200);
 const q1=await (await f.request(`/orders/${orderId}/qr`,{})).json();const q2=await (await f.request(`/orders/${orderId}/qr`,{})).json();expect(q1.qr).toEqual(q2.qr);
 const qrRecords=await f.prisma.qrToken.findMany({where:{orderId},orderBy:{purpose:'asc'}});expect(qrRecords).toHaveLength(2);expect(qrRecords.map(token=>token.purpose)).toEqual(['CUSTOMER','DELIVERY']);expect(qrRecords.every(token=>token.orderId===orderId&&token.encryptedToken?.startsWith('v1.'))).toBe(true);
 expect((await call(0,`/workspace/parcels/${orderId}/qr`)).status).toBe(200);
 expect((await call(1,`/workspace/parcels/${orderId}/qr`)).status).toBe(200);
 expect((await f.request(`/workspace/scan/delivery/${new URL(q1.qr.deliveryUrl).pathname.split('/').pop()}`,{})).status).toBe(403);
 const dispatched=await f.create(); await f.dispatch(dispatched.order.id);
 const available=await call(1,'/delivery/pending'); expect(available.status).toBe(200);
 const availableBody=await available.json(); expect(availableBody.available.some((o:{id:string})=>o.id===dispatched.order.id)).toBe(true);
 expect(JSON.stringify(availableBody.available.find((o:{id:string})=>o.id===dispatched.order.id))).not.toMatch(/customerName|customerPhone|addressLine|postalCode|shipment|email/);
 expect(availableBody.items).toEqual([]);
 const earnings=await call(1,'/delivery/earnings'); expect(earnings.status).toBe(200);
 const payout=await call(1,'/delivery/payout-account',{method:'UPI',upiId:'synthetic@testbank',accountName:'Synthetic courier'}); expect(payout.status).toBe(200);
 expect((await f.request('/events/poll',undefined,false)).status).toBe(401);
 const events=await (await call(2,'/events/poll?since=2020-01-01')).json();expect(events.items).toHaveLength(0);
});
it('requires recipient acceptance and fresh courier location; credits exactly once under concurrent completion',async()=>{
 await f.dispatch(orderId);
 expect((await call(1,`/workspace/parcels/${orderId}/handoff`,{})).status).toBe(409);
 expect((await call(2,`/workspace/parcels/${orderId}/decision`,{action:'ACCEPT'})).status).toBe(403);
 expect((await call(0,`/workspace/parcels/${orderId}/decision`,{action:'ACCEPT'})).status).toBe(409);
 expect((await call(1,`/workspace/parcels/${orderId}/handoff`,{})).status).toBe(409);
 expect((await call(1,`/workspace/parcels/${orderId}/location`,{kind:'COURIER_LOCATION',latitude:300,longitude:77,accuracyMeters:10})).status).toBe(400);
 expect((await call(1,`/workspace/parcels/${orderId}/location`,{kind:'COURIER_LOCATION',latitude:28.6,longitude:77.2,accuracyMeters:10})).status).toBe(201);
 expect((await call(1,`/workspace/parcels/${orderId}/handoff`,{})).status).toBe(409);
 const labels=await (await f.request(`/orders/${orderId}/qr`,{})).json();
 const token=new URL(labels.qr.deliveryUrl).pathname.split('/').pop();
 const customerToken=new URL(labels.qr.customerUrl).pathname.split('/').pop();
 const challengeResponse=await f.request(`/customer/${customerToken}/request-otp`,undefined,false,{},'POST');
 const challenge=await challengeResponse.json();expect(challengeResponse.status).toBe(202);
 expect(challenge.demoLabel).toContain('DEMO TEST OTP');
 const verified=await f.request(`/customer/${customerToken}/verify-otp`,{challengeId:challenge.challengeId,code:challenge.devCode},false);
 const proof=await verified.json();expect(verified.status).toBe(200);
 expect((await f.request(`/customer/${customerToken}/decision`,{action:'ACCEPT'},false, {'X-Customer-Verification':proof.verificationToken})).status).toBe(201);
 expect((await call(1,`/workspace/scan/delivery/${token}`,{})).status).toBe(200);
 const start=Date.now();const results=await Promise.all([call(1,`/workspace/parcels/${orderId}/handoff`,{}),call(1,`/workspace/parcels/${orderId}/handoff`,{})]);expect(results.map(r=>r.status)).toEqual([200,200]);
 const credits=await f.prisma.deliveryEarning.findMany({where:{orderId}});expect(credits).toHaveLength(1);expect(credits[0]!.amountPaise).toBe(500);expect(credits[0]!.availableAt!.getTime()).toBeGreaterThanOrEqual(start+7*864e5);expect(credits[0]!.status).toBe('SIMULATED_CREDIT');
 expect(await f.prisma.ledgerEntry.count({where:{orderId}})).toBe(1);
 expect((await call(1,`/workspace/parcels/${orderId}/location`,{kind:'COURIER_LOCATION',latitude:28.6,longitude:77.2,accuracyMeters:10})).status).toBe(409);
});
it('locks each credit for seven days and serializes withdrawal requests without pretending payment',async()=>{
 expect((await call(1,'/workspace/wallet/account',{upiId:'synthetic@testbank',accountName:'Synthetic courier'})).status).toBe(200);
 expect((await call(1,'/workspace/wallet/withdraw',{simulate:true})).status).toBe(409);
 await f.prisma.deliveryEarning.update({where:{orderId},data:{availableAt:new Date(Date.now()-1)}});
 const responses=await Promise.all([call(1,'/workspace/wallet/withdraw',{simulate:true}),call(1,'/workspace/wallet/withdraw',{simulate:true})]);expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
 const wallet=await (await call(1,'/workspace/wallet')).json();expect(wallet.availablePaise).toBe(0);expect(wallet.withdrawals).toHaveLength(1);expect(wallet.withdrawals[0].status).toBe('SIMULATED');expect(wallet.providerConnected).toBe(false);
});
