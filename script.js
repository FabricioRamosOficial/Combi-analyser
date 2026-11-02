const $=id=>document.getElementById(id);
const DB_NAME='CombiAnalyzerV8DB',STORE='batches';
const POOL_KEY='combiAnalyzerSelectedNumbersV10';
let selectedPool=(()=>{try{const v=JSON.parse(localStorage.getItem(POOL_KEY));return Array.isArray(v)?[...new Set(v.filter(Number.isInteger))].sort((a,b)=>a-b):null;}catch{return null;}})();
const DEFAULT_GROUP_SIZE=1000;
const state={worker:null,db:null,running:false,paused:false,processed:0,found:0,preview:[],groupSize:DEFAULT_GROUP_SIZE,saving:Promise.resolve()};
const fmt=n=>Number(n).toLocaleString('pt-BR');
function chooseBig(n,r){if(r<0||r>n)return 0n;r=Math.min(r,n-r);let x=1n;for(let i=1;i<=r;i++)x=x*BigInt(n-r+i)/BigInt(i);return x;}
function openDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB_NAME,1);q.onupgradeneeded=()=>q.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
function clearDB(){return new Promise((resolve,reject)=>{const tx=state.db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function saveBatch(results){return new Promise((resolve,reject)=>{const tx=state.db.transaction(STORE,'readwrite');tx.objectStore(STORE).add({results});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function parseList(id){const raw=$(id).value.trim();if(!raw)return[];const vals=raw.split(/[\s,;]+/).filter(Boolean).map(Number);if(vals.some(x=>!Number.isInteger(x)))throw Error(`Confira a lista do campo ${id}. Use números inteiros separados por vírgula.`);return [...new Set(vals)];}
function readConfig(){
 const min=+$('minNumber').value,max=+$('maxNumber').value,pick=+$('pickCount').value,targetCount=+$('targetCount').value;
 // O tamanho do lote é interno e não precisa ser configurado pelo utilizador.
 const groupSize=DEFAULT_GROUP_SIZE;
 const available=max-min+1;
 if(![min,max,pick,targetCount].every(Number.isInteger)||min<0||max<min||max>100000||pick<1||pick>available||targetCount<0|| (selectedPool!==null && selectedPool.length>pick))throw Error('Confira os parâmetros: intervalo válido, quantidade de números possível e combinações desejadas maior ou igual a zero.');
 const on=id=>$(id).checked, num=id=>$(id).value===''?null:+$(id).value;
 const include=parseList('includeNumbers'),exclude=parseList('excludeNumbers'),previous=parseList('previousNumbers');
 const f={
  parity:on('parityEnabled'),evenMin:num('evenMin')??0,evenMax:num('evenMax')??pick,oddMin:num('oddMin')??0,oddMax:num('oddMax')??pick,prime:on('primeEnabled'),primeMin:num('primeMin')??0,primeMax:num('primeMax')??pick,
  sum:on('sumEnabled'),sumMin:num('sumMin'),sumMax:num('sumMax'),
  consecutive:on('consecutiveEnabled'),minConsecutive:num('minConsecutive')??0,maxConsecutive:num('maxConsecutive')??(pick-1),
  low:on('lowEnabled'),lowMin:num('lowMin')??0,lowMax:num('lowMax')??pick,
  decades:on('decadeEnabled'),maxPerDecade:num('maxPerDecade')??pick,minDecades:num('minDecades')??1,maxDecades:num('maxDecades')??pick,
  ending:on('endingEnabled'),maxPerEnding:num('maxPerEnding')??pick,minDistinctEndings:num('minDistinctEndings')??1,maxDistinctEndings:num('maxDistinctEndings')??Math.min(10,pick),
  width:on('widthEnabled'),widthMin:num('widthMin'),widthMax:num('widthMax'),
  fib:on('fibEnabled'),fibMin:num('fibMin')??0,fibMax:num('fibMax')??pick,multiple:on('multipleEnabled'),multipleOf:num('multipleOf')??2,multipleMin:num('multipleMin')??0,multipleMax:num('multipleMax')??pick,
  lists:on('listsEnabled'),include,exclude,previous:on('previousEnabled'),previousNumbers:previous,repeatMin:num('repeatMin')??0,repeatMax:num('repeatMax')??pick
 };
 if(f.parity&&(![f.evenMin,f.evenMax,f.oddMin,f.oddMax].every(Number.isInteger)||f.evenMin<0||f.evenMax>pick||f.evenMin>f.evenMax||f.oddMin<0||f.oddMax>pick||f.oddMin>f.oddMax||f.evenMin+f.oddMin>pick||f.evenMax+f.oddMax<pick))throw Error('Confira os limites de pares e ímpares. Os intervalos precisam permitir completar a quantidade de números da combinação.');
 if(f.prime&&(!Number.isInteger(f.primeMin)||!Number.isInteger(f.primeMax)||f.primeMin<0||f.primeMax>pick||f.primeMin>f.primeMax))throw Error('Confira os limites de números primos.');
 if(f.sum&&f.sumMin!==null&&f.sumMax!==null&&f.sumMin>f.sumMax)throw Error('Soma mínima maior que a máxima.');
 if(f.low&&(!Number.isInteger(f.lowMin)||!Number.isInteger(f.lowMax)||f.lowMin<0||f.lowMax>pick||f.lowMin>f.lowMax))throw Error('Confira os limites de números baixos.');
 if(f.decades&&(f.maxPerDecade<1||f.minDecades<1||f.maxDecades>pick||f.minDecades>f.maxDecades))throw Error('Confira a distribuição por dezenas.');
 if(f.ending&&(f.maxPerEnding<1||f.minDistinctEndings<1||f.maxDistinctEndings>Math.min(10,pick)||f.minDistinctEndings>f.maxDistinctEndings))throw Error('Confira os limites de finais iguais.');
 if(f.width&&f.widthMin!==null&&f.widthMax!==null&&f.widthMin>f.widthMax)throw Error('Amplitude mínima maior que a máxima.');
 if(f.consecutive&&(f.minConsecutive<0||f.maxConsecutive<f.minConsecutive||f.maxConsecutive>pick-1))throw Error('Confira os limites de consecutivos.');
 if(f.fib&&(f.fibMin<0||f.fibMax>pick||f.fibMin>f.fibMax))throw Error('Confira os limites de Fibonacci.');
 if(f.multiple&&(!Number.isInteger(f.multipleOf)||f.multipleOf<2||f.multipleMin<0||f.multipleMax>pick||f.multipleMin>f.multipleMax))throw Error('Confira os limites de múltiplos.');
 if(f.previous&&(f.repeatMin<0||f.repeatMax<f.repeatMin||f.repeatMax>pick))throw Error('Confira os limites de repetição.');
 if(f.lists){if(include.length>pick)throw Error('Há mais números obrigatórios do que números por combinação.');if(include.some(n=>n<min||n>max)||exclude.some(n=>n<min||n>max))throw Error('Números obrigatórios/excluídos precisam estar dentro do intervalo.');if(include.some(n=>exclude.includes(n)))throw Error('Um número não pode ser obrigatório e excluído ao mesmo tempo.');}
 f.previousSet=previous;
 if(selectedPool!==null && selectedPool.some(n=>n<min||n>max))throw Error('Os números fixos precisam estar dentro do intervalo.');
 if(selectedPool!==null && f.lists && selectedPool.some(n=>exclude.includes(n)))throw Error('Um número fixo não pode estar na lista de números excluídos.');
 return{min,max,pick,targetCount,groupSize,numbers:null,fixedNumbers:selectedPool||[],filters:f};
}
function setStatus(s){const labels={running:'PROCESSANDO',paused:'PAUSADO',done:'CONCLUÍDO',target:'META ATINGIDA',stopped:'INTERROMPIDO',waiting:'AGUARDANDO',error:'ERRO'};$('status').className='live-status '+(s==='running'?'running':s==='paused'?'paused':'');$('status').innerHTML='<i></i> '+(labels[s]||s);}
function update(){ $('totalFound').textContent=fmt(state.found);$('totalProcessed').textContent=fmt(state.processed);$('progressText').textContent=state.target?`${Math.min(100,state.found/state.target*100).toFixed(1)}% da meta`:'Busca sem meta';$('progressFill').style.width=state.target?Math.min(100,state.found/state.target*100)+'%':'0%';$('previewCount').textContent=`${state.preview.length} resultados na prévia`;$('groupInfo').textContent=`Grupos: ${state.found?fmt(Math.ceil(state.found/state.groupSize)):'—'}`;$('exportBtn').disabled=state.found===0;}
function render(){const body=$('resultsBody');body.innerHTML=state.preview.length?state.preview.map((x,i)=>`<tr><td>${i+1}</td><td><div class="number-pills">${x.combo.map(n=>`<span class="number-pill">${n}</span>`).join('')}</div></td><td>${x.sum}</td><td>${x.even}</td><td>${x.primes}</td><td>${Math.floor(i/state.groupSize)+1}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="6">Nenhuma combinação aprovada até agora.</td></tr>';update();}
function buttons(r){$('generateBtn').disabled=r;$('pauseBtn').disabled=!r;$('stopBtn').disabled=!r;}
async function generate(){let c;try{c=readConfig();state.db||=await openDB();}catch(e){alert(e.message);return;}if(state.worker)state.worker.terminate();try{await clearDB();}catch(e){alert('Não foi possível limpar o armazenamento local: '+e.message);return;}
 Object.assign(state,{running:true,paused:false,processed:0,found:0,preview:[],groupSize:c.groupSize,saving:Promise.resolve(),target:c.targetCount});
 $('totalPossible').textContent=fmt(chooseBig((c.max-c.min+1)-c.fixedNumbers.length,c.pick-c.fixedNumbers.length));$('progressNote').textContent=c.targetCount?`Procurando até ${fmt(c.targetCount)} combinações válidas.`:'Sem meta: procurando todas as combinações válidas. Esta busca pode ser extremamente demorada.';render();buttons(true);setStatus('running');$('pauseBtn').textContent='Ⅱ Pausar';
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
async function exportCSV(){if(!state.db||!state.found)return;let writable=null,parts=[],last=0,row=0;const head='Grupo;Combinacao;Soma;Pares;Impares;Primos\n';try{if(window.showSaveFilePicker){const h=await showSaveFilePicker({suggestedName:'combi-analyzer-v8.csv',types:[{description:'CSV',accept:{'text/csv':['.csv']}}]});writable=await h.createWritable();await writable.write('\uFEFF'+head);}else parts.push('\uFEFF'+head);while(true){const page=await readPage(last,25);if(!page.length)break;let chunk='';for(const b of page){last=b.id;for(const x of b.results){chunk+=`${Math.floor(row/state.groupSize)+1};"${x.combo.join('-')}";${x.sum};${x.even};${x.combo.length-x.even};${x.primes}\n`;row++;}}if(writable)await writable.write(chunk);else parts.push(chunk);}if(writable)await writable.close();else{const a=document.createElement('a'),url=URL.createObjectURL(new Blob(parts,{type:'text/csv;charset=utf-8'}));a.href=url;a.download='combi-analyzer-v8.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}alert(`Exportação concluída: ${fmt(row)} combinações.`);}catch(e){if(writable)try{await writable.abort();}catch{}if(e.name!=='AbortError')alert('Falha na exportação: '+e.message);}}
function updatePoolSummary(){
 const summary=$('poolSummary'),clear=$('clearPoolBtn');
 if(selectedPool===null){summary.textContent='Usando todos os números do intervalo.';clear.hidden=true;return;}
 summary.textContent=`${selectedPool.length} número(s) fixo(s) em todos os jogos: ${selectedPool.slice(0,18).join(', ')}${selectedPool.length>18?'…':''}. Cada jogo terá ${$('pickCount').value} números.`;clear.hidden=false;
}
function openPicker(){
 const min=Math.max(0,Number($('minNumber').value)||0),max=Math.max(min,Number($('maxNumber').value)||90);
 const url=`selecionar.html?min=${encodeURIComponent(min)}&max=${encodeURIComponent(max)}`;
 const tab=window.open(url,'combiAnalyzerNumberPicker');
 if(!tab)alert('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente novamente.');
}
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.data?.type!=='combi-fixed-numbers')return;
 const nums=event.data.numbers;
 if(!Array.isArray(nums)||nums.some(n=>!Number.isInteger(n)))return;
 selectedPool=[...new Set(nums)].sort((a,b)=>a-b);
 localStorage.setItem(POOL_KEY,JSON.stringify(selectedPool));
 updatePoolSummary();
});
$('openPickerBtn').addEventListener('click',openPicker);
$('clearPoolBtn').addEventListener('click',()=>{selectedPool=null;localStorage.removeItem(POOL_KEY);updatePoolSummary();});
$('minNumber').addEventListener('change',()=>{if(selectedPool!==null)selectedPool=selectedPool.filter(n=>n>=+$('minNumber').value&&n<=+$('maxNumber').value);localStorage.setItem(POOL_KEY,JSON.stringify(selectedPool));updatePoolSummary();});
$('maxNumber').addEventListener('change',()=>{if(selectedPool!==null)selectedPool=selectedPool.filter(n=>n>=+$('minNumber').value&&n<=+$('maxNumber').value);localStorage.setItem(POOL_KEY,JSON.stringify(selectedPool));updatePoolSummary();});
updatePoolSummary();
$('generateBtn').addEventListener('click',generate);$('pauseBtn').addEventListener('click',()=>{if(!state.worker)return;state.paused=!state.paused;state.worker.postMessage({type:state.paused?'pause':'resume'});$('pauseBtn').textContent=state.paused?'▶ Continuar':'Ⅱ Pausar';setStatus(state.paused?'paused':'running');});$('stopBtn').addEventListener('click',()=>state.worker?.postMessage({type:'stop'}));$('exportBtn').addEventListener('click',exportCSV);
$('clearFilters').addEventListener('click',()=>{document.querySelectorAll('.filter-card .switch input').forEach(x=>x.checked=false);});
