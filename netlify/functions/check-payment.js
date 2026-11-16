import Stripe from 'stripe';
export const handler=async event=>{
  const id=event.queryStringParameters?.session_id;
  if(!id||!/^cs_(test_)?[A-Za-z0-9]+$/.test(id))return {statusCode:400,body:JSON.stringify({error:'Invalid checkout session'})};
  if(!process.env.STRIPE_SECRET_KEY)return {statusCode:503,body:JSON.stringify({error:'Stripe is not configured'})};
  try{const session=await new Stripe(process.env.STRIPE_SECRET_KEY).checkout.sessions.retrieve(id);
    return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({paid:session.payment_status==='paid',status:session.status,reference:session.client_reference_id})};
  }catch{return {statusCode:404,body:JSON.stringify({error:'Payment session not found'})}}
};
