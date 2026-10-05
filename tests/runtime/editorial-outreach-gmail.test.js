import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialRouteSupported,editorialRouteAuthorized} from '../../runtime/editorial-outreach-gmail.js';

test('Gmail transport authorizes only with both deployment secrets',async()=>{
  const beforeUser=process.env.EDITORIAL_GMAIL_USER,beforePassword=process.env.EDITORIAL_GMAIL_APP_PASSWORD;
  try{
    delete process.env.EDITORIAL_GMAIL_USER;delete process.env.EDITORIAL_GMAIL_APP_PASSWORD;
    assert.equal(await editorialRouteAuthorized(),false);
    process.env.EDITORIAL_GMAIL_USER='oroknows@gmail.com';
    assert.equal(await editorialRouteAuthorized(),false);
    process.env.EDITORIAL_GMAIL_APP_PASSWORD='not-a-real-secret';
    assert.equal(await editorialRouteAuthorized(),true);
  }finally{
    if(beforeUser===undefined)delete process.env.EDITORIAL_GMAIL_USER;else process.env.EDITORIAL_GMAIL_USER=beforeUser;
    if(beforePassword===undefined)delete process.env.EDITORIAL_GMAIL_APP_PASSWORD;else process.env.EDITORIAL_GMAIL_APP_PASSWORD=beforePassword;
  }
});

test('Gmail transport supports verified email routes but not public forms',()=>{
  assert.equal(editorialRouteSupported({access_method:'public editorial email'}),true);
  assert.equal(editorialRouteSupported({access_method:'public feedback/tip-off form'}),false);
});
