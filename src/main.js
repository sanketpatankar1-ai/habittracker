import { trackerState, selectMonth } from './features/state/trackerState.js';
import { calculateDashboardAnalytics, buildMonthlyReportData, getDaysInMonth, getWeekRanges, getMonthKey as getKey, localISO, dateFor, isScheduled as scheduled, isValidLocalDate } from './features/analytics/calculations.js';

import { createCharts } from './features/analytics/charts.js';

import { parseHabits, SUGGEST } from './features/habits/habitData.js';
import { addHabitsToState, editHabitInState, archiveHabitInState, restoreHabitInState, deleteHabitFromState, reorderHabitInState, normalizeHabitName } from './features/habits/management.js';

import { createSafeStorage, isPlainObject, earliestCheckedDate, exportLocalData, importLocalData } from './features/storage/localStorage.js';

import { renderWellbeing } from './features/tracking/wellbeing.js';
import { persistCompletion } from './features/tracking/completions.js';
import { buildImagePdfBlob, buildMonthlyCsv, makePrintReadyHtml, renderMonthlyReportCanvas } from './features/exports/monthlyExports.js';
import { createSupabaseClient, loadCloudConfig } from './features/cloud/supabaseClient.js';
import { cacheTrackerSnapshot, mergeTrackerSnapshots, normalizeTrackerSnapshot, preserveTrackerSnapshot, readAccountCache, readTrackerSnapshot, trackerSnapshotHasData, writeTrackerSnapshot } from './features/cloud/trackerSync.js';
import { deleteGoal as removeGoal, goalProgress, saveGoal, setGoalActive, setGoalCompleted } from './features/goals/goalData.js';
import { selectSmartInsight } from './features/analytics/smartInsights.js';

import { THEME_DEFAULT, THEME_PALETTES, THEME_SWATCHES, validHex, normalizeTheme, paletteFor, rgbFromHex, accentForeground } from './features/themes/palette.js';







let charts=null;
let cloudClient=null,cloudUser=null,cloudReady=false,cloudHydrating=false,cloudSaveTimer=null,cloudSaveChain=Promise.resolve(),cloudRevision=0,cloudGeneration=0,accountMode='signin',recoveryMode=false;

const $=id=>document.getElementById(id);

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();



function applyTheme(t){const root=document.documentElement,p=paletteFor(t),fg=accentForeground(t.accent),rgb=rgbFromHex(t.accent);root.dataset.theme=t.appearance;root.dataset.density=t.density;

  const vars={'--bg':p.background,'--surf':p.surface,'--surface':p.surface,'--surface-secondary':`color-mix(in srgb, ${p.surface} 88%, ${p.text})`,'--tx':p.text,'--text-primary':p.text,'--mut':p.muted,'--text-secondary':p.muted,'--body-text':p.bodyText,'--body-muted':p.bodyMuted,'--line':p.border,'--border':p.border,'--chart-grid':p.border,'--accent':t.accent,'--accent-foreground':fg,'--rgb':rgb,'--inv':fg,'--glow':t.accent,'--success':t.preset==='sage'?'#557c66':'#4d9b75','--cell':`color-mix(in srgb, ${p.text} 5%, transparent)`,'--gl-top':t.appearance==='light'?'rgba(255,255,255,.4)':'rgba(255,255,255,.35)','--gl-bot':t.appearance==='light'?'rgba(255,255,255,0)':'rgba(0,0,0,.26)'};for(const [k,v]of Object.entries(vars))root.style.setProperty(k,v);

  // Styling updates do not change the analytics snapshot or recompute habit values.
  if(charts){charts.restyle();renderMentalMetrics()}}

function syncThemeControls(t){$('themePreset').value=t.preset;$('themeAppearance').value=t.appearance;$('themeAccent').value=t.accent;$('themeBackground').value=t.background;$('themeSurface').value=t.surface;$('themeDensity').value=t.density;document.querySelectorAll('.swatch').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color.toLowerCase()===t.accent.toLowerCase())))}

function paintThemeDraft(){applyTheme(trackerState.themeDraft);syncThemeControls(trackerState.themeDraft)}

function chooseThemePreset(preset){if(!THEME_PALETTES[preset])return;trackerState.themeDraft.preset=preset;const p=THEME_PALETTES[preset];trackerState.themeDraft.appearance=preset==='clean-light'||preset==='sage'?'light':'dark';trackerState.themeDraft.background=p[trackerState.themeDraft.appearance][0];trackerState.themeDraft.surface=p[trackerState.themeDraft.appearance][1];trackerState.themeDraft.accent=p[trackerState.themeDraft.appearance][5];paintThemeDraft()}

function chooseAppearance(appearance){if(!['light','dark'].includes(appearance))return;trackerState.themeDraft.appearance=appearance;const p=THEME_PALETTES[trackerState.themeDraft.preset][appearance];trackerState.themeDraft.background=p[0];trackerState.themeDraft.surface=p[1];paintThemeDraft()}

function setAccentColor(color){if(!validHex(color))return;trackerState.themeDraft.accent=color;applyTheme(trackerState.themeDraft);document.querySelectorAll('.swatch').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color.toLowerCase()===color.toLowerCase())))}

function initThemeControls(){THEME_SWATCHES.forEach(color=>{const b=document.createElement('button');b.type='button';b.className='swatch';b.dataset.color=color;b.style.backgroundColor=color;b.title=`Accent ${color}`;b.setAttribute('aria-label',`Use accent color ${color}`);b.setAttribute('aria-pressed','false');b.onclick=()=>setAccentColor(color);$('themeSwatches').appendChild(b)});

  $('themePreset').onchange=e=>chooseThemePreset(e.target.value);$('themeAppearance').onchange=e=>chooseAppearance(e.target.value);$('themeAccent').oninput=e=>setAccentColor(e.target.value);$('themeBackground').oninput=e=>{trackerState.themeDraft.background=e.target.value;applyTheme(trackerState.themeDraft)};$('themeSurface').oninput=e=>{trackerState.themeDraft.surface=e.target.value;applyTheme(trackerState.themeDraft)};$('themeDensity').onchange=e=>{trackerState.themeDraft.density=e.target.value;applyTheme(trackerState.themeDraft)};

}

function openThemeSettings(){trackerState.themeReturnFocus=document.activeElement;trackerState.themeDraft={...trackerState.themeSettings};syncThemeControls(trackerState.themeDraft);const m=$('themeModal');m.classList.add('open');m.setAttribute('aria-hidden','false');$('customizeThemeBtn').setAttribute('aria-expanded','true');setTimeout(()=>$('themePreset').focus(),0)}

function closeThemeSettings(){const m=$('themeModal');if(!m.classList.contains('open'))return;m.classList.remove('open');m.setAttribute('aria-hidden','true');$('customizeThemeBtn').setAttribute('aria-expanded','false');trackerState.themeDraft=null;applyTheme(trackerState.themeSettings);(trackerState.themeReturnFocus||$('customizeThemeBtn')).focus()}

function saveThemeSettings(){const next=normalizeTheme(trackerState.themeDraft);if(!write('ht_theme_settings',next))return;trackerState.themeSettings=next;write('ht_theme',next.appearance);closeThemeSettings()}

function resetThemeDraft(){trackerState.themeDraft={...THEME_DEFAULT};paintThemeDraft()}

function loadThemeSettings(){let legacy=null;try{legacy=localStorage.getItem('ht_theme')}catch(e){}const saved=read('ht_theme_settings',null);trackerState.themeSettings=normalizeTheme(saved,legacy);if(saved===null)write('ht_theme_settings',trackerState.themeSettings);applyTheme(trackerState.themeSettings);initThemeControls()}

