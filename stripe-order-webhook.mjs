import Stripe from 'stripe';

const reply = (statusCode, message) => ({statusCode, headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[char]));
const money = amount => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(amount / 100);

export const handler = async event => {
  if(event.httpMethod !== 'POST') return reply(405,'Method not allowed');
  const mode=(process.env.STRIPE_MODE||'test').trim().toLowerCase();
  const key=(process.env.STRIPE_SECRET_KEY||'').trim();
  const signingSecret=(process.env.STRIPE_WEBHOOK_SECRET||'').trim();
  const resendKey=(process.env.RESEND_API_KEY||'').trim();
  const from=(process.env.ORDER_EMAIL_FROM||'').trim();
  const to=(process.env.ORDER_EMAIL_TO||'enquiries@blackdogwelding.info').trim();
  if(!['test','live'].includes(mode)||!key.startsWith(mode==='live'?'sk_live_':'sk_test_')||!signingSecret||!resendKey||!from) {
    console.error('Order webhook configuration incomplete');
    return reply(503,'Webhook not configured');
  }
  const signature=event.headers?.['stripe-signature']||event.headers?.['Stripe-Signature'];
  if(!signature||!event.body) return reply(400,'Missing signed event');
  const stripe=new Stripe(key);
  let stripeEvent;
  try {
    const raw=event.isBase64Encoded?Buffer.from(event.body,'base64'):event.body;
    stripeEvent=stripe.webhooks.constructEvent(raw,signature,signingSecret);
  } catch (err) {
    console.error('Invalid Stripe webhook signature',err.message);
    return reply(400,'Invalid signature');
  }
  if(stripeEvent.livemode !== (mode==='live')) return reply(400,'Wrong payment mode');
  if(stripeEvent.type!=='checkout.session.completed' && stripeEvent.type!=='checkout.session.async_payment_succeeded') return reply(200,'Event ignored');
  const session=stripeEvent.data.object;
  if(session.mode!=='payment'||session.payment_status!=='paid') return reply(200,'Payment not yet confirmed');
  if(!String(session.client_reference_id||'').startsWith('blackdog-')) return reply(200,'Not a Blackdog shop order');
  const m=session.metadata||{};
  const fields=[
    ['Product',m.product],['Vehicle make',m.make],['Vehicle model',m.model],['Vehicle year',m.year],['Cab type',m.cab],
    ['Fulfilment',m.fulfilment],['Water tank',m.water_tank],['LED lights',m.led_lights],['Lashing eyes',m.lashing_eyes],
    ['Subtotal (ex VAT)',m.subtotal_gbp ? '£'+m.subtotal_gbp : ''],['VAT',m.vat_gbp ? '£'+m.vat_gbp : ''],
    ['Total paid',money(session.amount_total||0)],['Customer name',m.customer_name||session.customer_details?.name],
    ['Customer email',session.customer_details?.email||session.customer_email],['Customer phone',m.customer_phone||session.customer_details?.phone],
    ['Billing address entered on site',m.billing_address],['Stripe billing address',session.customer_details?.address ? Object.values(session.customer_details.address).filter(Boolean).join(', ') : ''],
    ['Postcode',m.delivery_postcode],['Manufacturing lead time',m.lead_time_accepted],['Stripe checkout ID',session.id],['Payment intent',session.payment_intent]
  ];
  const html='<h2>New paid Blackdog Welding order</h2><p>Stripe has confirmed the payment.</p><table cellpadding="7" cellspacing="0" border="1" style="border-collapse:collapse">'+fields.map(([label,value])=>'<tr><th align="left">'+esc(label)+'</th><td>'+esc(value)+'</td></tr>').join('')+'</table><p>Verify this order in Stripe before fulfilment.</p>';
  const plaintext='New paid Blackdog Welding order\n\n'+fields.map(([label,value])=>label+': '+String(value??'')).join('\n');
  let response;
  try {
    response=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':'Bearer '+resendKey,'Content-Type':'application/json','Idempotency-Key':'blackdog-'+session.id},
      body:JSON.stringify({from,to:[to],subject:'PAID ORDER — Blackdog Welding — '+(m.product||'Shop order')+' — '+money(session.amount_total||0),html,text:plaintext})
    });
  } catch (err) {console.error('Email provider unreachable',err.message);return reply(502,'Email service unavailable');}
  if(!response.ok){console.error('Order email failed',response.status,(await response.text()).slice(0,400));return reply(502,'Email send failed');}
  console.log('Paid order email accepted',session.id,stripeEvent.id);
  return reply(200,'Order email accepted');
};
