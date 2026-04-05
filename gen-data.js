const fs = require('fs');
console.log('Generating training data...');
let samples=[];
for(let i=0;i<95;i++){
  if(i<25){
    samples.push({query:'What is the occupancy rate?',response:'Property Analysis: Occupancy Rate varies by property type. Recommendations: Track trends weekly, adjust pricing.',context:{type:'property'},tags:['property','analytics'],confidence_score:0.95,source:'stoa'});
  }else if(i<45){
    samples.push({query:'Analyze financing terms',response:'Loan Analysis: Monitor DSCR (min 1.25x), track interest exposure, assess refinancing risk.',context:{type:'loan'},tags:['financing','risk'],confidence_score:0.94,source:'stoa'});
  }else if(i<65){
    samples.push({query:'Analyze lease activity',response:'Lease Analysis: Evaluate tenant mix, track renewal patterns, optimize rent pricing.',context:{type:'lease'},tags:['lease','tenant'],confidence_score:0.92,source:'stoa'});
  }else{
    samples.push({query:'Covenant compliance requirements',response:'Covenant Analysis: Monitor DSCR requirements quarterly, maintain liquidity reserves, prepare breach contingency plans.',context:{type:'covenant'},tags:['compliance','risk'],confidence_score:0.91,source:'stoa'});
  }
}
const ts=new Date().toISOString().split('T')[0];
if(!fs.existsSync('./data'))fs.mkdirSync('./data',{recursive:true});
fs.writeFileSync('./data/STOA_TRAINING-'+ts+'.jsonl',samples.map(s=>JSON.stringify(s)).join('\n'));
console.log('Generated '+samples.length+' samples');
console.log('Saved to: ./data/STOA_TRAINING-'+ts+'.jsonl');