function handleThemeKeys(e){if(!$('themeModal').classList.contains('open'))return;if(e.key==='Escape'){e.preventDefault();closeThemeSettings();return}if(e.key==='Tab'){const focusable=[...$('themeModal').querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled])')];if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}

window.addEventListener('keydown',handleThemeKeys);



function setFocusMode(enabled,persist=false){const next=!!enabled;if(persist&&!write('ht_focus_mode',next))return false;trackerState.focusMode=next;$('app').classList.toggle('focus-mode',trackerState.focusMode);const b=$('focusModeBtn');b.setAttribute('aria-pressed',String(trackerState.focusMode));b.querySelector('.nav-label').textContent=trackerState.focusMode?'Exit Focus':'Focus Mode';b.setAttribute('aria-label',trackerState.focusMode?'Exit Focus Mode':'Focus Mode');b.title=trackerState.focusMode?'Exit Focus mode (F)':'Focus mode shortcut: F';return true}

function toggleFocusMode(){setFocusMode(!trackerState.focusMode,true)}

function handleAppShortcuts(e){if(e.altKey||e.ctrlKey||e.metaKey)return;const tag=e.target?.tagName?.toLowerCase();if(['input','textarea','select'].includes(tag)||e.target?.isContentEditable||$('themeModal').classList.contains('open'))return;if(e.key.toLowerCase()==='f'){e.preventDefault();toggleFocusMode()}else if(e.key.toLowerCase()==='a'){e.preventDefault();focusAdd()}}

window.addEventListener('keydown',handleAppShortcuts);



function storageWarning(message){let el=$('storageWarning');if(!el){el=document.createElement('div');el.id='storageWarning';el.setAttribute('role','status');el.style.cssText='position:fixed;bottom:12px;left:12px;z-index:100;max-width:440px;padding:10px 14px;background:#8b2626;color:white;border-radius:6px';document.body.appendChild(el)}el.textContent=message;el.hidden=false}



const safeStorage=createSafeStorage(storageWarning),read=safeStorage.read,writeLocal=safeStorage.write,validObject=isPlainObject,preserveRaw=safeStorage.preserveRaw;
const CLOUD_DATA_KEYS=new Set(['ht_habits','ht_archived','ht_goals','ht_checks','ht_mood','ht_sleep','ht_notes','ht_theme','ht_theme_settings','ht_focus_mode']);
function write(key,value){const ok=writeLocal(key,value);if(ok&&cloudReady&&!cloudHydrating&&CLOUD_DATA_KEYS.has(key))queueCloudSave();return ok}

function currentTrackerSnapshot(){return normalizeTrackerSnapshot({habits:trackerState.habits,archivedHabits:trackerState.archivedHabits,goals:trackerState.goals,checksData:trackerState.checksData,moodData:trackerState.moodData,sleepData:trackerState.sleepData,notes:trackerState.notes,theme:trackerState.themeSettings?.appearance||'dark',themeSettings:trackerState.themeSettings,focusMode:trackerState.focusMode})}
function accountStatus(message){const el=$('accountStatus');if(el)el.textContent=message||''}
function setCloudIndicator(message){const el=$('cloudSyncIndicator');if(!el)return;el.textContent=message;el.title=message;el.setAttribute('aria-label',message);const value=String(message).toLowerCase();el.dataset.status=/saving|syncing/.test(value)?'busy':/saved to cloud|sync ready/.test(value)?'saved':/offline/.test(value)?'offline':/error|attention|failed/.test(value)?'error':/local only|not signed in/.test(value)?'local':'idle'}
const cloudPendingKey=userId=>`ht_cloud_pending_${String(userId).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
function updateAccountUi(message){const signedIn=!!cloudUser;$('accountSignedOutActions').hidden=signedIn;$('accountSignedInActions').hidden=!signedIn;$('accountForm').hidden=!cloudClient||signedIn&&!recoveryMode;$('accountSubmit').textContent=recoveryMode?'Set new password':accountMode==='signin'?'Sign in':'Create account';$('accountSetupHelp').hidden=!!cloudClient;$('accountEmailLabel').textContent=cloudUser?.email||'';const name=cloudUser?.user_metadata?.full_name||cloudUser?.user_metadata?.name||cloudUser?.email?.split('@')[0]||'';$('accountTitle').textContent=signedIn?'Your account':accountMode==='signup'?'Create your account':'Welcome back';$('profileLabel').textContent=signedIn?(name.length>16?`${name.slice(0,15)}…`:name):'Sign in';$('accountBtn').setAttribute('aria-label',signedIn?`Account for ${name}`:'Sign in to your account');const avatar=$('profileAvatar'),avatarUrl=cloudUser?.user_metadata?.avatar_url||cloudUser?.user_metadata?.picture||'';avatar.replaceChildren();if(avatarUrl){const image=document.createElement('img');image.src=avatarUrl;image.alt='';image.referrerPolicy='no-referrer';image.onerror=()=>{image.remove();avatar.textContent=(name||'U').trim().slice(0,1).toUpperCase()};avatar.append(image)}else avatar.textContent=signedIn?(name.trim().slice(0,1).toUpperCase()||'U'):'U';if(message)accountStatus(message);if(!cloudClient)setCloudIndicator('Local only');else if(signedIn&&!message)setCloudIndicator('Cloud sync ready');else if(!signedIn)setCloudIndicator('Not signed in')}
function openAccountDialog(){closeMoreMenu(false);updateAccountUi();const m=$('accountModal');m.classList.add('open');m.setAttribute('aria-hidden','false');$('accountBtn').setAttribute('aria-expanded','true');(recoveryMode?$('accountPassword'):cloudUser?$('accountModal').querySelector('#accountSignedInActions button'):$('accountModal').querySelector('.account-close')).focus()}
function closeAccountDialog(){const m=$('accountModal');if(!m.classList.contains('open'))return;m.classList.remove('open');m.setAttribute('aria-hidden','true');$('accountBtn').setAttribute('aria-expanded','false');$('accountBtn').focus()}
function toggleAccountMode(){accountMode=accountMode==='signin'?'signup':'signin';recoveryMode=false;$('accountPassword').autocomplete=accountMode==='signin'?'current-password':'new-password';$('accountSubmit').textContent=accountMode==='signin'?'Sign in':'Create account';$('accountModeToggle').textContent=accountMode==='signin'?'Create account':'Back to sign in';$('accountTitle').textContent=accountMode==='signup'?'Create your account':'Welcome back';$('accountForm').hidden=!cloudClient||!!cloudUser;accountStatus(accountMode==='signup'?'Use an email address you can verify and a password of at least 8 characters.':'');}

function queueCloudSave(){
  if(!cloudClient||!cloudUser||!cloudReady)return;
  const userId=cloudUser.id,generation=cloudGeneration;
  try{localStorage.setItem('ht_cloud_owner',userId);localStorage.setItem(cloudPendingKey(userId),'true')}catch{storageWarning('Could not mark the pending cloud sync in browser storage. Your recent data is still saved locally.')}
  setCloudIndicator(navigator.onLine===false?'Offline · saved on this device':'Saving…');
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>{
    const snapshot=currentTrackerSnapshot();
    try{cacheTrackerSnapshot(userId,snapshot);localStorage.setItem('ht_cloud_owner',userId);localStorage.setItem(cloudPendingKey(userId),'true')}catch{storageWarning('Cloud sync cache is full. Your recent changes remain in this browser, but cloud retry may need free storage space.')}
    cloudSaveChain=cloudSaveChain.catch(()=>{}).then(async()=>{
      if(!cloudUser||cloudUser.id!==userId||!cloudReady||cloudGeneration!==generation)return;
      if(navigator.onLine===false){setCloudIndicator('Offline · saved on this device');return}
      setCloudIndicator('Syncing…');
      try{await saveCloudSnapshot(userId,snapshot);if(stableJson(currentTrackerSnapshot())===stableJson(snapshot))localStorage.removeItem(cloudPendingKey(userId));setCloudIndicator('Saved to cloud');accountStatus('Your tracker is synced.');}
      catch(error){setCloudIndicator('Sync needs attention');accountStatus(`Saved on this device; cloud sync failed: ${error.message}`);}
    });
  },650);
}

function stableJson(value){if(Array.isArray(value))return`[${value.map(stableJson).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;return JSON.stringify(value)}
function savedRevision(result,fallback){const row=Array.isArray(result)?result[0]:null;return Number.isSafeInteger(Number(row?.revision))?Number(row.revision):fallback+1}
async function saveCloudSnapshot(userId,snapshot){
  try{const result=await cloudClient.saveTracker(userId,snapshot,cloudRevision);cloudRevision=savedRevision(result,cloudRevision);return}
  catch(error){
    if(!/revision conflict/i.test(error.message)&&error.code!=='40001'&&error.status!==409)throw error;
    const latest=await cloudClient.getTracker(userId);if(!latest)throw error;
    const merged=mergeTrackerSnapshots(snapshot,latest.data),result=await cloudClient.saveTracker(userId,merged,Number(latest.revision)||0);
    cloudRevision=savedRevision(result,Number(latest.revision)||0);await applyAccountSnapshot(userId,merged);
  }
}
async function saveAndVerifyCloud(userId,snapshot,expectedRevision){const result=await cloudClient.saveTracker(userId,snapshot,expectedRevision);cloudRevision=savedRevision(result,expectedRevision);const verified=await cloudClient.getTracker(userId);if(!verified||stableJson(normalizeTrackerSnapshot(verified.data))!==stableJson(normalizeTrackerSnapshot(snapshot)))throw new Error('Cloud verification did not match the records sent. Your browser data is still intact; retry from the account dialog.');cloudRevision=Number(verified.revision)||cloudRevision;return verified}

async function applyAccountSnapshot(userId,snapshot){
  cloudHydrating=true;
  try{writeTrackerSnapshot(snapshot,localStorage);localStorage.setItem('ht_cloud_owner',userId);cacheTrackerSnapshot(userId,snapshot);localStorage.removeItem(cloudPendingKey(userId));loadSavedData();renderNotes();if(charts){populateDateSelectors();updateCalendar()}}
  finally{cloudHydrating=false}
}

async function activateCloudAccount(session,{startup=false}={}){
  cloudGeneration++;clearTimeout(cloudSaveTimer);cloudReady=false;
  const user=session?.user||await cloudClient.getUser();if(!user?.id)throw new Error('The signed-in session did not include a user account.');
  cloudUser=user;recoveryMode=session?.type==='recovery';updateAccountUi('Loading your private cloud tracker…');
  const currentOwner=localStorage.getItem('ht_cloud_owner'),localSnapshot=currentTrackerSnapshot(),hasLocal=trackerSnapshotHasData(localSnapshot),sameAccount=currentOwner===user.id;
  const cached=readAccountCache(user.id),hasPending=localStorage.getItem(cloudPendingKey(user.id))==='true',hasOwnCachedData=hasPending&&trackerSnapshotHasData(cached);
  const remoteRow=await cloudClient.getTracker(user.id);let chosen=remoteRow?normalizeTrackerSnapshot(remoteRow.data):normalizeTrackerSnapshot({});
  cloudRevision=Number(remoteRow?.revision)||0;
  let localCandidate=hasPending&&(trackerSnapshotHasData(cached)||sameAccount&&hasLocal)?mergeTrackerSnapshots(cached,sameAccount?localSnapshot:{}):(!currentOwner&&hasLocal?localSnapshot:null);
  if(!remoteRow&&sameAccount&&trackerSnapshotHasData(cached))localCandidate=cached;
  if(!remoteRow&&sameAccount&&trackerSnapshotHasData(cached)&&!hasPending&&!confirm('The cloud tracker is missing, but a saved account recovery copy exists on this device. Restore that copy to the cloud?'))localCandidate=null;
  if(localCandidate){
    let importLocal=sameAccount||hasOwnCachedData;
    if(!sameAccount){const promptText=remoteRow?'Import this browser’s existing habits and historical records into this account? Records with the same IDs merge; cloud habit settings win conflicts. Your browser data will be backed up first.':'Import this browser’s existing habits, historical records, and preferences into your new cloud account? The original browser records will be backed up and retained.';importLocal=confirm(promptText)}
    if(importLocal)chosen=mergeTrackerSnapshots(localCandidate,chosen);else localCandidate=null;
  }
  const needsWrite=!remoteRow||!!localCandidate&&(!sameAccount||hasPending||stableJson(chosen)!==stableJson(normalizeTrackerSnapshot(remoteRow.data)));
  if(needsWrite){
    if(!sameAccount&&hasLocal)preserveTrackerSnapshot(localStorage);
    const verified=await saveAndVerifyCloud(user.id,chosen,cloudRevision);cloudRevision=Number(verified.revision)||cloudRevision;
  }else if(!sameAccount&&hasLocal)preserveTrackerSnapshot(localStorage);
  await applyAccountSnapshot(user.id,chosen);cloudReady=true;recoveryMode=session?.type==='recovery';updateAccountUi(recoveryMode?'Set a new password below.':'Signed in. Your cloud tracker is ready.');setCloudIndicator('Saved to cloud');
}

async function configureCloud(){
  try{const config=await loadCloudConfig();if(!config.configured){cloudClient=null;updateAccountUi('');return null}cloudClient=createSupabaseClient(config);cloudClient.consumeRecoveryRedirect();updateAccountUi('Sign in or create an account to enable cloud sync.');setCloudIndicator('Not signed in');return cloudClient}
  catch(error){cloudClient=null;$('accountSetupHelp').hidden=false;accountStatus(`Cloud setup could not be loaded: ${error.message}`);setCloudIndicator('Cloud setup error');return null}
}

async function submitAccountForm(event){
  event.preventDefault();if(!cloudClient)return;
  const button=$('accountSubmit'),email=$('accountEmail').value.trim(),password=$('accountPassword').value;button.disabled=true;accountStatus('Contacting the secure account provider…');
  try{
    if(recoveryMode){await cloudClient.updatePassword(password);recoveryMode=false;accountMode='signin';$('accountPassword').value='';updateAccountUi('Password updated. Your account is signed in.');return}
    if(accountMode==='signup'){
      const created=await cloudClient.signUp(email,password);
      if(!created.session){accountStatus('Check your email for the verification link, then return here to sign in.');return}
      await activateCloudAccount(created.session);accountMode='signin';$('accountModeToggle').textContent='Create account';closeAccountDialog();return;
    }
    await activateCloudAccount(await cloudClient.signIn(email,password));closeAccountDialog();
  }catch(error){if(cloudUser&&!cloudReady){cloudUser=null;try{await cloudClient.signOut()}catch{}}accountStatus(error.message||'Account request failed. Check your connection and try again.')}finally{button.disabled=false;updateAccountUi($('accountStatus').textContent)}
}

async function sendPasswordReset(){if(!cloudClient){accountStatus('Set up Supabase before requesting a password reset.');return}try{await cloudClient.requestPasswordReset($('accountEmail').value.trim());accountStatus('If the account exists, a password reset link will arrive by email.')}catch(error){accountStatus(error.message)}}

async function signOutAccount(){if(!cloudUser)return;const oldUser=cloudUser;cloudGeneration++;try{cacheTrackerSnapshot(oldUser.id,currentTrackerSnapshot())}catch{}cloudReady=false;clearTimeout(cloudSaveTimer);try{await cloudClient.signOut()}catch(error){accountStatus(`Signed out on this device. Provider sign-out could not be reached: ${error.message}`)}cloudUser=null;accountMode='signin';recoveryMode=false;$('accountPassword').value='';$('accountSubmit').textContent='Sign in';$('accountModeToggle').textContent='Create account';cloudHydrating=true;try{writeTrackerSnapshot({habits:[],archivedHabits:[],goals:[],checksData:{},moodData:{},sleepData:{},notes:[],theme:'dark',themeSettings:null,focusMode:false},localStorage);localStorage.removeItem('ht_cloud_owner');loadSavedData();renderNotes();if(charts){populateDateSelectors();updateCalendar()}}finally{cloudHydrating=false}updateAccountUi('Signed out. This account’s local recovery cache is kept on this device.');setCloudIndicator('Not signed in')}

window.addEventListener('online',()=>{if(cloudUser&&cloudReady)queueCloudSave()});

function populateDateSelectors(){const ys=$('yearSelect'),ms=$('monthSelect'),today=new Date();ys.innerHTML='';for(let y=Math.min(today.getFullYear()-100,trackerState.year-2);y<=Math.max(today.getFullYear()+100,trackerState.year+2);y++){const o=document.createElement('option');o.value=y;o.textContent=y;ys.appendChild(o)}ys.value=trackerState.year;ms.value=trackerState.month}



function loadSavedData(){
  loadThemeSettings();
  setFocusMode(read('ht_focus_mode',false)===true,false);
  const rawHabits=read('ht_habits',[]),hasValidHabits=Array.isArray(rawHabits);
  if(!hasValidHabits){preserveRaw('ht_habits');storageWarning('Saved habits could not be validated. A recovery copy was kept.');trackerState.habits=[]}
  else{
    const validHabits=rawHabits.filter(x=>validObject(x)&&x.id&&typeof x.title==='string'&&x.title.trim());
    const malformedFields=validHabits.some(x=>(x.startDate&&!isValidLocalDate(x.startDate))||(x.scheduleStartDate&&!isValidLocalDate(x.scheduleStartDate))||(Array.isArray(x.schedule)&&x.schedule.some(day=>!Number.isInteger(day)||day<0||day>6))||(x.scheduleHistory&&!Array.isArray(x.scheduleHistory)));
    if(validHabits.length!==rawHabits.length||malformedFields)preserveRaw('ht_habits');
    trackerState.habits=validHabits.map(x=>({...x,emoji:x.emoji||'📌',schedule:Array.isArray(x.schedule)?[...new Set(x.schedule.filter(day=>Number.isInteger(day)&&day>=0&&day<=6))]:[0,1,2,3,4,5,6],scheduleHistory:Array.isArray(x.scheduleHistory)?x.scheduleHistory.filter(p=>isValidLocalDate(p.startDate)&&isValidLocalDate(p.endDate)&&Array.isArray(p.schedule)):[],startDate:isValidLocalDate(x.startDate)?x.startDate:'0001-01-01'}));
  }
  const rawArchived=read('ht_archived',[]);
  if(!Array.isArray(rawArchived)){preserveRaw('ht_archived');storageWarning('Archived habit data is invalid. A recovery copy was kept.');trackerState.archivedHabits=[]}
  else{trackerState.archivedHabits=rawArchived.filter(x=>validObject(x)&&x.id&&typeof x.title==='string');if(trackerState.archivedHabits.length!==rawArchived.length)preserveRaw('ht_archived')}
  const rawGoals=read('ht_goals',[]);
  if(!Array.isArray(rawGoals)){preserveRaw('ht_goals');storageWarning('Saved goals are invalid. A recovery copy was kept.');trackerState.goals=[]}
  else{trackerState.goals=rawGoals.filter(goal=>validObject(goal)&&typeof goal.id==='string'&&typeof goal.title==='string'&&goal.title.trim()&&isValidLocalDate(goal.targetDate)&&['habit','manual'].includes(goal.type)&&Number.isInteger(Number(goal.targetCount))&&Number(goal.targetCount)>0);if(trackerState.goals.length!==rawGoals.length)preserveRaw('ht_goals')}
  trackerState.checksData=read('ht_checks',{});let invalidChecks=!validObject(trackerState.checksData);
  if(invalidChecks)trackerState.checksData={};
  else for(const[key,month]of Object.entries(trackerState.checksData)){
    if(!/^\d{1,4}-(?:[0-9]|1[01])$/.test(key)||!validObject(month)){trackerState.checksData[key]={};invalidChecks=true;continue}
    for(const[id,log]of Object.entries(month)){
      if(!validObject(log)){delete month[id];invalidChecks=true;continue}
      for(const[day,value]of Object.entries(log))if(!/^\d+$/.test(day)||Number(day)<1||Number(day)>31||typeof value!=='boolean')invalidChecks=true;
    }
  }
  if(invalidChecks){preserveRaw('ht_checks');storageWarning('Some completion records were invalid. A recovery copy was kept before invalid entries were skipped.')}
  const loadWellbeing=(key)=>{
    const value=read(key,{});let invalid=!validObject(value);
    if(invalid){preserveRaw(key);storageWarning(`Saved ${key==='ht_mood'?'mood':'sleep'} data is invalid. A recovery copy was kept.`);return{}}
    for(const[monthKey,month]of Object.entries(value)){
      if(!/^\d{1,4}-(?:[0-9]|1[01])$/.test(monthKey)||!validObject(month)){value[monthKey]={};invalid=true;continue}
      for(const[day,entry]of Object.entries(month)){
        const number=Number(entry),minimum=key==='ht_mood'?1:0,maximum=key==='ht_mood'?5:24;
        if(entry!==''&&(!Number.isInteger(Number(day))||Number(day)<1||Number(day)>31||!Number.isFinite(number)||number<minimum||number>maximum)){delete month[day];invalid=true}
      }
    }
    if(invalid){preserveRaw(key);storageWarning(`Some saved ${key==='ht_mood'?'mood':'sleep'} entries were invalid. A recovery copy was kept before invalid entries were skipped.`)}
    return value;
  };
  trackerState.moodData=loadWellbeing('ht_mood');trackerState.sleepData=loadWellbeing('ht_sleep');
  const rawNotes=read('ht_notes',[]);
  if(!Array.isArray(rawNotes)){preserveRaw('ht_notes');storageWarning('Saved notes are invalid. A recovery copy was kept.');trackerState.notes=[]}
  else{trackerState.notes=rawNotes.filter(x=>validObject(x)&&typeof x.text==='string');if(trackerState.notes.length!==rawNotes.length)preserveRaw('ht_notes')}
  let startDatesAdjusted=false;
  for(const h of [...trackerState.habits,...trackerState.archivedHabits]){const first=earliestCheckedDate(h.id,trackerState.checksData);if(first&&first<(h.startDate||'0001-01-01')){h.startDate=first;startDatesAdjusted=true}}
  if(startDatesAdjusted||hasValidHabits&&rawHabits.some(x=>validObject(x)&&(!Array.isArray(x.schedule)||!isValidLocalDate(x.startDate))))saveHabits();
  if(startDatesAdjusted)write('ht_archived',trackerState.archivedHabits);
  if(read('ht_schema_version',null)===null)write('ht_schema_version',2);
}

const saveHabits=()=>write('ht_habits',trackerState.habits);
const cloneRecords=(records)=>JSON.parse(JSON.stringify(records));
function persistHabitLists(previousHabits,previousArchived){
  if(!write('ht_habits',trackerState.habits)||!write('ht_archived',trackerState.archivedHabits)){
    trackerState.habits=previousHabits;trackerState.archivedHabits=previousArchived;
    // Best effort rollback if one side of the two-key move could not be stored.
    write('ht_habits',previousHabits);write('ht_archived',previousArchived);
    return false;
  }
  return true;
}

function saveChecks(){write('ht_checks',trackerState.checksData);write('ht_mood',trackerState.moodData);write('ht_sleep',trackerState.sleepData)}



const isT=d=>{const t=new Date();return t.getFullYear()===trackerState.year&&t.getMonth()===trackerState.month&&t.getDate()===d};

const isFuture=d=>dateFor(trackerState.year,trackerState.month,d)>dateFor(new Date().getFullYear(),new Date().getMonth(),new Date().getDate());

function goToday(){const t=new Date();selectMonth(trackerState,t.getFullYear(),t.getMonth());populateDateSelectors();updateCalendar()}

function shiftMonth(delta){const d=new Date(trackerState.year,trackerState.month+delta,1);selectMonth(trackerState,d.getFullYear(),d.getMonth());populateDateSelectors();updateCalendar()}

function closeCalendar(restoreFocus=false){const pop=$('calendarPop');if(pop.hidden)return;pop.hidden=true;$('calendarBtn').setAttribute('aria-expanded','false');if(restoreFocus)$('calendarBtn').focus()}

function toggleCalendar(event){if(event)event.stopPropagation();const pop=$('calendarPop'),open=pop.hidden;if(open){document.querySelector('.more-menu').open=false;if($('notePop').classList.contains('open')){$('notePop').classList.remove('open');$('noteBtn').setAttribute('aria-expanded','false')}populateDateSelectors()}pop.hidden=!open;$('calendarBtn').setAttribute('aria-expanded',String(open));if(open)setTimeout(()=>$('monthSelect').focus(),0)}

function closeMoreMenu(restoreFocus=true){const menu=document.querySelector('.more-menu');if(!menu.open)return;menu.open=false;if(restoreFocus)document.querySelector('.more-trigger').focus()}

function updateCalendar(){

  if(!selectMonth(trackerState,+$('yearSelect').value,+$('monthSelect').value))return;

  renderTableHeaders();renderTableBody();renderMentalMetrics();recalculateStatsAndCharts();renderChips();

}

function renderTableHeaders(){

  const n=getDaysInMonth(trackerState.year,trackerState.month),names=['Su','Mo','Tu','We','Th','Fr','Sa'];

  const weeks=getWeekRanges(trackerState.year,trackerState.month);

  $('hr1').innerHTML='<th class="nm">Habits</th>'+weeks.map((week,index)=>`<th colspan="${week.end-week.start+1}" class="wk">Week ${index+1}</th>`).join('')+(n<31?`<th colspan="${31-n}" class="wk empty-days" aria-hidden="true"></th>`:'')+'<th colspan="2" class="wk">This month</th>';


  let a=`<th class="nm">${trackerState.habits.length} habits</th>`,b='<th class="nm"></th>';

  for(let d=1;d<=31;d++){

    if(d<=n){a+=`<th>${names[new Date(trackerState.year,trackerState.month,d).getDay()]}</th>`;b+=`<th${isT(d)?' class="today-head" title="Today"':''}>${d}</th>`}

    else{a+='<th></th>';b+='<th></th>'}

  }

  a+='<th class="wk month-done-head">Done</th><th class="month-rate-head" title="Completion rate for eligible scheduled dates through today. For example, 1/1 is 100% to date; future dates are excluded.">To date</th>';b+='<th class="wk month-done-head"></th><th class="month-rate-head"></th>';

  $('hr2').innerHTML=a;$('hr3').innerHTML=b;

}

function renderTableBody(){

  const tb=$('habitsTableBody'),n=getDaysInMonth(trackerState.year,trackerState.month),mk=getKey(trackerState.year,trackerState.month);

  tb.innerHTML='';

  if(!validObject(trackerState.checksData[mk]))trackerState.checksData[mk]={};

  trackerState.habits.forEach(h=>{

    if(!validObject(trackerState.checksData[mk][h.id]))trackerState.checksData[mk][h.id]={};

    const tr=document.createElement('tr');

    tr.innerHTML=`<td class="nm"><div class="hn"><span title="${esc(h.title)}"><em>${esc(h.emoji)}</em>&nbsp; ${esc(h.title)}</span><button aria-label="Move ${esc(h.title)} up" title="Move up" ${trackerState.habits.indexOf(h)===0?'disabled':''} onclick="reorderHabit('${h.id}',-1)">↑</button><button aria-label="Move ${esc(h.title)} down" title="Move down" ${trackerState.habits.indexOf(h)===trackerState.habits.length-1?'disabled':''} onclick="reorderHabit('${h.id}',1)">↓</button><button aria-label="Edit ${esc(h.title)}" title="Edit habit" onclick="editHabit('${h.id}')">✎</button><button aria-label="Archive ${esc(h.title)}" title="Archive habit" onclick="archiveHabit('${h.id}')">⇩</button><button aria-label="Delete ${esc(h.title)}" title="Delete habit" onclick="deleteHabit('${h.id}')">&times;</button></div></td>`;

    for(let d=1;d<=31;d++){

      const td=document.createElement('td');

      if(d<=n){

        const c=document.createElement('input');c.type='checkbox';c.className='chk';c.checked=trackerState.checksData[mk][h.id][d]===true;const date=dateFor(trackerState.year,trackerState.month,d),future=isFuture(d),beforeStart=localISO(date)<(isValidLocalDate(h.startDate)?h.startDate:'0001-01-01'),isScheduled=scheduled(h,date);c.disabled=!isScheduled;if(!isScheduled)td.classList.add('off');else if(future)td.classList.add('future');

        const dateNotes=[];if(beforeStart)dateNotes.push('before tracking start; checking this date moves the start date back');if(!isScheduled)dateNotes.push('rest day; not scheduled');if(future)dateNotes.push('future date; saved but excluded from progress until that date');
        const dateNote=dateNotes.join('; ');c.setAttribute('aria-label',`${h.title}, day ${d}${dateNote?`, ${dateNote}`:''}`);if(dateNote)c.title=dateNote.charAt(0).toUpperCase()+dateNote.slice(1)+'.';

        c.onchange=e=>toggleCheck(h.id,d,e.target.checked,e.target);

        td.appendChild(c);if(isT(d))td.classList.add('today');

      }else td.className='off';

      tr.appendChild(td);

    }

    tr.insertAdjacentHTML('beforeend',`<td class="wk dn" id="d_${h.id}"></td><td class="rt" id="r_${h.id}"></td>`);

    tb.appendChild(tr);

  });

  if(!trackerState.habits.length){const tr=document.createElement('tr');tr.innerHTML='<td colspan="34" class="sub" style="text-align:left;padding:16px">No habits yet. Add one below to start tracking. Your tracker will stay empty until you choose a habit.</td>';tb.appendChild(tr)}

}

function toggleCheck(id,day,v,checkbox){

  const mk=getKey(trackerState.year,trackerState.month);

  const habit=trackerState.habits.find(h=>h.id===id),date=localISO(dateFor(trackerState.year,trackerState.month,day));
  const previousStartDate=habit?.startDate,previousMonth=trackerState.checksData[mk],previousHabitChecks=previousMonth?.[id],hadPrevious=!!previousHabitChecks&&Object.hasOwn(previousHabitChecks,day),previousValue=previousHabitChecks?.[day];
  if(!persistCompletion(trackerState.checksData,mk,id,day,v,value=>write('ht_checks',value))){
    if(checkbox)checkbox.checked=trackerState.checksData[mk]?.[id]?.[day]===true;
    storageWarning('This completion could not be saved. The checkbox was restored to its previous saved state.');
    recalculateStatsAndCharts();return;
  }
  if(v&&habit&&date<(habit.startDate||'0001-01-01')){
    habit.startDate=date;
    if(!saveHabits()){
      habit.startDate=previousStartDate;
      if(hadPrevious)trackerState.checksData[mk][id][day]=previousValue;
      else delete trackerState.checksData[mk][id][day];
      write('ht_checks',trackerState.checksData);
      if(checkbox)checkbox.checked=previousValue===true;
      recalculateStatsAndCharts();return;
    }
  }
  recalculateStatsAndCharts();

}

function renderMentalMetrics(){renderWellbeing({year:trackerState.year,month:trackerState.month,moodData:trackerState.moodData,sleepData:trackerState.sleepData,save:()=>{saveChecks();recalculateStatsAndCharts()},css,warn:storageWarning,$})}

function monthlyReportData(year=trackerState.year,month=trackerState.month){return buildMonthlyReportData({habits:trackerState.habits,archivedHabits:trackerState.archivedHabits,checksData:trackerState.checksData,moodData:trackerState.moodData,sleepData:trackerState.sleepData,year,month,now:new Date()})}

function buildMonthlyReportHtml(r){

  const gradeTone=r.grade.mark==='A+'||r.grade.mark==='A'?'great':r.grade.mark==='N/A'?'none':'grade';

  const pct=v=>v===null?'—':`${v}%`,bar=v=>v===null?'0%':`${v}%`;

  const habitsHtml=r.rows.length?r.rows.map(h=>`<tr><td><span class="habit-icon">${esc(h.emoji)}</span><strong>${esc(h.title)}</strong>${h.category?`<small>${esc(h.category)}</small>`:''}</td><td>${h.done} / ${h.goal}</td><td>${h.missed}</td><td><div class="track"><i style="width:${bar(h.percent)}"></i></div><span class="percent">${pct(h.percent)}</span></td><td><b class="mini-grade">${h.grade.mark}</b></td></tr>`).join(''):'<tr><td colspan="5" class="empty">No habits are available for this month yet.</td></tr>';

  const report=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.monthLabel)} Habit Progress Report</title><style>

*{box-sizing:border-box}body{margin:0;padding:40px 18px;background:#f3f5f7;color:#20252c;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.report{max-width:900px;margin:auto;background:#fff;border:1px solid #d7dce2;border-radius:16px;padding:34px;box-shadow:0 14px 44px #11131812}header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}h1{font-size:28px;line-height:1.15;margin:0 0 6px;letter-spacing:-.03em}.muted{color:#5b6470}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:700;color:#667080}.print{border:0;border-radius:8px;background:#364152;color:white;padding:10px 14px;font:inherit;font-weight:650;cursor:pointer}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:26px 0}.card{padding:16px;border:1px solid #dfe3e8;border-radius:11px;background:#fafbfc}.card span{display:block;font-size:12px;color:#5b6470}.card strong{display:block;margin-top:3px;font-size:25px;line-height:1.15}.grade-card{background:#f3f0ff;border-color:#ded5fa}.grade-card strong{color:#6046a7}.grade-card.great{background:#edf7f0;border-color:#cde5d4}.grade-card.great strong{color:#287249}.grade-card.none{background:#f3f5f7}.progress-line{height:10px;border-radius:10px;background:#e6e9ed;overflow:hidden;margin-top:12px}.progress-line i,.track i{display:block;height:100%;border-radius:inherit;background:#557c66}h2{font-size:17px;margin:27px 0 10px}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px}td{overflow-wrap:anywhere}th{text-align:left;color:#5b6470;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}td,th{padding:11px 8px;border-bottom:1px solid #e6e9ed}td:first-child{width:34%}td:first-child small{display:block;color:#69727e;margin-left:26px}.habit-icon{display:inline-block;width:22px}.track{display:inline-block;vertical-align:middle;width:min(100px,55%);height:7px;border-radius:9px;background:#e6e9ed;overflow:hidden;margin-right:7px}.track i{background:#557c66}.percent{color:#5b6470}.mini-grade{display:inline-block;min-width:34px;padding:3px 7px;background:#f0f2f5;border-radius:6px;text-align:center}.empty{text-align:center;color:#5b6470;padding:24px}.notes{margin-top:23px;padding:14px 16px;border-radius:10px;background:#f6f7f9;color:#515b67;font-size:13px}.notes p{margin:4px 0}.footer{margin-top:26px;padding-top:14px;border-top:1px solid #e6e9ed;color:#69727e;font-size:11px}@media(max-width:620px){body{padding:12px 8px}.report{padding:20px 14px}.summary{grid-template-columns:repeat(2,1fr)}header{align-items:flex-start}h1{font-size:23px}table{font-size:11px}td,th{padding:9px 4px}.track{width:42px}}@media print{body{padding:0;background:#fff}.report{max-width:none;border:0;border-radius:0;box-shadow:none;padding:0}.print{display:none}.summary{break-inside:avoid}tr{break-inside:avoid}}

</style></head><body><main class="report"><header><div><div class="eyebrow">Habit Tracker · Monthly Report</div><h1>${esc(r.monthLabel)}</h1><p class="muted">${r.endDay?`Progress through ${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(dateFor(r.year,r.month,r.endDay))}`:'No days in this month have occurred yet.'}</p></div><button class="print" onclick="window.print()">Print / Save as PDF</button></header>

<section class="summary"><div class="card"><span>Progress</span><strong>${pct(r.percent)}</strong><div class="progress-line"><i style="width:${bar(r.percent)}"></i></div></div><div class="card"><span>Completed</span><strong>${r.done}</strong></div><div class="card"><span>Scheduled goal</span><strong>${r.goal}</strong></div><div class="card grade-card ${gradeTone}"><span>Monthly mark</span><strong>${r.grade.mark}</strong><span>${esc(r.grade.label)}</span></div></section>

<h2>Habit breakdown</h2><table><thead><tr><th>Habit</th><th>Done / goal</th><th>Missed</th><th>Progress</th><th>Mark</th></tr></thead><tbody>${habitsHtml}</tbody></table>

<h2>Wellbeing logs</h2><p class="muted">${r.moodAverage===null?'Mood: no valid ratings':`Average mood: ${r.moodAverage.toFixed(1)} / 5`} &nbsp;·&nbsp; ${r.sleepAverage===null?'Sleep: no valid entries':`Average sleep: ${r.sleepAverage.toFixed(1)} hours`}</p>

<aside class="notes"><strong>How this report is scored</strong><p>Progress = completed scheduled habit-days ÷ eligible scheduled habit-days. Only dates on or before the report cutoff count; future dates and rest days are excluded. Missed = scheduled goal minus completed.</p><p>Marks: A+ 95–100%, A 90–94%, B 80–89%, C 70–79%, D 60–69%, F below 60%. A month with no eligible days receives N/A.</p></aside><div class="footer">Generated ${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'long'}).format(new Date()))}. Mood and sleep averages include valid recorded values only and are descriptive summaries.</div></main></body></html>`;

  return report;

}

function downloadMonthlyReport(){closeDownloadReports();try{const r=monthlyReportData(),blob=new Blob([buildMonthlyReportHtml(r)],{type:'text/html;charset=utf-8'});downloadBlob(blob,`habit-report-${r.year}-${String(r.month+1).padStart(2,'0')}.html`)}catch{storageWarning('Could not create the monthly report download in this browser.')}}

function openDownloadReports(){const modal=$('downloadReportsModal');if(!modal)return;modal.classList.add('open');modal.setAttribute('aria-hidden','false');$('downloadReportsBtn')?.setAttribute('aria-expanded','true');modal.querySelector('button')?.focus()}
function closeDownloadReports(){const modal=$('downloadReportsModal');if(!modal)return;modal.classList.remove('open');modal.setAttribute('aria-hidden','true');$('downloadReportsBtn')?.setAttribute('aria-expanded','false');$('downloadReportsBtn')?.focus()}

function printMonthlyReport(){
  try{
    const r=monthlyReportData(),html=makePrintReadyHtml(buildMonthlyReportHtml(r));
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})),reportWindow=window.open(url,'_blank');
    if(!reportWindow){URL.revokeObjectURL(url);storageWarning('Allow pop-ups to open the print-ready report, then choose Save as PDF.');return false}
    setTimeout(()=>URL.revokeObjectURL(url),60000);return true;
  }catch{storageWarning('Could not prepare the monthly PDF report in this browser.');return false}
}

function recalculateStatsAndCharts(){

  const a=calculateDashboardAnalytics({habits:trackerState.habits,checksData:trackerState.checksData,sleepData:trackerState.sleepData,year:trackerState.year,month:trackerState.month,now:new Date()});

  $('statGoal').textContent=a.monthGoal;$('statCompleted').textContent=a.done;$('statPlanned').textContent=a.planned;$('statLeft').textContent=a.remaining;$('donutPercent').textContent=Math.round(a.overallPercent)+'%';$('donutSub').textContent=a.monthGoal?`${a.done} done · ${a.planned} planned`:'No eligible scheduled habits';

  $('statGoal').title='All eligible scheduled habit-days in this month';$('statCompleted').title='Completed scheduled days through today';$('statPlanned').title='Future scheduled days explicitly checked in advance';$('statLeft').title='Eligible scheduled days neither completed nor planned';

  $('avgDailyRate').textContent='Avg '+Math.round(a.averageDailyRate)+'%';

  charts?.update({dailyBars:a.dailyBars,dailyAverage:a.dailyAverage,dailyDone:a.dailyDone,dailyGoal:a.dailyGoal,dailyPlannedDone:a.dailyPlannedDone,dailyPlannedGoal:a.dailyPlannedGoal,plannedDays:a.plannedDays,weekly:a.weekly,overallPercent:a.overallPercent});renderAnalysisTable(a.habitStats);renderGoalFeatures();

}

function renderAnalysisTable(st){

  st.forEach(x=>{

    const d=$('d_'+x.id),r=$('r_'+x.id);if(!d)return;

    d.innerHTML=`<b>${x.actual}</b>/${x.goal}<span class="sub" title="Current streak ${x.currentStreak} days; best ${x.bestStreak} days"> · ${x.currentStreak}d</span>`;
    d.title=`${x.actual} completed out of ${x.goal} eligible scheduled day${x.goal===1?'':'s'} through today. Earlier dates before this habit started are excluded.`;

    const displayRate=Math.round(x.percentage);

    r.innerHTML=`<span class="bar"><i style="width:${x.percentage}%"></i></span><span class="pc">${x.goal?`${displayRate}%`:'—'}</span>`;
    r.title=x.goal?`${x.actual}/${x.goal} eligible days completed through today (${displayRate}% to date).`:'No eligible days through today.';

  });

}

function renderGoalFeatures(){
  const active=trackerState.goals.find(goal=>goal.isActive&&goal.status!=='completed')||trackerState.goals.find(goal=>goal.status!=='completed');
  const summary=$('goalSummary');
  if(!active){summary.innerHTML=`<p class="goal-empty">${trackerState.goals.length?'No active goal yet.':'Set one personal target to keep your progress in view.'}</p><button class="goal-link" type="button" onclick="openGoalManager()">${trackerState.goals.length?'Choose a goal':'Create a goal'}</button>`}
  else{
    const progress=goalProgress(active,{habits:trackerState.habits,checksData:trackerState.checksData});
    const deadline=progress.completed?'Target reached':progress.overdue?`Overdue · ${Math.abs(progress.daysRemaining)}d`:progress.daysRemaining===0?'Due today':`${progress.daysRemaining}d left`;
    const details=active.type==='habit'?`${progress.count} of ${progress.target} completions${!trackerState.habits.some(habit=>habit.id===active.habitId)?' · linked habit unavailable; using saved logs':''}`:`${progress.count} of ${progress.target} milestones · self-reported`;
    summary.innerHTML=`<div class="goal-title" title="${esc(active.description||active.title)}">${esc(active.title)}</div><div class="goal-meter" role="progressbar" aria-label="Goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div><div class="goal-meta"><span>${details}</span><span class="${progress.overdue?'goal-overdue':''}">${deadline}</span></div>`;
  }
  const insight=selectSmartInsight({habits:trackerState.habits,checksData:trackerState.checksData,sleepData:trackerState.sleepData});
  $('smartInsight').textContent=insight?.text||'Keep tracking to discover your patterns.';
  $('smartInsight').dataset.kind=insight?.kind||'empty';
  if($('goalList'))renderGoalList();
}

