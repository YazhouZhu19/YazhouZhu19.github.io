import test from "node:test";
import assert from "node:assert/strict";
import { assessmentChanges, emptyAssessmentHistory, readAssessmentHistory, recordAssessment, reviewAssessment, serializeAssessmentHistory } from "../lib/assessment-history";
import type { ForesightCard, ForesightResult } from "../lib/foresight-types";
const text = { zh: "待验证的研究假设", en: "A hypothesis to verify" };
const card: ForesightCard = { id:"method:a",dimension:"method",label:text,title:text,observation:text,forecast:text,strength:"limited",horizon:"6–12",alternative:text,action:text,watch:text,evidence:[],paperIds:["a","b","c"],currentCount:3,previousCount:1,currentDenominator:10,previousDenominator:10,delta:null,signature:"first" };
function result(patch: Partial<ForesightResult> = {}): ForesightResult { return {key:"direction:a",asOf:"2026-10-14",from:"2026-07-17",previousFrom:"2026-04-18",previousTo:"2026-07-16",papers:[],current:[],previous:[],cards:[card],missingAbstracts:0,duplicatesRemoved:0,excludedFuture:0,comparisonReady:false,caveats:[],fingerprint:"first",...patch}; }
const stamp = "2026-10-14T08:00:00.000Z";
test("history starts only at an observed hypothesis and ignores identical rerenders",()=>{
 const empty=emptyAssessmentHistory(); assert.equal(recordAssessment(empty,result({cards:[]}),stamp),empty);
 const one=recordAssessment(empty,result(),stamp); assert.equal(one.contexts["direction:a"].length,1);
 assert.equal(recordAssessment(one,result(),"2026-10-15T08:00:00.000Z"),one);
 assert.equal(one.contexts["direction:a"][0].recordedAt,stamp);
 assert.equal(assessmentChanges(one.contexts["direction:a"][0]).initial,true);
});
test("changed hypotheses and withdrawals preserve the original forecast and manual review",()=>{
 const one=recordAssessment(emptyAssessmentHistory(),result(),stamp);
 const reviewed=reviewAssessment(one,"direction:a",one.contexts["direction:a"][0].id,"not-supported","Later evidence contradicted this hypothesis.");
 const two=recordAssessment(reviewed,result({cards:[{...card,strength:"supported",signature:"second"}],fingerprint:"second"}),"2026-10-15T08:00:00.000Z");
 const change=assessmentChanges(two.contexts["direction:a"][0],two.contexts["direction:a"][1]);
 assert.equal(change.stronger,1);assert.equal(change.changed,1);assert.equal(two.contexts["direction:a"][1].review,"not-supported");
 const three=recordAssessment(two,result({cards:[],fingerprint:"withdrawn"}),"2026-10-16T08:00:00.000Z");
 assert.equal(assessmentChanges(three.contexts["direction:a"][0],three.contexts["direction:a"][1]).removed,1);
 assert.equal(three.contexts["direction:a"][0].review,"pending");
 assert.equal(one.contexts["direction:a"][0].review,"pending");
});
test("history retention is bounded and a selected scope does not erase another",()=>{
 let history=emptyAssessmentHistory();
 for(let n=0;n<16;n++)history=recordAssessment(history,result({fingerprint:String(n)}),`2026-10-${String(n+1).padStart(2,"0")}T08:00:00.000Z`);
 assert.equal(history.contexts["direction:a"].length,12);
 history=recordAssessment(history,result({key:"team:b"}),stamp);
 assert.equal(history.contexts["direction:a"].length,12);assert.equal(history.contexts["team:b"].length,1);
 assert.deepEqual(readAssessmentHistory(serializeAssessmentHistory(history)),history);
});
test("malformed storage fails closed and invalid review values cannot replace history",()=>{
 assert.throws(()=>readAssessmentHistory("{broken"));
 assert.throws(()=>readAssessmentHistory('{"schema":"different","contexts":{}}'));
 const history=recordAssessment(emptyAssessmentHistory(),result(),stamp);
 assert.throws(()=>reviewAssessment(history,"direction:a",history.contexts["direction:a"][0].id,"made-up" as any,""));
 assert.equal(history.contexts["direction:a"][0].review,"pending");
});
