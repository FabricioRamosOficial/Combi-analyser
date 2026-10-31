const $=id=>document.getElementById(id);
const DB_NAME='CombiAnalyzerV4DB',STORE='batches';
const state={worker:null,db:null,running:false,paused:false,processed:0,found:0,preview:[],groupSize:10000,saving:Promise.resolve()};
const fmt=n=>Number(n).toLocaleString('pt-BR');
function chooseBig(n,r){if(r<0||r>n)return 0n;r=Math.min(r,n-r);let x=1n;for(let i=1;i<=r;i++)x=x*BigInt(n-r+i)/BigInt(i);return x;}
function openDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB_NAME,1);q.onupgradeneeded=()=>q.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
function clearDB(){return new Promise((resolve,reject)=>{const tx=state.db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function saveBatch(results){return new Promise((resolve,reject)=>{const tx=state.db.transaction(STORE,'readwrite');tx.objectStore(STORE).add({results});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function parseList(id){const raw=$(id).value.trim();if(!raw)return[];const vals=raw.split(/[\s,;]+/).filter(Boolean).map(Number);if(vals.some(x=>!Number.isInteger(x)))throw Error(`Confira a lista do campo ${id}. Use números inteiros separados por vírgula.`);return [...new Set(vals)];}
function readConfig(){
 const min=+$('minNumber').value,max=+$('maxNumber').value,pick=+$('pickCount').value,targetCount=+$('targetCount').value,groupSize=+$('groupSize').value;
 if(![min,max,pick,targetCount,groupSize].every(Number.isInteger)||min<0||max<min||max>100000||pick<1||pick>max-min+1||targetCount<0||groupSize<100)throw Error('Confira os parâmetros: intervalo válido, quantidade de números possível, combinações desejadas ≥ 0 e lote ≥ 100.');
 const on=id=>$(id).checked, num=id=>$(id).value===''?null:+$(id).value;
 const include=parseList('includeNumbers'),exclude=parseList('excludeNumbers'),previous=parseList('previousNumbers');
 const f={
  parity:on('parityEnabled'),even:num('evenCount'),prime:on('primeEnabled'),primes:num('primeCount'),
  sum:on('sumEnabled'),sumMin:num('sumMin'),sumMax:num('sumMax'),
  consecutive:on('consecutiveEnabled'),maxConsecutive:num('maxConsecutive')??0,
  low:on('lowEnabled'),lowCount:num('lowCount'),
  decades:on('decadeEnabled'),maxPerDecade:num('maxPerDecade')??1,minDecades:num('minDecades')??1,
  ending:on('endingEnabled'),maxPerEnding:num('maxPerEnding')??1,
  width:on('widthEnabled'),widthMin:num('widthMin'),widthMax:num('widthMax'),
  fib:on('fibEnabled'),fibCount:num('fibCount'),multiple:on('multipleEnabled'),multipleOf:num('multipleOf')??2,multipleCount:num('multipleCount'),
  lists:on('listsEnabled'),include,exclude,previous:on('previousEnabled'),previousNumbers:previous,repeatMin:num('repeatMin')??0,repeatMax:num('repeatMax')??pick
 };
 if(f.parity&&(!Number.isInteger(f.even)||f.even<0||f.even>pick))throw Error('Quantidade de pares inválida.');
 if(f.prime&&(!Number.isInteger(f.primes)||f.primes<0||f.primes>pick))throw Error('Quantidade de primos inválida.');
 if(f.sum&&f.sumMin!==null&&f.sumMax!==null&&f.sumMin>f.sumMax)throw Error('Soma mínima maior que a máxima.');
 if(f.low&&(!Number.isInteger(f.lowCount)||f.lowCount<0||f.lowCount>pick))throw Error('Quantidade de baixos inválida.');
 if(f.decades&&(f.maxPerDecade<1||f.minDecades<1||f.minDecades>pick))throw Error('Confira a distribuição por dezenas.');
 if(f.ending&&f.maxPerEnding<1)throw Error('Máximo por final deve ser pelo menos 1.');
 if(f.width&&f.widthMin!==null&&f.widthMax!==null&&f.widthMin>f.widthMax)throw Error('Amplitude mínima maior que a máxima.');
 if(f.multiple&&(!Number.isInteger(f.multipleOf)||f.multipleOf<2||f.multipleCount<0||f.multipleCount>pick))throw Error('Confira o filtro de múltiplos.');
 if(f.previous&&(f.repeatMin<0||f.repeatMax<f.repeatMin||f.repeatMax>pick))throw Error('Confira os limites de repetição.');
 if(f.lists){if(include.length>pick)throw Error('Há mais números obrigatórios do que números por combinação.');if(include.some(n=>n<min||n>max)||exclude.some(n=>n<min||n>max))throw Error('Números obrigatórios/excluídos precisam estar dentro do intervalo.');if(include.some(n=>exclude.includes(n)))throw Error('Um número não pode ser obrigatório e excluído ao mesmo tempo.');}
 f.previousSet=previous;
 return{min,max,pick,targetCount,groupSize,filters:f};
}
function setStatus(s){const labels={running:'PROCESSANDO',paused:'PAUSADO',done:'CONCLUÍDO',target:'META ATINGIDA',stopped:'INTERROMPIDO',waiting:'AGUARDANDO',error:'ERRO'};$('status').className='live-status '+(s==='running'?'running':s==='paused'?'paused':'');$('status').innerHTML='<i></i> '+(labels[s]||s);}
function update(){ $('totalFound').textContent=fmt(state.found);$('totalProcessed').textContent=fmt(state.processed);$('progressText').textContent=state.target?`${Math.min(100,state.found/state.target*100).toFixed(1)}% da meta`:'Busca sem meta';$('progressFill').style.width=state.target?Math.min(100,state.found/state.target*100)+'%':'0%';$('previewCount').textContent=`${state.preview.length} resultados na prévia`;$('groupInfo').textContent=`Grupos: ${state.found?fmt(Math.ceil(state.found/state.groupSize)):'—'}`;$('exportBtn').disabled=state.found===0;}
function render(){const body=$('resultsBody');body.innerHTML=state.preview.length?state.preview.map((x,i)=>`<tr><td>${i+1}</td><td><div class="number-pills">${x.combo.map(n=>`<span class="number-pill">${n}</span>`).join('')}</div></td><td>${x.sum}</td><td>${x.even}</td><td>${x.primes}</td><td>${Math.floor(i/state.groupSize)+1}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="6">Nenhuma combinação aprovada até agora.</td></tr>';update();}
function buttons(r){$('generateBtn').disabled=r;$('pauseBtn').disabled=!r;$('stopBtn').disabled=!r;}
async function generate(){let c;try{c=readConfig();state.db||=await openDB();}catch(e){alert(e.message);return;}if(state.worker)state.worker.terminate();try{await clearDB();}catch(e){alert('Não foi possível limpar o armazenamento local: '+e.message);return;}
 Object.assign(state,{running:true,paused:false,processed:0,found:0,preview:[],groupSize:c.groupSize,saving:Promise.resolve(),target:c.targetCount});
 $('totalPossible').textContent=fmt(chooseBig(c.max-c.min+1,c.pick));$('progressNote').textContent=c.targetCount?`Procurando até ${fmt(c.targetCount)} combinações válidas.`:'Sem meta: procurando todas as combinações válidas. Esta busca pode ser extremamente demorada.';render();buttons(true);setStatus('running');$('pauseBtn').textContent='Ⅱ Pausar';
 state.worker=new Worker('worker.js');
 state.worker.onmessage=({data})=>{
  if(data.type==='batch'){state.saving=state.saving.then(()=>saveBatch(data.results)).catch(err=>{console.error(err);state.worker?.postMessage({type:'stop'});alert('Falha ao guardar resultados. O espaço do navegador pode estar cheio: '+err.message);});state.found=data.found;state.processed=data.processed;if(state.preview.length<100)state.preview.push(...data.results.slice(0,100-state.preview.length));update();}
  else if(data.type==='progress'){state.processed=data.processed;state.found=data.found;update();}
  else if(['done','target','stopped'].includes(data.type)){state.processed=data.processed;state.found=data.found;state.saving.then(()=>{state.running=false;state.paused=false;buttons(false);setStatus(data.type);render();state.worker?.terminate();state.worker=null;});}
  else if(data.type==='impossible'){state.running=false;buttons(false);setStatus('done');alert(data.message);}
 };
 state.worker.onerror=e=>{console.error(e);state.running=false;buttons(false);setStatus('error');alert('Erro no worker. Abra pelo Live Server ou http://localhost.');};
 state.worker.postMessage({type:'start',config:c});
}
function readPage(after=0,count=20){return new Promise((resolve,reject)=>{const tx=state.db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).openCursor(after?IDBKeyRange.lowerBound(after,true):null),out=[];req.onsuccess=()=>{const cur=req.result;if(!cur||out.length>=count){resolve(out);return;}out.push({id:cur.key,results:cur.value.results});cur.continue();};req.onerror=()=>reject(req.error);});}
async function exportCSV(){if(!state.db||!state.found)return;let writable=null,parts=[],last=0,row=0;const head='Grupo;Combinacao;Soma;Pares;Impares;Primos\n';try{if(window.showSaveFilePicker){const h=await showSaveFilePicker({suggestedName:'combi-analyzer-v4.csv',types:[{description:'CSV',accept:{'text/csv':['.csv']}}]});writable=await h.createWritable();await writable.write('\uFEFF'+head);}else parts.push('\uFEFF'+head);while(true){const page=await readPage(last,25);if(!page.length)break;let chunk='';for(const b of page){last=b.id;for(const x of b.results){chunk+=`${Math.floor(row/state.groupSize)+1};"${x.combo.join('-')}";${x.sum};${x.even};${x.combo.length-x.even};${x.primes}\n`;row++;}}if(writable)await writable.write(chunk);else parts.push(chunk);}if(writable)await writable.close();else{const a=document.createElement('a'),url=URL.createObjectURL(new Blob(parts,{type:'text/csv;charset=utf-8'}));a.href=url;a.download='combi-analyzer-v4.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}alert(`Exportação concluída: ${fmt(row)} combinações.`);}catch(e){if(writable)try{await writable.abort();}catch{}if(e.name!=='AbortError')alert('Falha na exportação: '+e.message);}}
$('generateBtn').addEventListener('click',generate);$('pauseBtn').addEventListener('click',()=>{if(!state.worker)return;state.paused=!state.paused;state.worker.postMessage({type:state.paused?'pause':'resume'});$('pauseBtn').textContent=state.paused?'▶ Continuar':'Ⅱ Pausar';setStatus(state.paused?'paused':'running');});$('stopBtn').addEventListener('click',()=>state.worker?.postMessage({type:'stop'}));$('exportBtn').addEventListener('click',exportCSV);
$('clearFilters').addEventListener('click',()=>{document.querySelectorAll('.filter-card .switch input').forEach(x=>x.checked=false);});