function openGoalManager(editId=''){
  const modal=$('goalModal');$('goalFormError').textContent='';$('goalHabit').innerHTML=trackerState.habits.length?trackerState.habits.map(habit=>`<option value="${esc(habit.id)}">${esc(habit.title)}</option>`).join(''):'<option value="">Add a habit first</option>';
  const goal=trackerState.goals.find(item=>item.id===editId);$('goalForm').reset();$('goalId').value=goal?.id||'';$('goalTitleInput').value=goal?.title||'';$('goalDescription').value=goal?.description||'';$('goalType').value=goal?.type||(trackerState.habits.length?'habit':'manual');
  const today=localISO(new Date()),monthEnd=new Date();monthEnd.setMonth(monthEnd.getMonth()+1,0);
  $('goalStart').value=goal?.periodStart||today;$('goalDeadline').value=goal?.targetDate||localISO(monthEnd);$('goalHabit').value=goal?.habitId||trackerState.habits[0]?.id||'';$('goalTarget').value=goal?.targetCount||10;$('goalManualProgress').value=goal?.manualProgress||0;
  $('goalModalTitle').textContent=goal?'Manage goals · edit goal':'Manage goals';$('goalSubmit').textContent=goal?'Save goal':'Create goal';toggleGoalFields();renderGoalList();modal.classList.add('open');modal.setAttribute('aria-hidden','false');$('goalTitleInput').focus();
}
function closeGoalManager(){const modal=$('goalModal');modal.classList.remove('open');modal.setAttribute('aria-hidden','true');$('goalManageBtn')?.focus()}
function toggleGoalFields(){const manual=$('goalType').value==='manual';$('goalHabitFields').hidden=manual;$('goalManualFields').hidden=!manual;$('goalStart').required=!manual;$('goalHabit').required=!manual;$('goalManualProgress').required=manual;$('goalTargetLabel').textContent=manual?'Milestone target':'Completion target';$('goalTarget').setAttribute('aria-label',manual?'Milestone target':'Number of completions');}
function renderGoalList(){
  const list=$('goalList');if(!list)return;
  list.innerHTML=trackerState.goals.map(goal=>{const progress=goalProgress(goal,{habits:trackerState.habits,checksData:trackerState.checksData});const habit=trackerState.habits.find(item=>item.id===goal.habitId);const state=goal.status==='completed'?'Completed':progress.overdue?'Overdue':goal.isActive?'Active':'Saved';return `<li class="goal-item"><div class="goal-item-copy"><strong>${esc(goal.title)}</strong><small>${state} · ${progress.count}/${progress.target}${goal.type==='manual'?' · self-reported':` · ${esc(habit?.title||goal.habitTitle||'missing habit')}`}</small></div><div class="goal-item-actions"><button type="button" data-goal-action="edit" data-goal-id="${esc(goal.id)}">Edit</button>${goal.status==='completed'?`<button type="button" data-goal-action="reopen" data-goal-id="${esc(goal.id)}">Reopen</button>`:`<button type="button" data-goal-action="complete" data-goal-id="${esc(goal.id)}">Complete</button>`}${!goal.isActive&&goal.status!=='completed'?`<button type="button" data-goal-action="active" data-goal-id="${esc(goal.id)}">Show</button>`:''}<button type="button" data-goal-action="delete" data-goal-id="${esc(goal.id)}" aria-label="Delete ${esc(goal.title)}">Delete</button></div></li>`}).join('')||'<li class="goal-empty">No goals saved yet.</li>';
}
function submitGoal(event){event.preventDefault();$('goalFormError').textContent='';const id=$('goalId').value,raw={id,title:$('goalTitleInput').value,description:$('goalDescription').value,type:$('goalType').value,targetDate:$('goalDeadline').value,periodStart:$('goalStart').value,habitId:$('goalHabit').value,targetCount:Number($('goalTarget').value),manualProgress:Number($('goalManualProgress').value)};try{const next=saveGoal(trackerState.goals,raw,{habits:trackerState.habits}),previous=trackerState.goals;trackerState.goals=next;if(!write('ht_goals',next)){trackerState.goals=previous;return}renderGoalFeatures();openGoalManager();}catch(error){$('goalFormError').textContent=error.message}}
function handleGoalListAction(event){const button=event.target.closest('[data-goal-action]');if(!button)return;const {goalAction:action,goalId:id}=button.dataset;if(action==='edit'){openGoalManager(id);return}if(action==='delete'){const goal=trackerState.goals.find(item=>item.id===id);if(!confirm(`Delete “${goal?.title||'this goal'}”? This does not change habit records.`))return;trackerState.goals=removeGoal(trackerState.goals,id)}else if(action==='active')trackerState.goals=setGoalActive(trackerState.goals,id);else trackerState.goals=setGoalCompleted(trackerState.goals,id,action==='complete');if(!write('ht_goals',trackerState.goals))return;renderGoalFeatures()}

