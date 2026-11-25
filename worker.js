/* Combi Analyzer V17: geração sequencial/aleatória e frequência global Mono–Quina. */
let paused=false, stopped=false, iterator=null, cfg=null, processed=0, found=0, pending=[], partialReason='';
const CHUNK_NODES=50000, SEND_BATCH=500;
self.onmessage=({data})=>{
  if(data.type==='start') start(data.config);
  if(data.type==='pause'){paused=true;}
  if(data.type==='resume'){paused=false;schedule();}
  if(data.type==='stop'){stopped=true;paused=false;schedule();}
};
function start(c){cfg=c;paused=false;stopped=false;processed=0;found=0;pending=[];partialReason='';iterator=search();schedule();}
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
// A V17 constrói primeiro uma meta de aparições por número e depois seleciona
// cartelas válidas que realizem essa meta, em vez de testar subconjuntos aleatórios.
function* searchWithFrequency(){
  const candidates=[];
  for(const item of searchBase()){
    if(item && item.combo)candidates.push(item);
    else if(item && item.tick)yield item;
  }
  if(!candidates.length){yield {distributionError:'Nenhuma cartela passou pelos filtros individuais. Reduza ou desative alguns filtros e tente novamente.'};return;}
  const requested=cfg.targetCount;
  const wanted=requested>0?Math.min(requested,candidates.length):candidates.length;
  if(requested>0&&candidates.length<requested)partialReason=`Os filtros individuais aprovaram ${candidates.length.toLocaleString('pt-BR')} cartelas, abaixo das ${requested.toLocaleString('pt-BR')} solicitadas. O programa tentará entregar o maior conjunto que também respeite Mono–Quina.`;
  const keys=['mono','duque','terno','quadra','quina'];
  const ranges=cfg.filters.frequencyTargets;
  const constrained=keys.filter(k=>ranges[k]&&(ranges[k].min!==null||ranges[k].max!==null));
  if(cfg.targetCount===0 && wanted===candidates.length){
    const appearances=new Map();
    for(const item of candidates)for(const n of item.combo)appearances.set(n,(appearances.get(n)||0)+1);
    const hist={mono:0,duque:0,terno:0,quadra:0,quina:0};
    for(const count of appearances.values())if(count>=1&&count<=5)hist[keys[count-1]]++;
    const valid=constrained.every(k=>{const r=ranges[k];return (r.min===null||hist[k]>=r.min)&&(r.max===null||hist[k]<=r.max);});
    if(!valid){
      const detail=constrained.map(k=>`${k}: pedido ${ranges[k].min??'—'} a ${ranges[k].max??'—'}, resultado ${hist[k]}`).join(' | ');
      yield {distributionError:`Você pediu todas as ${wanted.toLocaleString('pt-BR')} cartelas válidas. A frequência global dessas cartelas é determinada pelo próprio universo e não pode ser redistribuída. Resultado encontrado: ${detail}. Reduza a quantidade desejada para permitir selecionar um subconjunto.`};return;
    }
    const labels={mono:'Mono',duque:'Duque',terno:'Terno',quadra:'Quadra',quina:'Quina'};
    self.postMessage({type:'frequencySummary',text:keys.map(k=>{const r=ranges[k];const rule=r&&(r.min!==null||r.max!==null)?` (pedido ${r.min??'—'} a ${r.max??'—'})`:'';return `${labels[k]}: ${hist[k]}${rule}`;}).join(' • ')});
    for(const item of candidates)yield item;
    return;
  }
  const availableSet=new Set();
  for(const c of candidates)for(const n of c.combo)availableSet.add(n);
  const available=[...availableSet].sort((a,b)=>a-b);
  const minHist=keys.reduce((sum,k)=>sum+(ranges[k]?.min??0),0);
  if(minHist>available.length){yield {distributionError:`Os mínimos Mono–Quina somam ${minHist}, mas só existem ${available.length} números presentes nas cartelas válidas.`};return;}

  let chosenBest=null,bestHist=null;
  let bestPartial=null,bestPartialHist=null;
  const maxAttempts=8, samplesPerRow=Math.min(16000,Math.max(4000,Math.ceil(candidates.length/200)));
  const rngState={seed:0x16a09e66};
  const rng=()=>{rngState.seed=(1664525*rngState.seed+1013904223)>>>0;return rngState.seed/4294967296;};
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  const isValidHist=hist=>constrained.every(k=>{const r=ranges[k];return (r.min===null||hist[k]>=r.min)&&(r.max===null||hist[k]<=r.max);});
  const getHist=rows=>{
    const freq=new Map();
    for(const idx of rows)for(const n of candidates[idx].combo)freq.set(n,(freq.get(n)||0)+1);
    const hist={mono:0,duque:0,terno:0,quadra:0,quina:0};
    for(const v of freq.values())if(v>=1&&v<=5)hist[keys[v-1]]++;
    return hist;
  };

  // Tenta primeiro a meta pedida. Se não houver construção, reduz gradualmente
  // a quantidade e recalcula a distribuição para cada tamanho. Assim o maior
  // conjunto válido encontrado é preservado, em vez de descartar tudo.
  const targetStep=Math.max(1,Math.ceil(wanted/100));
  for(let targetSize=wanted;targetSize>0&&!chosenBest;targetSize-=targetStep){
    if(bestPartial&&bestPartial.length>=targetSize)break;
    const slots=targetSize*cfg.pick;
    const histCounts={};
    for(let i=0;i<5;i++){
      const k=keys[i],r=ranges[k]||{min:null,max:null};
      histCounts[k]=r.min!==null?r.min:0;
    }
    const lowCount=Object.values(histCounts).reduce((a,b)=>a+b,0);
    const lowSlots=keys.reduce((sum,k,i)=>sum+histCounts[k]*(i+1),0);
    if(lowCount>available.length||lowSlots>slots)continue;
    const remainingSlots=slots-lowSlots;
    const restCount=available.length-lowCount;
    let activeCount=remainingSlots===0?0:Math.min(restCount,Math.floor(remainingSlots/6));
    if(remainingSlots>0&&activeCount<cfg.pick)continue;
    const base=activeCount?Math.floor(remainingSlots/activeCount):0;
    const extra=activeCount?remainingSlots%activeCount:0;
    if(activeCount>0&&(base<6||base>targetSize))continue;

    const attempts=targetSize===wanted?maxAttempts:2;
    for(let attempt=0;attempt<attempts&&!chosenBest;attempt++){
      const pool=shuffle(available.slice());
      const degree=new Map();let cursor=0;
      for(let f=1;f<=5;f++)for(let j=0;j<histCounts[keys[f-1]];j++)degree.set(pool[cursor++],f);
      const rest=pool.slice(cursor);
      for(let j=0;j<activeCount;j++)degree.set(rest[j],base+(j<extra?1:0));
      const desired=new Map(available.map(n=>[n,degree.get(n)||0]));
      const remaining=new Map(desired);
      const chosen=[],used=new Set();let failed=false;

      for(let row=0;row<targetSize;row++){
        const rowsLeft=targetSize-row,mandatory=new Set();
        for(const [n,v] of remaining)if(v===rowsLeft)mandatory.add(n);
        let bestIndex=-1,bestScore=-Infinity;
        const tries=Math.min(candidates.length,samplesPerRow);
        for(let t=0;t<tries;t++){
          const idx=Math.floor(rng()*candidates.length);
          if(used.has(idx))continue;
          const combo=candidates[idx].combo;
          let score=0,valid=true,mandatoryFound=0;
          for(const n of combo){
            const v=remaining.get(n)||0;
            if(v===0||v>rowsLeft){valid=false;break;}
            if(mandatory.has(n))mandatoryFound++;
            const probability=v/rowsLeft;
            score+=probability>=1?0:Math.log(probability/(1-probability));
          }
          if(!valid||mandatoryFound!==mandatory.size)continue;
          if(score>bestScore||(score===bestScore&&rng()<0.5)){bestScore=score;bestIndex=idx;}
        }
        if(bestIndex<0){
          for(let idx=0;idx<candidates.length;idx++){
            if(used.has(idx))continue;
            const combo=candidates[idx].combo;let valid=true,score=0,mandatoryFound=0;
            for(const n of combo){
              const v=remaining.get(n)||0;
              if(v===0||v>rowsLeft){valid=false;break;}
              if(mandatory.has(n))mandatoryFound++;
              const p=v/rowsLeft;score+=p>=1?0:Math.log(p/(1-p));
            }
            if(!valid||mandatoryFound!==mandatory.size)continue;
            if(score>bestScore){bestScore=score;bestIndex=idx;}
          }
        }
        if(bestIndex<0){failed=true;break;}
        used.add(bestIndex);chosen.push(bestIndex);
        for(const n of candidates[bestIndex].combo)remaining.set(n,remaining.get(n)-1);
        yield {tick:true};
      }

      if(chosen.length){
        // Verifica cada prefixo com a frequência real do conjunto, não com a
        // frequência planejada. Só guarda prefixos que cumprem todos os limites.
        const checkLengths=failed?[chosen.length]:[chosen.length];
        for(const len of checkLengths){
          const prefix=chosen.slice(0,len),hist=getHist(prefix);
          if(isValidHist(hist)&&(!bestPartial||prefix.length>bestPartial.length)){
            bestPartial=prefix;bestPartialHist=hist;
          }
        }
      }
      if(!failed&&chosen.length===targetSize){
        const hist=getHist(chosen);
        if(isValidHist(hist)){chosenBest=chosen;bestHist=hist;break;}
      }
    }
  }

  if(!chosenBest&&targetStep>1&&!bestPartial){
    // A última tentativa de tamanho mínimo evita pular soluções pequenas.
    const minimumSize=1;
    const slots=minimumSize*cfg.pick;
    const minDegree=keys.reduce((sum,k,i)=>sum+(ranges[k]?.min??0)*(i+1),0);
    if(minDegree<=slots&&minHist<=available.length){
      const freqTargets=keys.map(k=>ranges[k]||{min:null,max:null});
      if(freqTargets.every((r,i)=>r.min===null||r.min<=1)){
        // O conjunto unitário só é viável quando suas frequências reais passam nos limites.
        for(let idx=0;idx<candidates.length;idx++){const hist=getHist([idx]);if(isValidHist(hist)){chosenBest=[idx];bestHist=hist;break;}}
      }
    }
  }
  if(!chosenBest&&bestPartial){chosenBest=bestPartial;bestHist=bestPartialHist;}
  if(!chosenBest){
    const detail=constrained.map(k=>`${k}: pedido ${ranges[k].min??'—'} a ${ranges[k].max??'—'}`).join(' | ');
    yield {distributionError:`A busca aplicou primeiro os filtros individuais e depois tentou montar a frequência global, mas não encontrou um conjunto que respeite Mono–Quina. ${detail}. Não foram entregues cartelas porque isso violaria os filtros globais. Tente ajustar os intervalos Mono–Quina ou os filtros individuais.`};return;
  }
  if(cfg.mode==='sequential')chosenBest.sort((a,b)=>a-b);
  if(requested>0&&chosenBest.length<requested){
    partialReason=`Foram encontradas ${chosenBest.length.toLocaleString('pt-BR')} cartelas válidas de ${requested.toLocaleString('pt-BR')} solicitadas. Todas passaram pelos filtros individuais e o conjunto final respeita os intervalos Mono–Quina.`;
  }
  const labels={mono:'Mono',duque:'Duque',terno:'Terno',quadra:'Quadra',quina:'Quina'};
  self.postMessage({type:'frequencySummary',text:keys.map(k=>{const r=ranges[k];const rule=r&&(r.min!==null||r.max!==null)?` (pedido ${r.min??'—'} a ${r.max??'—'})`:'';return `${labels[k]}: ${bestHist[k]}${rule}`;}).join(' • ')});
  for(const idx of chosenBest)yield candidates[idx];
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
function finish(type){flush();if(type==='done'&&cfg.targetCount>0&&found<cfg.targetCount){type='partial';if(!partialReason)partialReason=`Foram encontradas ${found.toLocaleString('pt-BR')} cartelas válidas de ${cfg.targetCount.toLocaleString('pt-BR')} solicitadas. O programa entregou todas as cartelas válidas que conseguiu gerar.`;}self.postMessage({type,processed,found,requested:cfg.targetCount,reason:partialReason});}
