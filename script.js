let allNames = [];
let eligibleNames = [];
let winnerData = [];
let drawnWinners = new Set();
let isConfirming = false;
let allNamesById = [];

const STORAGE_KEY = 'lucky-draw-formal_2026';
const ITEM_HEIGHT = 90;
const REEL_COUNT = 4;

const scrollArea = document.querySelector('#scroll-area');
const dropdownButton = document.querySelector('#prize-btn');
const prizeText = dropdownButton;
const lever = document.querySelector('.lever');
const dropdownItems = document.querySelectorAll('.dropdown-item');
const specialPrizeContainer = document.querySelector('#special-prize-container');
const specialPrizeInput = document.querySelector('#special-prize-input');
const specialPrizeInput2 = document.querySelector('#special-prize-input2');
const specialPrizeDropdown2 = document.querySelector('#special-prize-dropdown2');
const specialPrizeAmountInput = document.querySelector('#special-prize-amount-input');
const specialBalanceBtn = document.querySelector('#special-balance-btn');
const specialBalanceInput = document.querySelector('#special-balance-input');
const clearAllBtn = document.querySelector('#clear-all-btn');
const cashBonusLabel = document.querySelector('#cash-bonus-label');
const stick = document.querySelector('.stick');
const winnerList = document.querySelector('#winner-list');
const fileInput = document.querySelector('#file-input');
const exportBtn = document.querySelector('#export-btn');
const showWinnersBtn = document.querySelector('#show-winners-btn');

const drawSound = document.querySelector('#draw-sound');
const winSound = document.querySelector('#win-sound');
const donSound = document.querySelector('#win-don');

const prizeAmounts = {1:30000,2:20000,3:15000,4:10000,5:8000,6:7000,7:6000,8:5000,12:3600,13:9000};
const prizeLimits = {'1':1,'2':1,'3':1,'4':1,'5':2,'6':2,'7':6,'8':6,'9':Infinity,'10':Infinity,'11':Infinity,'12':15,'13':2};

function playAudio(audio, restart=true){if(!audio)return;if(restart)audio.currentTime=0;audio.play().catch(()=>{});}
function stopAudio(audio){if(!audio)return;audio.pause();audio.currentTime=0;}
function playDon(){if(!donSound)return;const audio=new Audio(donSound.src);audio.play().catch(()=>{});}

const reels = Array.from({length:REEL_COUNT},()=>({el:document.createElement('div'),items:[],mapIndex:[],position:0,finalItemIndex:null}));
reels.forEach(reel=>{reel.el.className='reel';scrollArea.appendChild(reel.el);});

function getFullRounds(value){return ({1:15,2:12,3:12,4:12,5:12,6:12,7:12,8:12,9:9,10:12,11:12,12:9,13:12})[value]||3;}
function clearReels(){reels.forEach(reel=>{reel.el.innerHTML='';reel.items=[];reel.mapIndex=[];reel.position=0;reel.finalItemIndex=null;reel.el.style.transform='';});}
function populateReels(prizeValue){
  clearReels(); if(!eligibleNames.length)return;
  const baseLength=eligibleNames.length; const minTotal=Math.max(getFullRounds(prizeValue)*baseLength,baseLength*5);
  for(let i=0;i<minTotal;i++){
    const personIndex=i%baseLength; const digits=eligibleNames[personIndex].drawCode.split('');
    reels.forEach((reel,reelIndex)=>{const symbol=document.createElement('div');symbol.className='symbol digit-symbol';symbol.textContent=digits[reelIndex];reel.el.appendChild(symbol);reel.items.push(symbol);reel.mapIndex.push(personIndex);});
  }
}
function findDuplicates(values){const seen=new Set(),dups=new Set();values.forEach(v=>seen.has(v)?dups.add(v):seen.add(v));return [...dups];}
function resetImportedNames(){allNames=[];eligibleNames=[];allNamesById=[];clearReels();updateCounts();populateSpecialPrizeList();}

