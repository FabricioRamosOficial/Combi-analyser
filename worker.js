/* Combi Analyzer V14: geração sequencial/aleatória e frequência global Mono–Quina. */
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
    if(step.value && step.value.distributionError){flush();self.postMessage({type:'impossible',message:step.value.distributionError,processed,found});return;}
    if(step.value && step.value.combo){pending.push(step.value);found++;if(pending.length>=SEND_BATCH)flush();if(!cfg.filters.frequency&&cfg.targetCount>0&&found>=cfg.targetCount){flush();finish('target');return;}}
  }
  flush();self.postMessage({type:'progress',processed,found});schedule();
}
function* search(){
  if(cfg.filters.frequency){yield* searchWithFrequency();return;}
  yield* searchBase();
}
function* searchBase(){ if(cfg.mode==='random'){yield* searchRandom();return;} yield* searchSequential(); }

// Os filtros Mono–Quina descrevem a distribuição de frequência do conjunto inteiro.
// Por isso, primeiro reunimos as cartelas que passam pelos filtros individuais e,
// depois, procuramos um subconjunto com a distribuição global solicitada.
function* searchWithFrequency(){
  const candidates=[];
  for(const item of searchBase()){
    if(item && item.combo)candidates.push(item);
    else if(item && item.tick)yield item;
  }
  if(!candidates.length){yield {distributionError:'Nenhuma cartela passou pelos filtros individuais. Reduza ou desative alguns filtros e tente novamente.'};return;}
  const wanted=cfg.targetCount>0?cfg.targetCount:candidates.length;
  if(wanted>candidates.length){yield {distributionError:`Foram encontradas apenas ${candidates.length.toLocaleString('pt-BR')} cartelas válidas, mas você pediu ${wanted.toLocaleString('pt-BR')}. Reduza a quantidade desejada ou ajuste os filtros.`};return;}
  const targets=cfg.filters.frequencyTargets;
  const keys=['mono','duque','terno','quadra','quina'];
  const constrained=keys.filter(k=>targets[k]!==null);
  const maxNumber=cfg.max;
  const scoreSet=indices=>{
    const appearances=new Uint32Array(maxNumber+1);
    for(const idx of indices)for(const n of candidates[idx].combo)appearances[n]++;
    const hist={mono:0,duque:0,terno:0,quadra:0,quina:0};
    for(let n=cfg.min;n<=maxNumber;n++){const f=appearances[n];if(f>=1&&f<=5)hist[keys[f-1]]++;}
    let score=0;for(const k of constrained)score+=Math.abs(hist[k]-targets[k]);
    return {score,hist};
  };
  let best=null,bestScore=Infinity;
  if(wanted===candidates.length){
    const indices=Array.from({length:candidates.length},(_,i)=>i);const result=scoreSet(indices);best={indices,...result};bestScore=result.score;
  }else{
    let seed=0x12345678;const rng=cfg.mode==='random'?Math.random:()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    const attempts=Math.max(250,Math.min(1200,Math.floor(3000000/Math.max(1,wanted))));
    for(let attempt=0;attempt<attempts;attempt++){
      // Amostragem sem reposição em O(quantidade pedida), sem criar um vetor
      // auxiliar do tamanho de todo o universo de cartelas a cada tentativa.
      const chosen=new Set();
      for(let j=candidates.length-wanted;j<candidates.length;j++){const t=Math.floor(rng()*(j+1));chosen.add(chosen.has(t)?j:t);}
      const indices=[...chosen];const result=scoreSet(indices);
      if(result.score<bestScore){bestScore=result.score;best={indices,hist:result.hist,score:result.score};}
      if(result.score===0)break;
      if(attempt%20===0)yield {tick:true};
    }
  }
  if(!best||bestScore!==0){
    const detail=best?keys.filter(k=>targets[k]!==null).map(k=>`${k}: pedido ${targets[k]}, melhor resultado ${best.hist[k]}`).join(' | '):'Não foi possível avaliar a distribuição.';
    yield {distributionError:`A busca não localizou um conjunto de ${wanted.toLocaleString('pt-BR')} cartelas que cumpra exatamente todos os valores Mono–Quina. Melhor aproximação encontrada: ${detail}. Isso não prova que seja impossível; tente alterar os valores ou a quantidade de cartelas.`};return;
  }
  if(cfg.mode==='sequential')best.indices.sort((a,b)=>a-b);
  const labels={mono:'Mono',duque:'Duque',terno:'Terno',quadra:'Quadra',quina:'Quina'};
  self.postMessage({type:'frequencySummary',text:keys.map(k=>`${labels[k]}: ${best.hist[k]}`).join(' • ')});
  for(const idx of best.indices)yield candidates[idx];
}
function* searchSequential(){
  const {min,max,pick,filters:f}=cfg, nums=[];
  const excluded=new Set(f.lists?f.exclude:[]);
  const source=Array.isArray(cfg.candidateNumbers)?cfg.candidateNumbers:Array.from({length:max-min+1},(_,i)=>min+i);
  for(const n of source)if(Number.isInteger(n)&&n>=min&&n<=max&&!excluded.has(n))nums.push(n);
  nums.sort((a,b)=>a-b);
  if(nums.length<pick)return;
  const required=[...new Set(f.lists?f.include:[])].sort((a,b)=>a-b);
  if(required.some(n=>n<min||n>max||excluded.has(n))||required.length>pick){return;}
  const isPrime=sieve(max), fib=fibonacci(max), half=min+Math.floor((max-min)/2);
  f.previousSet=new Set(f.previousNumbers||[]);
  const selected=[], decadeCounts=new Map(), endingCounts=new Uint8Array(10);
  let nodes=0;
  function* dfs(start,even,primes,sum,consecutive,low,fibCount,multipleCount,repeatCount){
    nodes++;if(nodes%10000===0)yield {tick:true};
    const depth=selected.length, need=pick-depth, remain=nums.length-start;
    if(need<0||remain<need)return;
    if(f.parity){const odd=depth-even,evensPossible=possibleCount(nums,start,need,n=>n%2===0),oddsPossible=possibleCount(nums,start,need,n=>n%2!==0);if(even>f.evenMax||odd>f.oddMax||even+evensPossible<f.evenMin||odd+oddsPossible<f.oddMin)return;}
    if(f.prime&&(primes>f.primeMax||primes+possibleCount(nums,start,need,n=>isPrime[n])<f.primeMin))return;
    if(f.low&&(low>f.lowMax||low+possibleCount(nums,start,need,n=>n<=half)<f.lowMin))return;
    if(f.fib&&(fibCount>f.fibMax||fibCount+possibleCount(nums,start,need,n=>fib[n])<f.fibMin))return;
    if(f.multiple&&(multipleCount>f.multipleMax||multipleCount+possibleCount(nums,start,need,n=>n%f.multipleOf===0)<f.multipleMin))return;
    if(f.previous&&(repeatCount>f.repeatMax||repeatCount+possibleCount(nums,start,need,n=>f.previousSet.has(n))<f.repeatMin))return;
    if(f.sum){const minAdd=smallestSum(nums,start,need),maxAdd=largestSum(nums,start,need);if(f.sumMax!==null&&sum+minAdd>f.sumMax)return;if(f.sumMin!==null&&sum+maxAdd<f.sumMin)return;}
    if(f.width&&depth>=2&&selected[depth-1]-selected[0]>f.widthMax&&f.widthMax!==null)return;
    if(f.consecutive&&consecutive>f.maxConsecutive)return;
    if(f.decades){let occupied=decadeCounts.size;if(occupied+Math.min(need,Math.max(0,Math.ceil((max-(selected.length?selected[depth-1]:min-1))/10)))<f.minDecades)return;}
    if(need===0){
      if(f.parity&&(even<f.evenMin||even>f.evenMax||(pick-even)<f.oddMin||(pick-even)>f.oddMax))return;
      if(f.sum&&((f.sumMin!==null&&sum<f.sumMin)||(f.sumMax!==null&&sum>f.sumMax)))return;
      if(f.prime&&(primes<f.primeMin||primes>f.primeMax))return;
      if(f.low&&(low<f.lowMin||low>f.lowMax))return;
      if(f.fib&&(fibCount<f.fibMin||fibCount>f.fibMax))return;
      if(f.multiple&&(multipleCount<f.multipleMin||multipleCount>f.multipleMax))return;
      if(f.width&&((f.widthMin!==null&&selected[pick-1]-selected[0]<f.widthMin)||(f.widthMax!==null&&selected[pick-1]-selected[0]>f.widthMax)))return;
      if(f.decades&&(decadeCounts.size<f.minDecades||decadeCounts.size>f.maxDecades))return;
      if(f.previous&&(repeatCount<f.repeatMin||repeatCount>f.repeatMax))return;
      if(required.some(n=>!selected.includes(n)))return;
      if(f.ending&&(Math.max(...endingCounts)>f.maxPerEnding||endingCounts.filter(v=>v>0).length<f.minDistinctEndings||endingCounts.filter(v=>v>0).length>f.maxDistinctEndings))return;
      if(f.decades&&Math.max(...decadeCounts.values())>f.maxPerDecade)return;
      const combo=selected.slice();let consecPairs=0;for(let i=1;i<combo.length;i++)if(combo[i]===combo[i-1]+1)consecPairs++;
      if(f.consecutive&&(consecPairs<f.minConsecutive||consecPairs>f.maxConsecutive))return;
      yield {combo,sum,even,primes};return;
    }
    for(let i=start;i<=nums.length-need;i++){
      const n=nums[i], prev=depth?selected[depth-1]:null;
      if(required.some(r=>!selected.includes(r))){let possible=true;for(const r of required)if(!selected.includes(r)&&r<n){possible=false;break;}if(!possible)continue;}
      const e=even+(n%2===0?1:0),p=primes+(isPrime[n]?1:0),s=sum+n;
      if(f.parity&&(e>f.evenMax||((selected.length+1)-e)>f.oddMax))continue;if(f.prime&&p>f.primeMax)continue;if(f.sum&&f.sumMax!==null&&s>f.sumMax)continue;
      const con=consecutive+(prev!==null&&n===prev+1?1:0);if(f.consecutive&&con>f.maxConsecutive)continue;
      const lo=low+(n<=half?1:0);if(f.low&&lo>f.lowMax)continue;
      const fc=fibCount+(fib[n]?1:0);if(f.fib&&fc>f.fibMax)continue;
      const mc=multipleCount+(n%f.multipleOf===0?1:0);if(f.multiple&&mc>f.multipleMax)continue;
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

function* searchRandom(){
  const {min,max,pick,filters:f}=cfg;
  const excluded=new Set(f.lists?f.exclude:[]);
  const nums=(Array.isArray(cfg.candidateNumbers)?cfg.candidateNumbers:Array.from({length:max-min+1},(_,i)=>min+i)).filter(n=>Number.isInteger(n)&&n>=min&&n<=max&&!excluded.has(n));
  if(nums.length<pick)return;
  const required=[...new Set(f.lists?f.include:[])];
  if(required.length>pick||required.some(n=>!nums.includes(n)))return;
  // Embaralhar a ordem dos candidatos embaralha a ordem de visita das cartelas,
  // mas cada subconjunto continua a ser visitado exatamente uma vez.
  for(let i=nums.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[nums[i],nums[j]]=[nums[j],nums[i]];}
  const prime=sieve(max),fib=fibonacci(max),half=min+Math.floor((max-min)/2),selected=[];
  const previous=new Set(f.previousNumbers||[]);
  let visits=0;
  function valid(raw){
    const a=raw.slice().sort((x,y)=>x-y),sum=a.reduce((x,y)=>x+y,0);
    const even=a.filter(n=>n%2===0).length,odd=pick-even,primes=a.filter(n=>prime[n]).length;
    const lows=a.filter(n=>n<=half).length,fibs=a.filter(n=>fib[n]).length;
    const multiples=a.filter(n=>n%f.multipleOf===0).length;
    const repeats=a.filter(n=>previous.has(n)).length;
    const width=a[a.length-1]-a[0];
    let consecutive=0;for(let i=1;i<a.length;i++)if(a[i]===a[i-1]+1)consecutive++;
    const decades=new Map(),ends=new Uint8Array(10);
    for(const n of a){const d=Math.floor((n-min)/10);decades.set(d,(decades.get(d)||0)+1);ends[n%10]++;}
    const distinctEnds=ends.filter(x=>x>0).length;
    if(required.some(n=>!a.includes(n)))return false;
    if(f.parity&&(even<f.evenMin||even>f.evenMax||odd<f.oddMin||odd>f.oddMax))return false;
    if(f.prime&&(primes<f.primeMin||primes>f.primeMax))return false;
    if(f.sum&&((f.sumMin!==null&&sum<f.sumMin)||(f.sumMax!==null&&sum>f.sumMax)))return false;
    if(f.consecutive&&(consecutive<f.minConsecutive||consecutive>f.maxConsecutive))return false;
    if(f.low&&(lows<f.lowMin||lows>f.lowMax))return false;
    if(f.decades&&(decades.size<f.minDecades||decades.size>f.maxDecades||Math.max(...decades.values())>f.maxPerDecade))return false;
    if(f.ending&&(distinctEnds<f.minDistinctEndings||distinctEnds>f.maxDistinctEndings||Math.max(...ends)>f.maxPerEnding))return false;
    if(f.width&&((f.widthMin!==null&&width<f.widthMin)||(f.widthMax!==null&&width>f.widthMax)))return false;
    if(f.fib&&(fibs<f.fibMin||fibs>f.fibMax))return false;
    if(f.multiple&&(multiples<f.multipleMin||multiples>f.multipleMax))return false;
    if(f.previous&&(repeats<f.repeatMin||repeats>f.repeatMax))return false;
    return true;
  }
  function* visit(start){
    const need=pick-selected.length;
    if(need===0){visits++;if(visits%10000===0)yield {tick:true};if(valid(selected)){const combo=selected.slice().sort((a,b)=>a-b);yield {combo,sum:combo.reduce((x,y)=>x+y,0),even:combo.filter(n=>n%2===0).length,primes:combo.filter(n=>prime[n]).length};}return;}
    for(let i=start;i<=nums.length-need;i++){
      selected.push(nums[i]);yield* visit(i+1);selected.pop();
    }
  }
  yield* visit(0);
}
function possibleCount(a,start,k,pred){let c=0;for(let i=start;i<a.length;i++)if(pred(a[i]))c++;return Math.min(k,c);}
function smallestSum(a,s,k){let x=0;for(let i=0;i<k;i++)x+=a[s+i]||0;return x;}
function largestSum(a,s,k){let x=0;for(let i=0;i<k;i++)x+=a[a.length-1-i]||0;return x;}
function sieve(max){const a=new Uint8Array(max+1);if(max>=2)a.fill(1,2);for(let p=2;p*p<=max;p++)if(a[p])for(let m=p*p;m<=max;m+=p)a[m]=0;return a;}
function fibonacci(max){const a=new Uint8Array(max+1);let x=0,y=1;while(x<=max){a[x]=1;[x,y]=[y,x+y];}return a;}
function flush(){if(!pending.length)return;const results=pending;pending=[];self.postMessage({type:'batch',results,processed,found});}
function finish(type){flush();self.postMessage({type,processed,found});}
