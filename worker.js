/* Combi Analyzer V4: busca DFS com poda de ramos impossíveis. */
let paused=false, stopped=false, iterator=null, cfg=null, processed=0, found=0, pending=[];
const CHUNK_NODES=50000, SEND_BATCH=500;
self.onmessage=({data})=>{
  if(data.type==='start') start(data.config);
  if(data.type==='pause'){paused=true;}
  if(data.type==='resume'){paused=false;schedule();}
  if(data.type==='stop'){stopped=true;paused=false;schedule();}
};
function start(c){cfg=c;paused=false;stopped=false;processed=0;found=0;pending=[];iterator=search();schedule();}
function schedule(){if(!paused)setTimeout(runChunk,0);}
function runChunk(){if(paused)return;if(stopped){finish('stopped');return;}let nodes=0;
  while(nodes<CHUNK_NODES&&!paused&&!stopped){const step=iterator.next();if(step.done){flush();finish('done');return;}nodes++;processed++;
    if(step.value && step.value.combo){pending.push(step.value);found++;if(pending.length>=SEND_BATCH)flush();if(cfg.targetCount>0&&found>=cfg.targetCount){flush();finish('target');return;}}
  }
  flush();self.postMessage({type:'progress',processed,found});schedule();
}
function* search(){
  const {min,max,pick,filters:f}=cfg, nums=[];
  const excluded=new Set(f.lists?f.exclude:[]);for(let n=min;n<=max;n++)if(!excluded.has(n))nums.push(n);
  const required=f.lists?f.include:[];
  if(required.some(n=>n<min||n>max||excluded.has(n))||new Set(required).size!==required.length||required.length>pick){return;}
  const isPrime=sieve(max), fib=fibonacci(max), half=min+Math.floor((max-min)/2);
  f.previousSet=new Set(f.previousNumbers||[]);
  const selected=[], decadeCounts=new Map(), endingCounts=new Uint8Array(10);
  let nodes=0;
  function* dfs(start,even,primes,sum,consecutive,low,fibCount,multipleCount,repeatCount){
    nodes++;if(nodes%10000===0)yield {tick:true};
    const depth=selected.length, need=pick-depth, remain=nums.length-start;
    if(need<0||remain<need)return;
    if(f.parity&&(even>f.even||even+possibleCount(nums,start,need,n=>n%2===0)<f.even))return;
    if(f.prime&&(primes>f.primes||primes+possibleCount(nums,start,need,n=>isPrime[n])<f.primes))return;
    if(f.low&&(low>f.lowCount||low+possibleCount(nums,start,need,n=>n<=half)<f.lowCount))return;
    if(f.fib&&(fibCount>f.fibCount||fibCount+possibleCount(nums,start,need,n=>fib[n])<f.fibCount))return;
    if(f.multiple&&(multipleCount>f.multipleCount||multipleCount+possibleCount(nums,start,need,n=>n%f.multipleOf===0)<f.multipleCount))return;
    if(f.previous&&(repeatCount>f.repeatMax||repeatCount+possibleCount(nums,start,need,n=>f.previousSet.has(n))<f.repeatMin))return;
    if(f.sum){const minAdd=smallestSum(nums,start,need),maxAdd=largestSum(nums,start,need);if(f.sumMax!==null&&sum+minAdd>f.sumMax)return;if(f.sumMin!==null&&sum+maxAdd<f.sumMin)return;}
    if(f.width&&depth>=2&&selected[depth-1]-selected[0]>f.widthMax&&f.widthMax!==null)return;
    if(f.consecutive&&consecutive>f.maxConsecutive)return;
    if(f.decades){let occupied=decadeCounts.size;if(occupied+Math.min(need,Math.max(0,Math.ceil((max-(selected.length?selected[depth-1]:min-1))/10)))<f.minDecades)return;}
    if(need===0){
      if(f.sum&&((f.sumMin!==null&&sum<f.sumMin)||(f.sumMax!==null&&sum>f.sumMax)))return;
      if(f.width&&((f.widthMin!==null&&selected[pick-1]-selected[0]<f.widthMin)||(f.widthMax!==null&&selected[pick-1]-selected[0]>f.widthMax)))return;
      if(f.decades&&decadeCounts.size<f.minDecades)return;
      if(f.previous&&(repeatCount<f.repeatMin||repeatCount>f.repeatMax))return;
      if(f.lists&&required.some(n=>!selected.includes(n)))return;
      if(f.ending&&Math.max(...endingCounts)>f.maxPerEnding)return;
      if(f.decades&&Math.max(...decadeCounts.values())>f.maxPerDecade)return;
      const combo=selected.slice();let consecPairs=0;for(let i=1;i<combo.length;i++)if(combo[i]===combo[i-1]+1)consecPairs++;
      if(f.consecutive&&consecPairs>f.maxConsecutive)return;
      yield {combo,sum,even,primes};return;
    }
    for(let i=start;i<=nums.length-need;i++){
      const n=nums[i], prev=depth?selected[depth-1]:null;
      if(f.lists&&required.some(r=>!selected.includes(r))){let possible=true;for(const r of required)if(!selected.includes(r)&&r<n){possible=false;break;}if(!possible)continue;}
      const e=even+(n%2===0?1:0),p=primes+(isPrime[n]?1:0),s=sum+n;
      if(f.parity&&e>f.even)continue;if(f.prime&&p>f.primes)continue;if(f.sum&&f.sumMax!==null&&s>f.sumMax)continue;
      const con=consecutive+(prev!==null&&n===prev+1?1:0);if(f.consecutive&&con>f.maxConsecutive)continue;
      const lo=low+(n<=half?1:0);if(f.low&&lo>f.lowCount)continue;
      const fc=fibCount+(fib[n]?1:0);if(f.fib&&fc>f.fibCount)continue;
      const mc=multipleCount+(n%f.multipleOf===0?1:0);if(f.multiple&&mc>f.multipleCount)continue;
      const rc=repeatCount+(f.previous&&f.previousSet.has(n)?1:0);if(f.previous&&rc>f.repeatMax)continue;
      const dec=Math.floor((n-min)/10),dc=(decadeCounts.get(dec)||0)+1;if(f.decades&&dc>f.maxPerDecade)continue;
      const end=n%10,ec=endingCounts[end]+1;if(f.ending&&ec>f.maxPerEnding)continue;
      selected.push(n);decadeCounts.set(dec,dc);endingCounts[end]++;
      yield* dfs(i+1,e,p,s,con,lo,fc,mc,rc);
      selected.pop();endingCounts[end]--;if(dc===1)decadeCounts.delete(dec);else decadeCounts.set(dec,dc-1);
    }
  }
  yield* dfs(0,0,0,0,0,0,0,0,0);
}
function possibleCount(a,start,k,pred){let c=0;for(let i=start;i<a.length;i++)if(pred(a[i]))c++;return Math.min(k,c);}
function smallestSum(a,s,k){let x=0;for(let i=0;i<k;i++)x+=a[s+i]||0;return x;}
function largestSum(a,s,k){let x=0;for(let i=0;i<k;i++)x+=a[a.length-1-i]||0;return x;}
function sieve(max){const a=new Uint8Array(max+1);if(max>=2)a.fill(1,2);for(let p=2;p*p<=max;p++)if(a[p])for(let m=p*p;m<=max;m+=p)a[m]=0;return a;}
function fibonacci(max){const a=new Uint8Array(max+1);let x=0,y=1;while(x<=max){a[x]=1;[x,y]=[y,x+y];}return a;}
function flush(){if(!pending.length)return;const results=pending;pending=[];self.postMessage({type:'batch',results,processed,found});}
function finish(type){flush();self.postMessage({type,processed,found});}
