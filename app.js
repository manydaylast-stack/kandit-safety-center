import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  getDoc
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let adminMode = false;
let latestAudio = null;
let incidentActive = false;
let helps = [];
let broadcasts = [];
let safeCount = 0;
let incidentCount = 0;
let mediaRecorder = null;
let stream = null;
let chunks = [];
let unsub = [];

const $ = id => document.getElementById(id);
const toast = msg => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
};
const nowText = () => new Date().toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'});
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id)?.classList.add('active');
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === id));
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => showView(b.dataset.view));

function updateStatus() {
  const s = $('systemStatus');
  s.classList.toggle('emergency', incidentActive);
  s.textContent = incidentActive ? '🔴 EMERGENCY' : '🟢 ปกติ';
}

function setIncidentUI(type, text) {
  incidentActive = true;
  updateStatus();
  $('kIncident').textContent = '🔴 ' + (type || 'เหตุฉุกเฉิน');
  $('alertTitle').textContent = '🔴 ' + (type || 'เหตุฉุกเฉิน');
  $('alertText').textContent = text || '';
  $('homeAlert').classList.add('show');
}

function clearIncidentUI() {
  incidentActive = false;
  updateStatus();
  $('kIncident').textContent = 'ปกติ';
  $('homeAlert').classList.remove('show');
}

function addNotice(title, text, prepend = true) {
  const n = document.createElement('div');
  n.className = 'notice';
  n.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small>`;
  const box = $('publicNotices');
  if (prepend) box.prepend(n); else box.appendChild(n);
}

function renderBroadcasts(items) {
  const box = $('publicNotices');
  box.innerHTML = '';
  if (!items.length) {
    box.innerHTML = '<div class="notice"><strong>🟢 ระบบพร้อมใช้งาน</strong><small>ยังไม่มีประกาศ</small></div>';
    return;
  }
  items.slice(0, 10).forEach(b => {
    const time = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit'}) : '';
    addNotice(`📢 ${b.type || 'ประกาศ'}`, `${b.text || ''}${time ? ' • ' + time : ''}`, false);
  });
}

function renderHelp() {
  $('helpList').innerHTML = helps.length
    ? helps.map((h,i) => {
        const time = h.createdAt?.toDate ? h.createdAt.toDate().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}) : (h.time || '');
        return `<div class="notice"><strong>🆘 #${String(i+1).padStart(3,'0')} • ${escapeHtml(time)}</strong><small>${escapeHtml(h.type || 'ขอความช่วยเหลือ')} • ${escapeHtml(h.place || 'ไม่ระบุ')}</small><div style="margin-top:8px"><button class="btn green" onclick="resolveHelp('${h.id}')">✓ รับเรื่อง/จัดการแล้ว</button></div></div>`;
      }).join('')
    : 'ยังไม่มีคำขอ';
}

function renderPeople() {
  const names = ['นักเรียน A','นักเรียน B','นักเรียน C','นักเรียน D','นักเรียน E','ครู A','ครู B','ครู C','บุคลากร A','บุคลากร B'];
  $('peopleBody').innerHTML = names.map((n,i) => `<tr><td>${n}</td><td>${i<5?'นักเรียน':i<8?'ครู':'บุคลากร'}</td><td><span class="pill ${i<safeCount?'p-green':'p-gray'}">${i<safeCount?'🟢 ปลอดภัย':'⚪ รอข้อมูล'}</span></td></tr>`).join('');
}
renderPeople();

async function refreshAdminMode() {
  if (!currentUser || currentUser.isAnonymous) {
    adminMode = false;
  } else {
    const snap = await getDoc(doc(db, 'admins', currentUser.uid)).catch(() => null);
    adminMode = !!snap?.exists();
  }
  document.body.classList.toggle('admin-mode', adminMode);
  $('adminState').textContent = adminMode ? `🟢 ผู้ดูแล: ${currentUser.email}` : '🔒 ผู้ใช้ทั่วไป';
  $('adminLoginBtn').classList.toggle('hidden', adminMode);
  $('adminLogoutBtn').classList.toggle('hidden', !adminMode);
  $('adminOnlyHint').classList.toggle('hidden', adminMode);
  $('adminLock').classList.toggle('hidden', adminMode);
  if (adminMode) subscribeAdminData(); else unsubscribeAdminData();
}

function unsubscribeAdminData() {
  unsub.forEach(fn => fn?.());
  unsub = [];
  helps = [];
  safeCount = 0;
  incidentCount = 0;
  $('kHelp').textContent = '—';
  $('helpCount').textContent = '—';
  $('safeCount').textContent = '—';
  $('kSafe').textContent = '—';
  $('helpList').textContent = 'เข้าสู่ระบบผู้ดูแลเพื่อดูข้อมูล';
}

