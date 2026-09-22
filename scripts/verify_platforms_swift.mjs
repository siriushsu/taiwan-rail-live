import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app/ios/App/RailBoardWidget/RailBoardData.swift',import.meta.url),'utf8');
const start=source.indexOf('struct RailPlatformSnapshot:');
assert(start>=0);let end=source.indexOf('{',start),depth=1;
while(depth&&++end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
assert.equal(depth,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rail-platform-swift-'));
fs.writeFileSync(dir+'/main.swift',`import Foundation\n${source.slice(start,end+1)}
let now = Date(timeIntervalSince1970: 1788710460)
let departure = now.addingTimeInterval(120)
let arrival = now.addingTimeInterval(-120)
let one: [String:Any] = ["stationName":"臺北", "trainNo":"123", "arrivalAt":arrival.timeIntervalSince1970*1000, "departureAt":departure.timeIntervalSince1970*1000, "platform":"1A", "state":"known", "updatedAt":now.timeIntervalSince1970*1000, "expiresAt":now.timeIntervalSince1970*1000+180000]
func snapshot(_ records:[[String:Any]]) throws -> RailPlatformSnapshot {
    try JSONDecoder().decode(RailPlatformSnapshot.self, from:JSONSerialization.data(withJSONObject:["schema":1,"expiresAt":now.timeIntervalSince1970*1000+180000,"records":records]))
}
let s = try snapshot([one])
precondition(s.platform(train:"123",station:"台北",scheduled:departure,arrival:false,at:now)=="1A")
precondition(s.platform(train:"123",station:"台北",scheduled:arrival,arrival:true,at:now)=="1A")
precondition(s.platform(train:"123",station:"彰化",scheduled:departure,arrival:false,at:now)==nil)
precondition(s.platform(train:"123",station:"台北",scheduled:departure.addingTimeInterval(86400),arrival:false,at:now)==nil)
precondition(s.platform(train:"123",station:"台北",scheduled:departure,arrival:false,at:now.addingTimeInterval(180))==nil)
var empty=one; empty["platform"]=NSNull(); empty["state"]="unavailable"
let withdrawn=try snapshot([empty]);precondition(withdrawn.platform(train:"123",station:"台北",scheduled:departure,arrival:false,at:now)==nil)
var other=one;other["platform"]="2B"
let conflict=try snapshot([one,other]);precondition(conflict.platform(train:"123",station:"台北",scheduled:departure,arrival:false,at:now)==nil)
print("Swift 真實月台比對器：到站、離站、跨日、跨站、過期、空值與衝突 7/7 通過")
`);
execFileSync('xcrun',['swiftc',dir+'/main.swift','-o',dir+'/verify'],{stdio:'inherit'});
execFileSync(dir+'/verify',[],{stdio:'inherit'});