/* ---------- Habits & theme ---------- */

function addHabits(text){

  const list=parseHabits(text);if(!list.length){storageWarning('Enter a habit name or paste a list of names.');return false;}
  const result=addHabitsToState(trackerState,list,localISO(new Date()));
  if(!result.added.length){storageWarning(`No habits added. Already exists: ${result.duplicates.join(', ')}.`);return false;}
  if(!saveHabits()){trackerState.habits.splice(-result.added.length,result.added.length);return false;}
  updateCalendar();
  if(result.duplicates.length)storageWarning(`Added ${result.added.length}. Skipped duplicates: ${result.duplicates.join(', ')}.`);
  const sc=$('habitsTable').closest('.scroll');sc.scrollTop=sc.scrollHeight;return true;

}

function submitAdd(){const i=$('addInput');if(addHabits(i.value)){i.value='';const b=document.querySelector('.addbtn');b.textContent='Added';setTimeout(()=>b.textContent='Add habit',1100)}i.focus()}

function focusAdd(){$('addInput').focus()}

function renderChips(){

  const have=new Set(trackerState.habits.map(h=>normalizeHabitName(h.title)));

  $('chips').innerHTML=SUGGEST.filter(t=>!have.has(normalizeHabitName(t))).slice(0,4).map(t=>`<button class="chip" onclick="addHabits('${t}')">+ ${t}</button>`).join('');

}