fileInput?.addEventListener('change',event=>{
  const file=event.target.files?.[0]; if(!file)return; const reader=new FileReader();
  reader.onload=e=>{try{
    stopAutoScroll(); clearReels();
    const workbook=XLSX.read(new Uint8Array(e.target.result),{type:'array'}); const sheet=workbook.Sheets[workbook.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(sheet,{header:1});
    allNames=rows.slice(1).map((row,rowIndex)=>{
      const dept=row[0]!=null?String(row[0]).trim():''; const id=row[1]!=null?String(row[1]).trim():''; const name=row[2]!=null?String(row[2]).trim():'';
      const raw=row[3]!=null?String(row[3]).trim():''; const drawCode=raw?raw.padStart(4,'0'):'';
      if(!dept||!id||!name){console.warn(`Excel 第 ${rowIndex+2} 列基本資料不完整，已略過。`);return null;}
      if(drawCode&&!/^\d{4}$/.test(drawCode)){console.warn(`工號 ${id} 的抽獎碼格式錯誤：${drawCode}`);return null;}
      return {dept,id,name,drawCode};
    }).filter(Boolean);
    allNamesById=[...allNames].sort((a,b)=>String(a.id).localeCompare(String(b.id),'zh-Hant',{numeric:true}));
    eligibleNames=allNames.filter(p=>/^\d{4}$/.test(p.drawCode));
    const duplicateIds=findDuplicates(allNames.map(p=>p.id)); if(duplicateIds.length){resetImportedNames();showListToast(`發現重複工號：${duplicateIds.join('、')}<br>請修正 Excel 後重新匯入。`);return;}
    const duplicateCodes=findDuplicates(eligibleNames.map(p=>p.drawCode)); if(duplicateCodes.length){resetImportedNames();showListToast(`發現重複抽獎碼：${duplicateCodes.join('、')}<br>請修正 Excel 後重新匯入。`);return;}
    if(!eligibleNames.length){populateSpecialPrizeList();updateCounts();showListToast('完整名單已匯入，但目前沒有任何有效的四位抽獎碼。');return;}
    const eligibleIds=new Set(eligibleNames.map(p=>p.id)); drawnWinners=new Set([...drawnWinners].filter(id=>eligibleIds.has(id)));
    populateReels(Number(dropdownButton.dataset.value)||1); startAutoScroll(); updateCounts(); populateSpecialPrizeList();
    showListToast(`名單匯入完成：完整名單 ${allNames.length} 人，具抽獎碼 ${eligibleNames.length} 人。`);
  }catch(error){console.error(error);resetImportedNames();showListToast('Excel 匯入失敗，請確認檔案格式與欄位內容。');}};
  reader.readAsArrayBuffer(file);
});

let autoScrollId=null;
function startAutoScroll(){if(autoScrollId!==null||!eligibleNames.length)return;let last=performance.now();function step(now){let delta=Math.min(now-last,50);last=now;reels.forEach(reel=>{if(!reel.items.length)return;const total=ITEM_HEIGHT*reel.items.length;reel.position+=ITEM_HEIGHT*(delta/1000);reel.el.style.transform=`translateY(-${reel.position%total}px)`;});autoScrollId=requestAnimationFrame(step);}autoScrollId=requestAnimationFrame(step);}
function stopAutoScroll(){if(autoScrollId!==null){cancelAnimationFrame(autoScrollId);autoScrollId=null;}}

dropdownItems.forEach(item=>item.addEventListener('click',e=>{e.preventDefault();const value=item.dataset.value;prizeText.textContent=item.textContent.trim();dropdownButton.dataset.value=value;specialPrizeInput.value='';specialPrizeInput.dataset.id='';specialPrizeInput2.value='';specialPrizeInput2.dataset.id='';specialBalanceInput.value='';specialPrizeAmountInput.value='';specialPrizeAmountInput.classList.remove('is-invalid');
  specialPrizeContainer.style.display=['9','10','11'].includes(value)?'block':'none';specialPrizeInput.style.display=value==='9'?'inline-block':'none';specialPrizeInput2.style.display=value==='10'?'inline-block':'none';specialPrizeAmountInput.style.display=['9','10','11'].includes(value)?'block':'none';specialBalanceBtn.style.display=value==='9'?'block':'none';specialBalanceInput.style.display='none';cashBonusLabel.style.display='none';setStickOffset(value==='9'?100:value==='10'?40:0);
}));

specialBalanceBtn?.addEventListener('click',()=>{specialBalanceInput.style.display='block';specialBalanceBtn.style.display='none';cashBonusLabel.style.display='block';});
specialPrizeAmountInput?.addEventListener('input',()=>{const v=Number(specialPrizeAmountInput.value);specialPrizeAmountInput.classList.toggle('is-invalid',Boolean(v&&v<2000));});

function populateSpecialPrizeList(){const datalist=document.querySelector('#special-prize-list');if(!datalist)return;datalist.innerHTML='';allNamesById.forEach(p=>{const o=document.createElement('option');o.value=`${p.id} - ${p.name}`;datalist.appendChild(o);});}

function bindCashBonusSearch(){if(!specialPrizeInput2||!specialPrizeDropdown2)return;specialPrizeInput2.addEventListener('input',()=>{const keyword=specialPrizeInput2.value.trim().toLowerCase();specialPrizeDropdown2.innerHTML='';if(!keyword){specialPrizeDropdown2.style.display='none';return;}const filtered=allNames.filter(p=>`${p.id} ${p.dept} ${p.name}`.toLowerCase().includes(keyword));filtered.forEach(p=>{const item=document.createElement('div');item.className='dropdown-item';item.textContent=`${p.id} - ${p.dept} - ${p.name}`;item.dataset.id=p.id;item.onclick=()=>{specialPrizeInput2.dataset.id=p.id;specialPrizeInput2.value=item.textContent;specialPrizeDropdown2.style.display='none';};specialPrizeDropdown2.appendChild(item);});specialPrizeDropdown2.style.display=filtered.length?'block':'none';});}bindCashBonusSearch();

specialPrizeInput?.addEventListener('focus',()=>buildWinnerDropdown());
function buildWinnerDropdown(){const dd=document.querySelector('#winner-dropdown');if(!dd)return;dd.innerHTML='';winnerData.slice().reverse().forEach(w=>{const b=document.createElement('button');b.type='button';b.className='list-group-item list-group-item-action';b.textContent=`${w.drawCode||'無抽獎碼'}｜${w.dept} - ${w.id} - ${w.name}`;b.onclick=()=>{specialPrizeInput.value=b.textContent;specialPrizeInput.dataset.id=w.id;dd.style.display='none';};dd.appendChild(b);});dd.style.display=winnerData.length?'block':'none';}

document.querySelectorAll('.lever .prize-btn').forEach(button=>button.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(!dropdownButton.dataset.value){showListToast('請先選擇獎項！');return;}if(isConfirming)return;if(!allNames.length){showListToast('請先匯入完整名單！');return;}if(!eligibleNames.length){showListToast('目前沒有具備有效四位抽獎碼的人員！');return;}const pv=dropdownButton.dataset.value;const drawnCount=winnerData.filter(w=>w.prize===prizeText.textContent).length;if(drawnCount>=(prizeLimits[pv]??0)){showListToast('獎項已全數抽完！');return;}if(!validateSpecialPrizeInputs(pv))return;lever?.classList.add('pull','no-glow');try{await doDraw();}finally{lever?.classList.remove('pull');}}));

