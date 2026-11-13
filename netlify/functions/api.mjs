import crypto from 'node:crypto';
import Stripe from 'stripe';
import { getStore } from '@netlify/blobs';

const json = (statusCode, value) => ({statusCode, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'same-origin'},body:JSON.stringify(value)});
const error=(code,message)=>json(code,{error:message});
const store=()=>getStore({name:'blackdog-orders',consistency:'strong'});
const key=id=>'orders/'+id;
const get=async id=>await store().get(key(id),{type:'json'});
const put=async o=>store().setJSON(key(o.id),o);
const safe=(v,n=120)=>typeof v==='string'?v.trim().slice(0,n):'';
const email=v=>typeof v==='string' && v.length<=150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const base={tray:465000,canopy:785000};
const text=(o)=>`${o.year} ${o.make} ${o.model} ${o.cab}`;
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const auth=(headers)=>{const h=headers.authorization||headers.Authorization||'';return Boolean(process.env.ADMIN_TOKEN&&eq(h,'Bearer '+process.env.ADMIN_TOKEN))};
const parse=(s)=>{try{return JSON.parse(s||'{}')}catch{return null}};
const amount=(v)=>Number.isSafeInteger(v)&&v>=0&&v<=5000000;
const money=(p)=>Number.isFinite(p)&&p>=0&&p<=50000&&Math.round(p*100)===p*100;
const url=()=>{const u=process.env.PUBLIC_URL;if(!u||!/^https:\/\/[^/]+\/?$/.test(u))throw Error('PUBLIC_URL must be HTTPS site origin');return u.replace(/\/$/,'')};
const calc=o=>{const extras=(o.tank?39900:0)+o.lights*5500+o.eyes*1400;return (o.customBasePence??base[o.product])+extras+o.deliveryPence+o.boxesPence};
const stripe=()=>{if(!process.env.STRIPE_SECRET_KEY)throw Error('Stripe not configured');return new Stripe(process.env.STRIPE_SECRET_KEY)};
const checkoutToken=()=>crypto.randomBytes(24).toString('hex');
const partsStore=()=>getStore({name:'blackdog-parts',consistency:'strong'});
const partsOrders=()=>getStore({name:'blackdog-parts-orders',consistency:'strong'});
const slug=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{1,50}$/.test(v);
const cleanPart=(p)=>({sku:safe(p.sku,40),name:safe(p.name,90),description:safe(p.description,500),category:safe(p.category,40),image:safe(p.image,200),pricePence:p.pricePence,weightGrams:p.weightGrams,lengthCm:p.lengthCm,widthCm:p.widthCm,heightCm:p.heightCm,active:p.active===true});
const getPart=async id=>partsStore().get('part/'+id,{type:'json'});
const partsList=async()=>{const r=await partsStore().list({prefix:'part/'});return (await Promise.all(r.blobs.map(x=>partsStore().get(x.key,{type:'json'})))).filter(Boolean)};
const gbp=(v)=>Number.isSafeInteger(v)&&v>=1&&v<=1000000;
// Shipping amounts are EX VAT in pence. Set your own rates in Netlify environment variables.
const shippingRates=()=>{
 const names=['SMALL','MEDIUM','LARGE'];
 return names.map(name=>{const v=Number(process.env['PARTS_SHIP_'+name+'_PENCE']);return Number.isSafeInteger(v)&&v>=0&&v<=100000? v:null});
};
const shippingQuote=items=>{
 let grams=0,longest=0,volume=0;
 for(const i of items){
  if(![i.weightGrams,i.lengthCm,i.widthCm,i.heightCm].every(v=>Number.isSafeInteger(v)&&v>0))return {quoteRequired:true,reason:'A part is missing packed weight or dimensions'};
  grams+=i.weightGrams*i.qty;
  longest=Math.max(longest,i.lengthCm,i.widthCm,i.heightCm);
  volume+=i.lengthCm*i.widthCm*i.heightCm*i.qty;
 }
 // Conservative combined-volume rule: assumes all items can be packed together.
 const volumetricGrams=Math.ceil(volume/5000*1000);
 const chargeable=Math.max(grams,volumetricGrams);
 const tier=longest<=45&&chargeable<=2000?0:longest<=80&&chargeable<=10000?1:longest<=100&&chargeable<=20000?2:-1;
 if(tier<0)return {quoteRequired:true,reason:'Oversized or heavy order requires a delivery quotation',grams,chargeable};
 const rate=shippingRates()[tier];
 if(rate===null)return {quoteRequired:true,reason:'Delivery price for this parcel category is not configured',grams,chargeable};
 return {quoteRequired:false,shippingPence:rate,tier:['Small','Medium','Large'][tier],grams,chargeable};
};


