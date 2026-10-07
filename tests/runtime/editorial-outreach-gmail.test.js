import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialRouteSupported,editorialRouteAuthorized} from '../../runtime/editorial-outreach-gmail.js';

test('canonical SMTP requires host, matching mailbox and password',async()=>{
 const saved={...process.env};delete process.env.EMRADAR_EMAIL_RELAY_URL;
 try{delete process.env.EDITORIAL_SMTP_PASSWORD;assert.equal(await editorialRouteAuthorized(),false);
 Object.assign(process.env,{EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture'});assert.equal(await editorialRouteAuthorized(),true);
 process.env.EDITORIAL_SMTP_USER='oroknows@gmail.com';assert.equal(await editorialRouteAuthorized(),false);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});

test('Gmail transport supports verified email routes but not public forms',()=>{
  assert.equal(editorialRouteSupported({access_method:'public editorial email'}),true);
  assert.equal(editorialRouteSupported({access_method:'public feedback/tip-off form'}),false);
});