$('addInput').addEventListener('paste',e=>{const t=(e.clipboardData||window.clipboardData).getData('text');if(/[\n,;]/.test(t)){e.preventDefault();addHabits(t)}});

function editHabit(id){const h=trackerState.habits.find(x=>x.id===id);if(!h)return;const name=prompt('Habit name:',h.title);if(name===null)return;const schedule=prompt('Scheduled weekdays (0=Sun … 6=Sat), comma separated. Omit rest days:',(h.schedule||[0,1,2,3,4,5,6]).join(','));if(schedule===null)return;const emoji=prompt('Habit icon (emoji):',h.emoji||'📌');if(emoji===null)return;const category=prompt('Category (optional):',h.category||'');if(category===null)return;const previous=cloneRecords(trackerState.habits),result=editHabitInState(trackerState,id,{title:name,schedule:schedule.split(','),emoji,category},localISO(new Date()));if(!result.ok){storageWarning(result.error);return}if(!saveHabits()){trackerState.habits=previous;return}updateCalendar()}

function archiveHabit(id){const h=trackerState.habits.find(x=>x.id===id);if(!h||!confirm(`Archive “${h.title}”? Historical records will be kept.`))return;const previousHabits=cloneRecords(trackerState.habits),previousArchived=cloneRecords(trackerState.archivedHabits);archiveHabitInState(trackerState,id,localISO(new Date()));if(!persistHabitLists(previousHabits,previousArchived))return;updateCalendar()}