export const handler=async(event)=>{
 const method=event.httpMethod;
 const path=event.path.replace(/^\/(?:\.netlify\/functions\/api|api)\/?/,'').replace(/\/$/,'');
 const headers=event.headers||{};
 try {
  if(path==='stripe-webhook'&&method==='POST'){
   if(!process.env.STRIPE_WEBHOOK_SECRET)return error(503,'Webhook not configured');
   const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64'):event.body||'';
   let e;try{e=stripe().webhooks.constructEvent(raw,headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch{return error(400,'Invalid Stripe signature')}
   if(e.type==='checkout.session.completed'&&e.data.object.payment_status==='paid'){
    const s=e.data.object,id=s.metadata?.orderId;
    if(s.metadata?.kind==='parts'&&id&&/^[a-f0-9]{28}$/.test(id)){
     const o=await partsOrders().get('order/'+id,{type:'json'});
     if(o&&o.stripeSessionId===s.id&&s.currency==='gbp'&&s.amount_total===o.totalPence){o.status='paid';o.paidAt=new Date().toISOString();o.stripePaymentIntent=s.payment_intent;o.shippingDetails=s.shipping_details||s.collected_information?.shipping_details||null;await partsOrders().setJSON('order/'+id,o);}
     return json(200,{received:true});
    }
    if(id&&/^[a-f0-9]{28}$/.test(id)){
     const o=await get(id);
     if(o&&o.stripeSessionId===s.id&&s.currency==='gbp'&&s.amount_total===Math.round(calc(o)*1.2)){
      o.status='paid';o.paidAt=new Date().toISOString();o.stripePaymentIntent=s.payment_intent;await put(o);
     }
    }
   }
   return json(200,{received:true});
  }
  if(path==='parts'&&method==='GET'){
   const items=(await partsList()).filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name));return json(200,{items});
  }
  if(path==='admin/parts'&&method==='GET'){
   if(!auth(headers))return error(401,'Unauthorized');return json(200,{items:await partsList()});
  }
  if(path==='admin/parts'&&method==='POST'){
   if(!auth(headers))return error(401,'Unauthorized');
   const b=parse(event.body);if(!b||!slug(b.sku)||!safe(b.name)||!gbp(b.pricePence)||typeof b.active!=='boolean')return error(400,'Invalid part; enter SKU, name, price and availability');
   if(![b.weightGrams,b.lengthCm,b.widthCm,b.heightCm].every(v=>Number.isSafeInteger(v)&&v>0&&v<=100000))return error(400,'Enter packed weight in grams and parcel dimensions in centimetres');
   if(b.image && !/^(?:https:\/\/[^\s]+|[a-zA-Z0-9_.-]+\.(?:jpg|jpeg|png|webp))$/.test(b.image))return error(400,'Use an HTTPS image URL or a local image filename');
   const p=cleanPart(b);await partsStore().setJSON('part/'+p.sku,p);return json(200,{item:p});
  }
  if(path==='admin/parts-orders'&&method==='GET'){
   if(!auth(headers))return error(401,'Unauthorized');const r=await partsOrders().list({prefix:'order/'});const orders=await Promise.all(r.blobs.map(x=>partsOrders().get(x.key,{type:'json'})));return json(200,{orders:orders.filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
  }
  if(path==='parts-shipping'&&method==='POST'){
   const b=parse(event.body);if(!b||!Array.isArray(b.items)||!b.items.length||b.items.length>25)return error(400,'Invalid basket');
   const items=[];const seen=new Set();
   for(const i of b.items){if(!slug(i.sku)||!Number.isSafeInteger(i.qty)||i.qty<1||i.qty>20||seen.has(i.sku))return error(400,'Invalid basket');seen.add(i.sku);const p=await getPart(i.sku);if(!p||!p.active)return error(400,'Unavailable part');items.push({...p,qty:i.qty});}
   return json(200,shippingQuote(items));
  }
  if(path==='parts-checkout'&&method==='POST'){
   if((event.body||'').length>5000)return error(413,'Too large');
   const b=parse(event.body);if(!b||!Array.isArray(b.items)||!b.items.length||b.items.length>25||!email(b.email))return error(400,'Enter a valid basket, email and fulfilment option');
   const unique=new Set(),items=[];
   for(const item of b.items){if(!slug(item.sku)||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>20||unique.has(item.sku))return error(400,'Invalid basket');unique.add(item.sku);const part=await getPart(item.sku);if(!part||!part.active||!gbp(part.pricePence))return error(400,'One or more parts are unavailable');items.push({sku:part.sku,name:part.name,qty:item.qty,pricePence:part.pricePence,weightGrams:part.weightGrams,lengthCm:part.lengthCm,widthCm:part.widthCm,heightCm:part.heightCm});}
   const delivery=shippingQuote(items);
   if(delivery.quoteRequired)return error(409,delivery.reason+' — please contact enquiries@blackdogwelding.info before paying');
   const subtotal=items.reduce((n,i)=>n+i.qty*i.pricePence,0),shipping=delivery.shippingPence,total=Math.round((subtotal+shipping)*1.2);
   if(!amount(total)||total===0)return error(400,'Invalid order total');
   const id=crypto.randomBytes(14).toString('hex');
   const order={id,createdAt:new Date().toISOString(),status:'checkout_pending',email:b.email,fulfilment:'ship',deliveryTier:delivery.tier,chargeableWeightGrams:delivery.chargeable,items,subtotalPence:subtotal,shippingPence:shipping,totalPence:total};
   // A single server-priced line item guarantees the final approved VAT-inclusive total.
   const line_items=[{price_data:{currency:'gbp',product_data:{name:'Blackdog spare parts order '+id,description:items.map(i=>i.qty+' × '+i.sku).join(', ').slice(0,500)},unit_amount:total},quantity:1}];
   const session=await stripe().checkout.sessions.create({mode:'payment',customer_email:b.email,line_items,
    shipping_address_collection:{allowed_countries:['GB']},
    phone_number_collection:{enabled:true},
    success_url:url()+'/parts-success.html?session_id={CHECKOUT_SESSION_ID}',cancel_url:url()+'/parts.html',
    metadata:{kind:'parts',orderId:id},client_reference_id:id,payment_method_types:['card'],expires_at:Math.floor(Date.now()/1000)+1800},
    {idempotencyKey:'bd-parts-'+id});
   order.stripeSessionId=session.id;await partsOrders().setJSON('order/'+id,order);return json(200,{url:session.url});
  }
  if(path==='requests'&&method==='POST'){
   if((event.body||'').length>12000)return error(413,'Request too large');
   const b=parse(event.body);if(!b)return error(400,'Invalid request');
   if(!Object.hasOwn(base,b.product)||!['fit','deliver'].includes(b.fulfilment)||!email(b.customerEmail)||b.leadTimeAccepted!==true||!safe(b.model)||!safe(b.make)||!/^\d{4}$/.test(String(b.year))||!['Double Cab','Single Cab (quote required)','King / Extended Cab (quote required)'].includes(b.cab)||![0,1,2,3,4].includes(b.lights)||![0,2,4,6,8].includes(b.eyes)||typeof b.tank!=='boolean'||typeof b.boxes!=='boolean')return error(400,'Please complete all required order details');
   if(b.fulfilment==='deliver'&&!safe(b.postcode,20))return error(400,'Delivery postcode required');
   const id=crypto.randomBytes(14).toString('hex');
   const o={id,status:'pending',createdAt:new Date().toISOString(),product:b.product,make:safe(b.make),model:safe(b.model),year:String(b.year),cab:b.cab,fulfilment:b.fulfilment,tank:b.tank,lights:b.lights,eyes:b.eyes,boxes:b.boxes,postcode:safe(b.postcode,20),customerEmail:safe(b.customerEmail,150),leadTimeAccepted:true,deliveryPence:0,boxesPence:0,customBasePence:null};
   await put(o);return json(200,{id,status:'pending'});
  }
  if(path==='admin/requests'&&method==='GET'){
   if(!auth(headers))return error(401,'Unauthorized');
   const s=store();let cursor,items=[];
   do{const result=await s.list({prefix:'orders/',paginate:true,cursor});items.push(...result.blobs);cursor=result.cursor}while(cursor&&items.length<500);
   const orders=await Promise.all(items.map(x=>s.get(x.key,{type:'json'})));
   return json(200,orders.filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(({checkoutToken,...o})=>o));
  }
  const approve=path.match(/^admin\/approve\/([a-f0-9]{28})$/);
  if(approve&&method==='POST'){
   if(!auth(headers))return error(401,'Unauthorized');
   const o=await get(approve[1]);if(!o||o.status!=='pending')return error(404,'Pending request not found');
   const b=parse(event.body);if(!b||b.fitmentConfirmed!==true||!money(b.deliveryPounds))return error(400,'Confirm fitment and enter a valid delivery amount');
   if(o.fulfilment==='fit'&&b.deliveryPounds!==0)return error(400,'Fitting is included; delivery must be zero');
   if(o.fulfilment==='deliver'&&b.deliveryConfirmed!==true)return error(400,'Confirm delivery price first');
   const quoteRequired=o.cab!=='Double Cab';
   if(quoteRequired&&!money(b.customBasePounds))return error(400,'Quoted base price required for non-Double Cab');
   if(o.boxes&&!money(b.boxesPounds))return error(400,'Quoted bespoke storage box price required');
   o.deliveryPence=Math.round(b.deliveryPounds*100);
   o.customBasePence=quoteRequired?Math.round(b.customBasePounds*100):null;
   o.boxesPence=o.boxes?Math.round(b.boxesPounds*100):0;
   o.status='approved';o.approvedAt=new Date().toISOString();o.checkoutToken=checkoutToken();await put(o);
   return json(200,{checkoutUrl:url()+'/pay.html?id='+o.id+'&token='+o.checkoutToken,totalPence:Math.round(calc(o)*1.2)});
  }
  const approved=path.match(/^approved\/([a-f0-9]{28})$/);
  if(approved&&method==='GET'){
   const o=await get(approved[1]);if(!o||!['approved','paid'].includes(o.status)||!eq(event.queryStringParameters?.token,o.checkoutToken))return error(404,'Not found');
   const subtotalPence=calc(o);return json(200,{product:o.product,vehicle:text(o),fulfilment:o.fulfilment,subtotalPence,vatPence:Math.round(subtotalPence*.2),totalPence:Math.round(subtotalPence*1.2),status:o.status});
  }
  const checkout=path.match(/^checkout\/([a-f0-9]{28})$/);
  if(checkout&&method==='POST'){
   const b=parse(event.body),o=await get(checkout[1]);
   if(!b||!o||o.status!=='approved'||!eq(b.token,o.checkoutToken)||b.leadTimeAccepted!==true)return error(403,'Order not approved or acknowledgement missing');
   const subtotalPence=calc(o),totalPence=Math.round(subtotalPence*1.2);
   if(!amount(totalPence)||totalPence===0)return error(400,'Invalid order total');
   // One line item uses the exact approved taxable subtotal; never trust browser pricing.
   const s=await stripe().checkout.sessions.create({mode:'payment',customer_email:o.customerEmail,
    line_items:[{price_data:{currency:'gbp',product_data:{name:`Blackdog ${o.product==='tray'?'Standard Tray':'Shooting Tray & Canopy'} — approved order ${o.id}`},unit_amount:totalPence},quantity:1}],
    success_url:url()+'/success.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url:url()+'/pay.html?id='+o.id+'&token='+o.checkoutToken,
    metadata:{orderId:o.id,leadTime:'3.5 months'},client_reference_id:o.id,
    payment_method_types:['card'],expires_at:Math.floor(Date.now()/1000)+1800
   },{idempotencyKey:'bd-'+o.id+'-'+totalPence});
   o.stripeSessionId=s.id;await put(o);return json(200,{url:s.url});
  }
  return error(404,'Not found');
 }catch(e){console.error('Blackdog API error',e?.message||e);return error(500,'Service unavailable; please contact Blackdog Welding')}
};