function subscribeAdminData() {
  unsubscribeAdminData();
  const hq = query(collection(db,'help_requests'), orderBy('createdAt','desc'), limit(50));
  unsub.push(onSnapshot(hq, snap => {
    helps = snap.docs.map(d => ({id:d.id, ...d.data()}));
    $('kHelp').textContent = helps.length;
    $('helpCount').textContent = helps.length;
    renderHelp();
  }, err => toast('อ่านคำขอความช่วยเหลือไม่ได้: ' + err.code)));

  const sq = query(collection(db,'safety_status'), orderBy('createdAt','desc'), limit(200));
  unsub.push(onSnapshot(sq, snap => {
    safeCount = snap.size;
    $('kSafe').textContent = safeCount;
    $('safeCount').textContent = safeCount;
    renderPeople();
  }, err => toast('อ่าน Safety Check ไม่ได้: ' + err.code)));

  const iq = query(collection(db,'incidents'), orderBy('createdAt','desc'), limit(50));
  unsub.push(onSnapshot(iq, snap => {
    incidentCount = snap.size;
    $('incidentHistory').textContent = incidentCount;
  }, err => toast('อ่านประวัติเหตุไม่ได้: ' + err.code)));
}

// Public real-time listeners: broadcast + current system status.
function subscribePublicData() {
  const bq = query(collection(db,'broadcasts'), orderBy('createdAt','desc'), limit(20));
  onSnapshot(bq, snap => {
    broadcasts = snap.docs.map(d => ({id:d.id, ...d.data()}));
    $('kBroadcast').textContent = broadcasts.length;
    renderBroadcasts(broadcasts);
    if (broadcasts[0]) {
      const b = broadcasts[0];
      latestAudio = {type:'tts', text:b.text || ''};
    }
  }, err => toast('เชื่อมต่อประกาศไม่ได้: ' + err.code));

  onSnapshot(doc(db,'system','status'), snap => {
    const x = snap.data();
    if (!x) return;
    if (x.active) setIncidentUI(x.type, x.text);
    else clearIncidentUI();
  }, err => toast('อ่านสถานะระบบไม่ได้: ' + err.code));
}

window.openIncident = () => $('incidentModal').classList.add('show');
window.closeModal = () => $('incidentModal').classList.remove('show');

window.requestHelp = async () => {
  try {
    await addDoc(collection(db,'help_requests'), {
      uid: currentUser.uid,
      type: 'ขอความช่วยเหลือ',
      place: $('userPlace')?.value?.trim() || 'ผู้ใช้ปัจจุบัน',
      createdAt: serverTimestamp(),
      status: 'open'
    });
    toast('🆘 ส่งคำขอความช่วยเหลือแล้ว');
  } catch (e) { console.error(e); toast('ส่งคำขอไม่สำเร็จ'); }
};

window.markSafe = async () => {
  try {
    await addDoc(collection(db,'safety_status'), {
      uid: currentUser.uid,
      status: 'safe',
      createdAt: serverTimestamp()
    });
    toast('🟢 ยืนยันว่าคุณปลอดภัยแล้ว');
  } catch (e) { console.error(e); toast('บันทึกสถานะไม่สำเร็จ'); }
};

window.sendIncident = async () => {
  const type = $('incidentType').value;
  const place = $('incidentPlace').value.trim() || 'ไม่ระบุจุด';
  try {
    await addDoc(collection(db,'incidents'), {
      uid: currentUser.uid,
      type,
      place,
      createdAt: serverTimestamp(),
      status: 'open'
    });
    $('incidentModal').classList.remove('show');
    toast('🚨 ส่งเหตุฉุกเฉินไปยังศูนย์บัญชาการแล้ว');
    showView('home');
  } catch (e) { console.error(e); toast('ส่งเหตุไม่สำเร็จ'); }
};

window.resolveHelp = async id => {
  if (!adminMode) return toast('เฉพาะผู้ดูแลเท่านั้น');
  try {
    await updateDoc(doc(db,'help_requests',id), {status:'resolved', resolvedAt:serverTimestamp(), resolvedBy:currentUser.uid});
    toast('✓ ปิดคำขอแล้ว');
  } catch(e) { toast('อัปเดตไม่สำเร็จ'); }
};

window.broadcastScenario = async (play=false) => {
  if (!adminMode) return toast('🔒 กรุณาเข้าสู่ระบบผู้ดูแลก่อน');
  const type = $('scenario').value;
  const text = $('broadcastText').value.trim() || 'โปรดอยู่ในพื้นที่ปลอดภัย และติดตามคำสั่งจากศูนย์บัญชาการ';
  try {
    await addDoc(collection(db,'broadcasts'), {type,text,uid:currentUser.uid,createdAt:serverTimestamp(),active:true});
    await setDoc(doc(db,'system','status'), {active:true,type,text,updatedAt:serverTimestamp()});
    if (play) speakText(text);
    toast('📢 ส่งประกาศไปยังทุกอุปกรณ์แล้ว');
  } catch(e) { console.error(e); toast('ส่งประกาศไม่สำเร็จ'); }
};