function validateSpecialPrizeInputs(value){if(value==='9'){if(!specialPrizeInput.dataset.id||!Number(specialPrizeAmountInput.value)){showListToast('請先選擇分享人以及輸入分享金額。');return false;}}if(value==='10'){if(!specialPrizeInput2.dataset.id||!Number(specialPrizeAmountInput.value)){showListToast('請先選擇加碼人並輸入加碼金額。');return false;}}if(value==='11'&&!Number(specialPrizeAmountInput.value)){showListToast('請先輸入金額。');return false;}return true;}

async function doDraw(){const available=eligibleNames.filter(p=>!drawnWinners.has(p.id));if(!available.length){showListToast('所有具備抽獎碼的人都已中獎！');return;}stopAutoScroll();isConfirming=true;const winner=available[Math.floor(Math.random()*available.length)];drawnWinners.add(winner.id);const winnerIndex=eligibleNames.findIndex(p=>p.id===winner.id);const rounds=getFullRounds(Number(dropdownButton.dataset.value)||1);const durations=reels.map((_,i)=>2800+rounds*200+i*800);playAudio(drawSound);try{await Promise.all(reels.map((reel,i)=>spinReel(reel,winnerIndex,durations[i]).then(()=>{highlightReel(i);playDon();})));handleWinnerText(winner);stopAudio(drawSound);playAudio(winSound);await new Promise(r=>setTimeout(r,2000));}catch(err){console.error(err);drawnWinners.delete(winner.id);showListToast('抽獎流程發生錯誤，本次結果未記錄。');}finally{startAutoScroll();isConfirming=false;lever?.classList.remove('no-glow');}}

function spinReel(reel,targetPersonIndex,duration){return new Promise(resolve=>{const start=performance.now();const total=ITEM_HEIGHT*reel.items.length;const view=document.querySelector('.scroll-viewport').offsetHeight;const centerOffset=view/2-ITEM_HEIGHT/2;let targetIndex=reel.mapIndex.findIndex(i=>i===targetPersonIndex);if(targetIndex<0){resolve();return;}const startPosition=((reel.position%total)+total)%total;const travel=total*3+targetIndex*ITEM_HEIGHT;function animate(now){const t=Math.min((now-start)/duration,1);const eased=1-Math.pow(1-t,3);if(t>=1){const final=targetIndex*ITEM_HEIGHT-centerOffset;reel.el.style.transform=`translateY(-${final}px)`;reel.position=final;reel.finalItemIndex=targetIndex;resolve();return;}const pos=(startPosition+travel*eased)%total;reel.el.style.transform=`translateY(-${pos}px)`;reel.position=pos;requestAnimationFrame(animate);}requestAnimationFrame(animate);});}
function highlightReel(index){const reel=reels[index];reel.items.forEach(x=>x.classList.remove('winner-highlight'));if(reel.finalItemIndex!==null)reel.items[reel.finalItemIndex]?.classList.add('winner-highlight');}

