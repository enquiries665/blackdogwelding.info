
import Stripe from 'stripe';
const prices = {tray:4650,canopy:7850,fencing:7850,construction:8250,agriculture:7850};
const productNames = {tray:'Standard Double Cab Tray',canopy:'Shooting Tray & Canopy',fencing:'Fencing Contractor Canopy',construction:'Construction Canopy',agriculture:'Agriculture Canopy'};
const allowedMakes = ['Ford','Toyota','Isuzu','Mitsubishi','Nissan','Volkswagen','Ram','Other'];
const valid = (s, max=100) => typeof s === 'string' && s.trim().length>0 && s.length<=max;
const error = (statusCode,message)=>({statusCode,headers:{'Content-Type':'application/json'},body:JSON.stringify({error:message})});
export const handler = async event => {
  if(event.httpMethod!=='POST')return error(405,'Method not allowed');
  // Live payments require an explicit mode switch AND a matching Stripe secret key.
  const stripeMode = (process.env.STRIPE_MODE || 'test').trim().toLowerCase();
  if (!['test','live'].includes(stripeMode)) return error(503, 'Invalid Stripe mode configuration');
const stripeKey = (process.env.STRIPE_TRAY_LIVE_KEY || '').trim();
  if (!stripeKey) return error(503, 'Stripe secret key is missing from Netlify');
  if (stripeMode !== 'live') {
    return error(503, 'Diagnostic: Stripe mode is not live');
}
if (!/^(sk|rk)_live_/.test(stripeKey)) {
    return error(503, 'Diagnostic: Stored Stripe key is not a live key');
}
  
  let p;try{p=JSON.parse(event.body||'{}')}catch{return error(400,'Invalid request')}
  if(!Object.hasOwn(prices,p.product)||!allowedMakes.includes(p.make)||!valid(p.model,80)||!valid(p.customerEmail,254)||!/^\S+@\S+\.\S+$/.test(p.customerEmail))return error(400,'Please check your build and email');
  const year=Number(p.year), lights=Number(p.lights), eyes=Number(p.eyes);
  if(!Number.isInteger(year)||year<1980||year>2035||!Number.isInteger(lights)||lights<0||lights>4||!Number.isInteger(eyes)||![0,2,4,6,8].includes(eyes)||typeof p.tank!=='boolean'||p.leadTimeAccepted!==true)return error(400,'Invalid vehicle options');
  if(!valid(p.customerName,120)||!valid(p.customerPhone,40)||!valid(p.billingAddress,500))return error(400,'Please provide your customer details');
  if(p.cab!=='Double Cab'||p.fulfilment!=='fit'||p.boxes!==false)return error(400,'This configuration needs a confirmed quote before payment');
  const subtotalPence=(prices[p.product]+(p.tank?399:0)+lights*55+eyes*14)*100;
  const amountPence=Math.round(subtotalPence*1.2); // 20% VAT, integer pennies
  // Use the canonical production site, not a preview deploy URL.
  const origin=(process.env.URL||'').replace(/\/$/,'');
  if(!origin||!/^https:\/\//.test(origin))return error(503,'Site URL is not configured');
  const stripe=new Stripe(stripeKey);
  try{
    const session=await stripe.checkout.sessions.create({
      mode:'payment',customer_email:p.customerEmail,client_reference_id:'blackdog-'+Date.now(),
      billing_address_collection:'required',
      line_items:[{price_data:{currency:'gbp',unit_amount:amountPence,product_data:{name:productNames[p.product],description:`${p.make} ${p.model} (${year}); workshop fitting; extras included; VAT included`}},quantity:1}],
      metadata:{product:p.product,make:p.make,model:p.model.trim(),year:String(year),cab:p.cab,fulfilment:'Workshop fitting',water_tank:p.tank?'Yes':'No',led_lights:String(lights),lashing_eyes:String(eyes),subtotal_gbp:(subtotalPence/100).toFixed(2),vat_gbp:((amountPence-subtotalPence)/100).toFixed(2),total_gbp:(amountPence/100).toFixed(2),lead_time_accepted:'3.5 months',customer_name:p.customerName.trim(),customer_phone:p.customerPhone.trim(),billing_address:p.billingAddress.trim(),delivery_postcode:String(p.postcode||'').slice(0,30)},
      payment_intent_data:{metadata:{product:p.product,vehicle:`${p.make} ${p.model}`,year:String(year)}},
      success_url:`${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${origin}/shop.html`
    });
    return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({url:session.url})};
 }catch(e){
  console.error('Stripe checkout creation failed', {
    type: e.type,
    code: e.code,
    message: e.message,
    statusCode: e.statusCode,
    requestId: e.requestId
  });
  return error(502, 'Could not start Stripe checkout. Please try again or contact Blackdog Welding.');
}
};