function restoreHabit(){if(!trackerState.archivedHabits.length){storageWarning('There are no archived habits.');return}const choices=trackerState.archivedHabits.map((h,i)=>`${i+1}. ${h.title}`).join('\n'),pick=Number(prompt(`Restore an archived habit by number:\n${choices}`));if(!Number.isInteger(pick)||pick<1||pick>trackerState.archivedHabits.length)return;const previousHabits=cloneRecords(trackerState.habits),previousArchived=cloneRecords(trackerState.archivedHabits),id=trackerState.archivedHabits[pick-1].id,result=restoreHabitInState(trackerState,id,localISO(new Date()));if(!result.ok){storageWarning(result.error);return}if(!persistHabitLists(previousHabits,previousArchived))return;updateCalendar()}

function deleteHabit(id){const h=trackerState.habits.find(x=>x.id===id);if(!h||!confirm(`Permanently remove “${h.title}” from this tracker? Historical completion records will be retained.`))return;const previous=cloneRecords(trackerState.habits);deleteHabitFromState(trackerState,id);if(!saveHabits()){trackerState.habits=previous;return}updateCalendar()}

function reorderHabit(id,delta){const previous=cloneRecords(trackerState.habits);if(!reorderHabitInState(trackerState,id,delta))return;if(!saveHabits()){trackerState.habits=previous;return}updateCalendar()}