window.closeIncident = async () => {
  if (!adminMode) return toast('🔒 กรุณาเข้าสู่ระบบผู้ดูแลก่อน');
  try {
    await setDoc(doc(db,'system','status'), {active:false,updatedAt:serverTimestamp()},{merge:true});
    toast('🟢 ยุติเหตุแล้ว');
  } catch(e) { toast('ยุติเหตุไม่สำเร็จ'); }
};

window.enableAudio = () => {
  $('audioReady').textContent = '🟢 พร้อม';
  toast('🔊 ระบบเสียงพร้อมใช้งาน');
  try { new AudioContext().resume(); } catch(e) {}
};

function speakText(text) {
  if (!('speechSynthesis' in window)) return toast('เบราว์เซอร์นี้ไม่รองรับเสียง');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'th-TH'; u.rate = .92;
  speechSynthesis.speak(u);
  latestAudio = {type:'tts',text};
}
window.playLatest = () => latestAudio?.text ? speakText(latestAudio.text) : toast('ยังไม่มีประกาศเสียง');
window.stopAudio = () => { speechSynthesis?.cancel(); $('audioPlayer').pause(); };
window.playTone = type => {
  const messages = {
    'ผู้บุกรุก':'แจ้งเตือนเหตุผู้บุกรุก กรุณาอยู่ในพื้นที่ปลอดภัยและปฏิบัติตามคำสั่งของโรงเรียน',
    'ไฟไหม้':'แจ้งเตือนไฟไหม้ กรุณาปฏิบัติตามแผนการอพยพของโรงเรียน',
    'น้ำท่วม':'แจ้งเตือนน้ำท่วม กรุณาหลีกเลี่ยงพื้นที่เสี่ยงและติดตามประกาศ',
    'พายุ':'แจ้งเตือนสภาพอากาศรุนแรง กรุณาอยู่ภายในอาคารและติดตามประกาศ'
  };
  enableAudio(); speakText(messages[type] || 'ประกาศฉุกเฉิน');
};

$('audioFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  $('fileName').textContent = '🎵 ' + f.name;
  const url = URL.createObjectURL(f);
  $('audioPlayer').src = url;
  latestAudio = {type:'url',url};
});

window.toggleLive = async () => {
  if (!adminMode) return toast('🔒 เฉพาะผู้ดูแลเท่านั้น');
  if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = () => {
      stream?.getTracks().forEach(t=>t.stop());
      const blob = new Blob(chunks,{type:'audio/webm'});
      const url = URL.createObjectURL(blob);
      latestAudio = {type:'url',url};
      $('liveState').textContent = 'บันทึกเสียงทดสอบแล้ว • กดฟังจากประกาศล่าสุดได้';
      $('liveBtn').innerHTML = '🎙️<br><span style="font-size:14px">กดเพื่อพูด</span>';
      $('wave').classList.add('hidden');
    };
    mediaRecorder.start();
    $('liveState').textContent = '🔴 กำลังบันทึกเสียงจากไมโครโฟน';
    $('liveBtn').innerHTML = '⏹️<br><span style="font-size:14px">หยุดพูด</span>';
    $('wave').classList.remove('hidden');
    $('wave').innerHTML = Array.from({length:30},(_,i)=>`<i style="height:${10+(i%7)*6}px"></i>`).join('');
  } catch(e) { toast('ไม่สามารถใช้ไมโครโฟนได้ กรุณาอนุญาต Microphone และใช้ HTTPS'); }
};

window.adminLogin = async () => {
  const email = prompt('อีเมลผู้ดูแลระบบ');
  const pass = prompt('รหัสผ่าน');
  if (!email || !pass) return;
  try {
    await signInWithEmailAndPassword(auth,email,pass);
    toast('เข้าสู่ระบบแล้ว — หากเป็นบัญชีที่ได้รับสิทธิ์จะเห็น Command Center');
  } catch(e) {
    console.error(e);
    toast('เข้าสู่ระบบไม่สำเร็จ ตรวจสอบ Email/Password และเปิด Email/Password ใน Firebase Authentication');
  }
};
window.adminLogout = async () => {
  await signOut(auth);
  await signInAnonymously(auth).catch(()=>{});
  toast('ออกจากระบบผู้ดูแลแล้ว');
};

onAuthStateChanged(auth, async user => {
  currentUser = user;
  $('userUid').textContent = user ? (user.isAnonymous ? 'ผู้ใช้ทั่วไป' : user.email) : 'กำลังเชื่อมต่อ…';
  await refreshAdminMode();
});

(async function init(){
  try {
    await signInAnonymously(auth);
    subscribePublicData();
  } catch(e) {
    console.error(e);
    toast('เริ่มระบบไม่ได้ — กรุณาเปิด Anonymous sign-in ใน Firebase Authentication');
  }
})();
