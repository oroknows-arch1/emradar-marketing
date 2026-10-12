import crypto from 'node:crypto';
export function authorizedPreparation(req,env=process.env){
 const secret=env.MARKETING_PREPARATION_TOKEN,actual=String(req.headers?.authorization||''),expected='Bearer '+String(secret||'');
 return !!secret&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