function toggleTheme(){

  const appearance=trackerState.themeSettings.appearance==='dark'?'light':'dark',p=THEME_PALETTES[trackerState.themeSettings.preset][appearance],next={...trackerState.themeSettings,appearance,background:p[0],surface:p[1]};if(!write('ht_theme_settings',next))return;trackerState.themeSettings=next;applyTheme(next);write('ht_theme',appearance);if(trackerState.themeDraft){trackerState.themeDraft={...next};syncThemeControls(trackerState.themeDraft)}

}



/* ---------- Quick notes ---------- */



const saveNotes=()=>write('ht_notes',trackerState.notes);

function renderNotes(){

  const n=trackerState.notes.length,b=$('noteBadge');

  b.textContent=n>99?'99+':n;b.classList.toggle('show',n>0);

  $('noteCount').textContent=n?'('+n+')':'';

  $('noteList').innerHTML=n?trackerState.notes.map(x=>`<li><div class="nt">${esc(x.text)}<small>${esc(x.date)}</small></div><button onclick="deleteNote('${x.id}')" aria-label="Delete note" title="Delete">&times;</button></li>`).join(''):'<li class="npempty">No notes yet. Jot down a small task above.</li>';

}

function addNote(){

  const i=$('noteInput'),t=i.value.trim();

  if(t){trackerState.notes.unshift({id:'n_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),text:t,date:new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short'})});saveNotes();renderNotes();i.value=''}

  i.focus();

}

