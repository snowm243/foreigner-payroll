const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../.qa/node_modules/jsdom');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function setup(saved) {
  const dom = new JSDOM(html, {runScripts:'dangerously', url:'https://example.test/foreigner-payroll/', beforeParse(w){if(saved)w.localStorage.setItem('foreigner-payroll:v2',saved);}});
  const w=dom.window, d=w.document;
  const el=id=>d.getElementById(id);
  const set=(id,v)=>{if(typeof v==='boolean')el(id).checked=v;else el(id).value=String(v);el(id).dispatchEvent(new w.Event('input',{bubbles:true}));};
  const rows=()=>Array.from(el('tbody').rows,r=>Array.from(r.cells,c=>c.textContent));
  const sums=()=>Array.from(el('summary').querySelectorAll('.sum-val'),e=>Number(e.textContent.replace(/[¥,]/g,'')));
  return {w,d,el,set,rows,sums};
}
test('empty initial state is zero and does not save salary',()=>{
  const a=setup();assert.equal(a.rows().length,12);assert.deepEqual(a.sums(),[0,0,0,0,0]);assert.equal(a.w.localStorage.length,0);a.w.close();
});
test('known 20,000 salary with no contributions: 19,080 annual tax',()=>{
  const a=setup();a.set('salary',20000);a.set('foreigner',true);
  assert.deepEqual(a.sums(),[240000,0,0,19080,220920]);assert.equal(a.rows()[0][6],'450.00');assert.equal(a.rows()[11][6],'3,000.00');a.w.close();
});
test('manual base is honored; clearing restores automatic base; reference affects cap',()=>{
  const a=setup();a.set('salary',20000);a.set('baseOverride',10000);assert.equal(a.rows()[0][2],'1,050.00');
  a.set('salary',25000);assert.equal(a.el('baseOverride').value,'10000');assert.equal(a.rows()[0][2],'1,050.00');
  a.set('baseOverride','');assert.equal(a.rows()[0][2],'2,625.00');
  a.set('avgSalary',5000);assert.equal(a.rows()[0][2],'1,575.00');a.w.close();
});
test('zero base and insurance exclusion remain independent of housing fund',()=>{
  const a=setup();a.set('salary',20000);a.set('baseOverride',0);a.set('fundAmount',1400);
  assert.equal(a.rows()[0][2],'0.00');assert.equal(a.rows()[0][3],'1,400.00');
  a.set('baseOverride',10000);assert.equal(a.rows()[0][2],'1,050.00');a.set('foreigner',true);assert.equal(a.rows()[0][2],'0.00');assert.equal(a.rows()[0][3],'1,400.00');a.w.close();
});
test('bonus bracket boundary retains discontinuity and monthly quick deduction',()=>{
  const a=setup();assert.equal(a.w.calcBonus(36000).tax,1080);assert.equal(a.w.calcBonus(36001).tax,3390.1);assert.equal(a.w.calcBonus(144000).tax,14190);assert.equal(a.w.calcBonus(0).net,0);a.w.close();
});
test('all cumulative brackets agree with independent marginal-rate reference',()=>{
  const a=setup();const widths=[36000,108000,156000,120000,240000,300000,Infinity],rates=[.03,.1,.2,.25,.3,.35,.45];
  const expected=x=>{let tax=0;for(let i=0;i<widths.length;i++){let part=Math.min(Math.max(x,0),widths[i]);tax+=part*rates[i];x-=part;}return tax;};
  for(const n of [0,36000,36001,144000,144001,300000,300001,420000,420001,660000,660001,960000,960001,1200000])assert.ok(Math.abs(a.w.calcTax(n)-expected(n))<1e-6);
  a.w.close();
});
test('invalid amounts and mutually exclusive deductions clear stale results',()=>{
  const a=setup();a.set('salary',20000);a.set('salary',-1);assert.equal(a.el('errors').hidden,false);assert.equal(a.rows().length,0);
  a.set('salary',20000);a.set('c4',true);a.set('c5',true);assert.match(a.el('errors').textContent,/Choose rent/);
  a.set('c5',false);a.set('c8',true);assert.match(a.el('errors').textContent,/Choose benefits/);
  a.set('c4',false);a.set('v8',21000);assert.match(a.el('errors').textContent,/Benefits cannot exceed/);a.w.close();
});
test('deductions use current amounts and benefits reduce taxable salary only',()=>{
  const a=setup();a.set('salary',20000);a.set('foreigner',true);a.set('c1',true);assert.equal(a.sums()[3],14280);
  a.set('c1',false);a.set('c8',true);a.set('v8',5000);assert.equal(a.sums()[3],9480);assert.equal(a.sums()[4],230520);a.w.close();
});
test('month filter does not change annual totals; cent-level totals reconcile',()=>{
  const a=setup();a.set('salary',23456.78);a.set('baseOverride',12345.67);a.set('fundAmount',789.01);a.set('bonus',36001);
  const before=a.sums();assert.ok(Math.abs(before[0]-before[1]-before[2]-before[3]-before[4])<.001);
  a.el('monthSelect').value='9';a.el('monthSelect').dispatchEvent(new a.w.Event('change'));assert.equal(a.rows().length,1);assert.deepEqual(a.sums(),before);a.w.close();
});
test('opt-in restores manual base; clear removes stored inputs; corrupt state recovers',()=>{
  const a=setup();a.set('salary',20000);a.set('baseOverride',10000);a.set('remember',true);
  const b=setup(a.w.localStorage.getItem('foreigner-payroll:v2'));assert.equal(b.rows()[0][2],'1,050.00');assert.equal(b.el('remember').checked,true);
  b.el('clearData').click();assert.deepEqual(b.sums(),[0,0,0,0,0]);assert.equal(b.w.localStorage.length,0);
  const c=setup('{bad');assert.deepEqual(c.sums(),[0,0,0,0,0]);a.w.close();b.w.close();c.w.close();
});