function handleWinnerText(winner){const pv=dropdownButton.dataset.value;const record={dept:winner.dept,id:winner.id,name:winner.name,drawCode:winner.drawCode,prize:prizeText.textContent,prizeValue:Number(pv),drawOrder:winnerData.length,bonusSource:pv==='9'?specialPrizeInput.value.trim():'',prizeAmounts:prizeAmounts[pv]||Number(specialPrizeAmountInput.value||0),specialBonus:pv==='10'?Number(specialPrizeAmountInput.value||0):Number(specialBalanceInput.value||0),bonus2Source:pv==='10'?specialPrizeInput2.value.trim():'',balance:0};winnerData.push(record);winnerList.insertBefore(createWinnerListItem(record),winnerList.firstChild);updateCounts();saveState();}
function createWinnerListItem(r){const li=document.createElement('li');li.innerHTML=`<p>${escapeHtml(r.prize)}${r.prizeAmounts?`【金額：${Number(r.prizeAmounts).toLocaleString()}】`:''}</p><p class="winner-code">抽獎碼：${escapeHtml(r.drawCode||'')}</p><p>${escapeHtml(r.dept)} - ${escapeHtml(r.id)} - ${escapeHtml(r.name)}</p>${r.bonusSource?`<p style="color:#D64545;">【${escapeHtml(r.bonusSource)} - 幸運分享】</p>`:''}${r.bonus2Source?`<p style="color:#D64545;">【加碼來源：${escapeHtml(r.bonus2Source)}】</p>`:''}`;return li;}
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function updateCounts(){const ids=new Set(eligibleNames.map(p=>p.id));const win=[...drawnWinners].filter(id=>ids.has(id)).length;document.querySelector('#total-count').textContent=eligibleNames.length;document.querySelector('#win-count').textContent=win;document.querySelector('#remain-count').textContent=Math.max(eligibleNames.length-win,0);}

exportBtn?.addEventListener('click',()=>{if(!winnerData.length){showListToast('還沒有中獎名單可匯出！');return;}const headers=['部門','工號','姓名','抽獎碼','獎項','中獎來源','公司提供金額','加碼金額','加碼來源','轉出金額'];const rows=winnerData.map(r=>[r.dept,r.id,r.name,r.drawCode,r.prize,r.bonusSource,r.prizeAmounts,r.specialBonus,r.bonus2Source,r.balance??0]);const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'中獎名單');XLSX.writeFile(wb,'大寶2026年尾牙中獎名單.xlsx');});
showWinnersBtn?.addEventListener('click',()=>{localStorage.setItem('winnerData',JSON.stringify(winnerData));window.open('winnersData.html','_blank');});
function saveState(){localStorage.setItem(`${STORAGE_KEY}_winnerData`,JSON.stringify(winnerData));localStorage.setItem(`${STORAGE_KEY}_drawnWinners`,JSON.stringify([...drawnWinners]));}
(function restoreState(){try{const w=localStorage.getItem(`${STORAGE_KEY}_winnerData`);const d=localStorage.getItem(`${STORAGE_KEY}_drawnWinners`);if(!w||!d)return;winnerData=JSON.parse(w);drawnWinners=new Set(JSON.parse(d));winnerList.innerHTML='';winnerData.slice().reverse().forEach(r=>winnerList.appendChild(createWinnerListItem(r)));}catch(e){console.error(e);}})();
clearAllBtn?.addEventListener('click',()=>{if(!winnerData.length)return;const body=document.querySelector('#confirm-toast-body'),el=document.querySelector('#confirm-toast');body.innerHTML='<div class="text-center"><p>確定要移除所有歷史名單嗎？</p><p>刪除後無法復原！</p></div>';const toast=new bootstrap.Toast(el);toast.show();document.querySelector('#confirm-yes').onclick=()=>{winnerData=[];drawnWinners.clear();winnerList.innerHTML='';localStorage.removeItem(`${STORAGE_KEY}_winnerData`);localStorage.removeItem(`${STORAGE_KEY}_drawnWinners`);updateCounts();toast.hide();};document.querySelector('#confirm-no').onclick=()=>toast.hide();});
function showListToast(message){const body=document.querySelector('#list-toast-body'),el=document.querySelector('#list-toast');if(!body||!el)return;body.innerHTML=`<p class="m-0">${message}</p>`;new bootstrap.Toast(el).show();}
function setStickOffset(px){if(stick)stick.style.transform=`translateY(${px}px)`;}