function deleteNote(id){trackerState.notes=trackerState.notes.filter(x=>x.id!==id);saveNotes();renderNotes()}

function toggleNotes(e){

  if(e)e.stopPropagation();

  const p=$('notePop'),open=!p.classList.contains('open');

  if(open){closeCalendar();closeMoreMenu(false)}

  p.classList.toggle('open',open);$('noteBtn').setAttribute('aria-expanded',open);

  if(open)setTimeout(()=>$('noteInput').focus(),0);else $('noteBtn').focus();

}

document.addEventListener('click',e=>{const p=$('notePop');if(p.classList.contains('open')&&!e.target.closest('.notewrap'))toggleNotes()});

document.addEventListener('click',e=>{if(!$('calendarPop').hidden&&!e.target.closest('.calendar-wrap'))closeCalendar();const menu=document.querySelector('.more-menu');if(menu.open&&!e.target.closest('.more-menu'))closeMoreMenu(false)});

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('accountModal').classList.contains('open')){e.preventDefault();closeAccountDialog();return}
  if(e.key==='Escape'&&$('goalModal').classList.contains('open')){e.preventDefault();closeGoalManager();return}
  if(e.key==='Escape'&&$('downloadReportsModal').classList.contains('open')){e.preventDefault();closeDownloadReports();return}
  if(e.key==='Escape'&&!$('calendarPop').hidden){e.preventDefault();closeCalendar(true);return}
  if(e.key==='Escape'&&document.querySelector('.more-menu').open){e.preventDefault();closeMoreMenu();return}
  if(e.key==='Escape'&&$('notePop').classList.contains('open'))toggleNotes()
});

trackerState.notes=read('ht_notes',[]);renderNotes();
$('accountForm').addEventListener('submit',submitAccountForm);
$('goalType').addEventListener('change',toggleGoalFields);
$('goalForm').addEventListener('submit',submitGoal);
$('goalList').addEventListener('click',handleGoalListAction);

async function initialize(){
  try{
    await configureCloud();
    loadSavedData();
    if(cloudClient){
      const recovered=cloudClient.session?.type==='recovery';recoveryMode=recovered;
      try{const session=await cloudClient.getSession();if(session)await activateCloudAccount(session,{startup:true});}
      catch(error){cloudReady=false;cloudUser=null;try{await cloudClient.signOut()}catch{}updateAccountUi(`Could not load cloud data: ${error.message}. Your local browser data is still available; retry sign-in when the connection is ready.`)}
    }
    charts=createCharts({css,warn:storageWarning});charts.rebuild();populateDateSelectors();updateCalendar();
  }catch(error){storageWarning(`Startup could not finish: ${error.message}`);try{loadSavedData();charts=createCharts({css,warn:storageWarning});charts.rebuild();populateDateSelectors();updateCalendar()}catch{}}
  finally{
    document.documentElement.classList.remove('cloud-booting');
    if(location.pathname==='/signin'||new URLSearchParams(location.search).has('account'))openAccountDialog();
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();



function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}

function exportAppData(){try{const blob=new Blob([JSON.stringify(exportLocalData(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`habit-tracker-backup-${localISO(new Date())}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch{storageWarning('Could not export Habit Tracker data in this browser.')}}

function downloadMonthlyCsv(){closeDownloadReports();try{const r=monthlyReportData(),csv=buildMonthlyCsv({report:r,habits:trackerState.habits,archivedHabits:trackerState.archivedHabits,checksData:trackerState.checksData}),blob=new Blob([csv],{type:'text/csv;charset=utf-8'});downloadBlob(blob,`habit-tracker-${r.year}-${String(r.month+1).padStart(2,'0')}.csv`)}catch{storageWarning('Could not create the monthly CSV export in this browser.')}}

async function downloadMonthlyPng(){
  closeDownloadReports();
  try{
    await document.fonts?.ready;
    await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const r=monthlyReportData(),canvas=renderMonthlyReportCanvas(r,{background:css('--bg'),surface:css('--surf'),text:css('--text-primary'),muted:css('--text-secondary'),line:css('--line'),accent:css('--accent'),fontFamily:getComputedStyle(document.body).fontFamily});
    const blob=await new Promise((resolve,reject)=>canvas.toBlob((image)=>image?resolve(image):reject(new Error('PNG encoding returned no image.')),'image/png'));
    downloadBlob(blob,`habit-tracker-${r.year}-${String(r.month+1).padStart(2,'0')}.png`);
  }catch{storageWarning('Could not create the monthly PNG export in this browser.');}
}

async function downloadMonthlyPdf(){
  closeDownloadReports();
  try{
    await document.fonts?.ready;
    await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const r=monthlyReportData(),reportCanvas=renderMonthlyReportCanvas(r,{background:css('--bg'),surface:css('--surf'),text:css('--text-primary'),muted:css('--text-secondary'),line:css('--line'),accent:css('--accent'),fontFamily:getComputedStyle(document.body).fontFamily});
    const sourceHeight=Math.max(1,Math.floor(reportCanvas.width*792/612)),pages=[];
    for(let y=0;y<reportCanvas.height;y+=sourceHeight){
      const height=Math.min(sourceHeight,reportCanvas.height-y),pageCanvas=document.createElement('canvas');
      pageCanvas.width=reportCanvas.width;pageCanvas.height=height;
      const context=pageCanvas.getContext('2d');if(!context)throw new Error('PDF page rendering is unavailable.');
      context.drawImage(reportCanvas,0,y,reportCanvas.width,height,0,0,reportCanvas.width,height);
      const dataUrl=pageCanvas.toDataURL('image/jpeg',.94),base64=dataUrl.slice(dataUrl.indexOf(',')+1),binary=atob(base64),jpegBytes=new Uint8Array(binary.length);
      for(let index=0;index<binary.length;index++)jpegBytes[index]=binary.charCodeAt(index);
      pages.push({jpegBytes,width:pageCanvas.width,height:pageCanvas.height});
    }
    const blob=buildImagePdfBlob(pages),filename=`habit-tracker-${r.year}-${String(r.month+1).padStart(2,'0')}.pdf`;
    downloadBlob(blob,filename);
  }catch(error){storageWarning(`Could not create the PDF download${error?.message?`: ${error.message}`:'.'}`)}
}

function openImportPicker(){$('importDataInput').click()}

async function handleImportFile(event){const file=event.target.files?.[0];if(!file)return;try{const payload=JSON.parse(await file.text());let allowReplace=false;try{allowReplace=confirm('Importing replaces the Habit Tracker data in this browser. A recovery backup will be saved first. Continue?')}catch{}importLocalData(payload,localStorage,{allowReplace});alert('Habit Tracker data imported. The page will reload now.');location.reload()}catch(error){storageWarning(error.message||'Could not import this backup. Existing data was preserved.')}finally{event.target.value=''}}

$('importDataInput')?.addEventListener('change',handleImportFile);

Object.assign(window,{toggleNotes,addNote,shiftMonth,updateCalendar,toggleTheme,openThemeSettings,goToday,openDownloadReports,closeDownloadReports,openAccountDialog,closeAccountDialog,toggleAccountMode,sendPasswordReset,signOutAccount,downloadMonthlyReport,printMonthlyReport,downloadMonthlyPdf,downloadMonthlyPng,downloadMonthlyCsv,toggleFocusMode,toggleCalendar,closeCalendar,closeMoreMenu,restoreHabit,focusAdd,submitAdd,closeThemeSettings,resetThemeDraft,saveThemeSettings,editHabit,archiveHabit,deleteHabit,reorderHabit,addHabits,deleteNote,exportAppData,openImportPicker,openGoalManager,closeGoalManager});


