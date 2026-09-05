"use strict";
/* ============================================================================
   Fadesrek Academy — School Management System

   A working system, not a mockup. Records persist, results compute, fees
   reconcile, and every screen is gated on the permission keys from the RBAC
   catalogue that the NestJS API enforces server-side.

   Entities mirror the Prisma schema: Student and StudentEnrollment are kept
   separate, scores are stored per assessment component and never pre-summed,
   money is held in kobo as integers, and payments are reversed rather than
   edited.
   ========================================================================== */

// ---------------------------------------------------------------- storage ---
// Uses the artifact key-value store when present, memory otherwise. Never
// localStorage: it is unavailable here and silently loses work when it fails.

const Store = (() => {
  const mem = new Map();
  const has = typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function';
  return {
    backed: has,
    async get(k){
      if(!has) return mem.has(k) ? mem.get(k) : null;
      try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; }
      catch { return null; }
    },
    async set(k,v){
      if(v===null) mem.delete(k); else mem.set(k,v);
      if(!has) return;
      try {
        if(v===null) await window.storage.delete(k);
        else await window.storage.set(k, JSON.stringify(v));
      } catch(e){ console.warn('storage write failed', e); }
    },
    async listKeys(prefix){
      if(!has) return [...mem.keys()].filter(k=>k.startsWith(prefix));
      try { const r = await window.storage.list(prefix); return r ? r.keys : []; }
      catch { return []; }
    },
  };
})();

// ------------------------------------------------------------------ theme ---
// Persisted through Store like everything else here. First run always
// starts light — dark mode is opt-in, switched on from the toggle (visible
// on the login screen too) rather than inferred from the OS.

const Theme = {
  current: 'light',
  sunIcon:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3.6"/><path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4M15.5 15.5l-1.4-1.4M5.9 5.9 4.5 4.5"/></svg>',
  moonIcon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 11.5A7 7 0 1 1 8.5 3a5.5 5.5 0 0 0 8.5 8.5z"/></svg>',
  apply(t){
    this.current = t;
    document.documentElement.setAttribute('data-theme', t);
    // Two toggles share this: the header one (only visible once signed in)
    // and the login screen's own, since dark mode should be available before
    // there's anyone to sign in as.
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.innerHTML = t==='dark' ? this.sunIcon : this.moonIcon;
      const label = t==='dark' ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    });
  },
  async init(){
    const saved = await Store.get('fadesrek:theme');
    this.apply(saved || 'light');
  },
  async toggle(){
    const next = this.current === 'dark' ? 'light' : 'dark';
    this.apply(next);
    await Store.set('fadesrek:theme', next);
  },
};

// ------------------------------------------------------------------- auth ---
// A real login, not a role toggle: a session is a signed-in account, and the
// account fixes the role — nobody picks their own permissions from a menu.
// AUTH_USERS is defined further down, once ROLES exists; login only runs
// after the whole module has evaluated, so the forward reference is safe.

const Auth = {
  session: null,
  async init(){
    const saved = await Store.get('fadesrek:session');
    if(saved && AUTH_USERS.some(u=>u.username===saved.username && u.role===saved.role)) this.session = saved;
  },
  async login(username, password){
    const u = AUTH_USERS.find(x=>x.username.toLowerCase()===String(username).trim().toLowerCase() && x.password===password);
    if(!u) return false;
    this.session = {username:u.username, role:u.role};
    await Store.set('fadesrek:session', this.session);
    logAudit('auth.login', `${u.username} signed in`);
    return true;
  },
  async logout(){
    if(this.session) logAudit('auth.logout', `${this.session.username} signed out`);
    this.session = null;
    await Store.set('fadesrek:session', null);
  },
};

// ------------------------------------------------------- audit & notify ----

/** One line per state-changing action, newest first. Real deployments feed
    this from server middleware; here it's written at the same call sites
    that already call persist(), so it never drifts from what actually
    changed. */
function logAudit(action, detail){
  db.auditLog.unshift({id:uid('al'), at:new Date().toISOString(),
    actor:ROLES[state.role]?.name || 'System', role:state.role, action, detail});
  if(db.auditLog.length > 500) db.auditLog.length = 500;
}

/** Role-addressed, not user-addressed — this demo runs one signed-in persona
    at a time, so "to" is whoever next signs in as that role, not a specific
    person. A real system would key this off a user id instead of a role. */
function notify(to, title, body){
  db.notifications.unshift({id:uid('nt'), to, title, body, at:new Date().toISOString(), read:false});
  if(db.notifications.length > 200) db.notifications.length = 200;
}

// --------------------------------------------------------------- helpers ----

const $ = s => document.querySelector(s);
const el = (t,c,h) => { const n=document.createElement(t); if(c)n.className=c; if(h!=null)n.innerHTML=h; return n; };
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = p => p+'_'+Math.random().toString(36).slice(2,10);

/** Money is kept in kobo. Float naira loses a kobo somewhere and the bursar
    spends a day looking for it. */
const naira = k => '₦'+(k/100).toLocaleString('en-NG',{minimumFractionDigits:0,maximumFractionDigits:0});
const nairaFull = k => '₦'+(k/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2});
/** naira() above takes kobo (this file's convention everywhere else); the
    real reports API already converts to naira server-side (koboToNaira) —
    this formats a value that's already in naira, no /100. */
const nairaAmount = n => '₦'+Math.round(n).toLocaleString('en-NG');

const initials = (a,b) => (a[0]+(b?b[0]:'')).toUpperCase();
const fmtDate = d => new Date(d).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
const fmtDateTime = d => new Date(d).toLocaleString('en-NG',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const todayISO = () => '2026-08-06';

/** Deterministic PRNG so the seeded school is identical on every load —
    a demo whose numbers move under you is impossible to check. */
function mulberry32(a){ return function(){ a|=0;a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const rng = mulberry32(20260806);
const pick = arr => arr[Math.floor(rng()*arr.length)];
const between = (lo,hi) => lo+Math.floor(rng()*(hi-lo+1));

function toast(msg, bad=false){
  const t = el('div','toast'+(bad?' bad':''), msg);
  $('#toasts').appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; setTimeout(()=>t.remove(),260); }, 3400);
}

// ------------------------------------------------------------- reference ----

// AI backend (server/index.js) — a separate origin from this static site,
// hence credentials:'include' on every call so its session cookie rides
// along. Not part of the in-memory demo db: it talks to real Postgres.
const AI_API = 'http://localhost:4001';

const SESSION = '2026/2027';
const TERM = 'First Term';
const TODAY = new Date(2026,7,6);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CLASSES = [
  {id:'c1', level:'JSS 1', arm:'Gold',    capacity:40},
  {id:'c2', level:'JSS 1', arm:'Silver',  capacity:40},
  {id:'c3', level:'JSS 2', arm:'Gold',    capacity:40},
  {id:'c4', level:'JSS 2', arm:'Silver',  capacity:40},
  {id:'c5', level:'JSS 3', arm:'Gold',    capacity:40},
  {id:'c6', level:'SS 1',  arm:'Science', capacity:35, stream:'Science'},
  {id:'c7', level:'SS 1',  arm:'Arts',    capacity:35, stream:'Arts'},
  {id:'c8', level:'SS 2',  arm:'Science', capacity:35, stream:'Science'},
  {id:'c9', level:'SS 3',  arm:'Science', capacity:35, stream:'Science'},
];
const className = c => c ? `${c.level} ${c.arm}` : '—';

const SUBJECTS = [
  {id:'s1', name:'Mathematics',        code:'MTH', core:true},
  {id:'s2', name:'English Language',   code:'ENG', core:true},
  {id:'s3', name:'Basic Science',      code:'BSC', junior:true},
  {id:'s4', name:'Social Studies',     code:'SOS', junior:true},
  {id:'s5', name:'Civic Education',    code:'CIV', core:true},
  {id:'s6', name:'Agricultural Science',code:'AGR'},
  {id:'s7', name:'Physics',            code:'PHY', senior:true},
  {id:'s8', name:'Chemistry',          code:'CHM', senior:true},
  {id:'s9', name:'Biology',            code:'BIO', senior:true},
  {id:'s10',name:'Literature-in-English',code:'LIT', senior:true},
  {id:'s11',name:'Government',         code:'GOV', senior:true},
  {id:'s12',name:'Computer Studies',   code:'CMP'},
];

/** WAEC-style nine-point scale. Held as data, not code, because a school
    changes its grading far more often than it changes its software. */
const BANDS = [
  {min:75,g:'A1',r:'Excellent'},   {min:70,g:'B2',r:'Very good'},
  {min:65,g:'B3',r:'Good'},        {min:60,g:'C4',r:'Credit'},
  {min:55,g:'C5',r:'Credit'},      {min:50,g:'C6',r:'Credit'},
  {min:45,g:'D7',r:'Pass'},        {min:40,g:'E8',r:'Pass'},
  {min:0, g:'F9',r:'Fail'},
];
const gradeOf = total => BANDS.find(b => total >= b.min);

/** Components sum to 100. Stored separately so a re-weighting is a settings
    change, never a data migration. */
const COMPONENTS = [
  {key:'ca1', label:'CA 1',       max:10},
  {key:'ca2', label:'CA 2',       max:10},
  {key:'asg', label:'Assignment', max:10},
  {key:'exam',label:'Exam',       max:70},
];

const FEE_ITEMS = [
  {id:'f1', name:'Tuition',           amount:12000000, applies:'ALL'},
  {id:'f2', name:'Development levy',  amount:2500000,  applies:'ALL'},
  {id:'f3', name:'Examination fee',   amount:800000,   applies:'ALL'},
  {id:'f4', name:'ICT & laboratory',  amount:1500000,  applies:'ALL'},
  {id:'f5', name:'Hostel',            amount:9000000,  applies:'BOARDER'},
  {id:'f6', name:'Transport',         amount:4500000,  applies:'TRANSPORT'},
];

const INCOME_CATEGORIES = ['Donation','Facility rental','Investment income','Sundry income','Library fines','Other'];
const EXPENSE_CATEGORIES = ['Utilities','Maintenance & repairs','Teaching materials','Transport & fuel','Administrative','Other'];
const LIBRARY_CATEGORIES = ['Literature','Mathematics','Science','Reference','Social','Other'];

/* ---------------------------------------------------------------- website --- */
// A page's type picks which slot it fills and which extra fields its editor
// shows — LEADERSHIP gets a staff picker, DOWNLOADS gets a file list — but
// every type shares the same heading/body/CTA/SEO shape underneath, so one
// editor serves all of them rather than a form per page.
const PAGE_TYPES = {
  HOME:'Homepage', ADMISSIONS:'Admissions', ACADEMICS:'Academics', LEADERSHIP:'Leadership',
  DOWNLOADS:'Downloads', CONTACT:'Contact', GENERAL:'General page',
};

/* ---------------------------------------------------------------- payroll ---
   PAYE under the Nigeria Tax Act 2025, in force from 1 January 2026. The Act
   abolished the Consolidated Relief Allowance and replaced it with an
   ₦800,000 tax-free band plus rent relief, so any payroll still applying the
   old CRA formula is now under-deducting.

   Bands live in a table, not in code, because a Finance Act changes far more
   often than this software will. Editing them is a settings change.           */

const PAYE_BANDS = [
  {width:   80_000_000, rate:0.00, label:'First ₦800,000'},
  {width:  220_000_000, rate:0.15, label:'Next ₦2.2m'},
  {width:  900_000_000, rate:0.18, label:'Next ₦9m'},
  {width:1_300_000_000, rate:0.21, label:'Next ₦13m'},
  {width:2_500_000_000, rate:0.23, label:'Next ₦25m'},
  {width:Infinity,      rate:0.25, label:'Above ₦50m'},
];

/** Pensionable pay is Basic + Housing + Transport, not gross. Getting this
    wrong is the single most common Nigerian payroll error. */
const PAY_SPLIT = {basic:0.40, housing:0.20, transport:0.20, other:0.20};
const PENSION_EMPLOYEE = 0.08;   // Pension Reform Act 2014 minimum
const PENSION_EMPLOYER = 0.10;
const NHF_RATE = 0.025;          // of basic
const RENT_RELIEF_CAP = 50_000_000;  // ₦500,000

const SALARY_GRADES = [
  {id:'g1', name:'FA 07 — Principal',        gross:480_000_000},
  {id:'g2', name:'FA 06 — Vice Principal',   gross:360_000_000},
  {id:'g3', name:'FA 05 — Head of unit',     gross:300_000_000},
  {id:'g4', name:'FA 04 — Senior teacher',   gross:240_000_000},
  {id:'g5', name:'FA 03 — Teacher',          gross:180_000_000},
  {id:'g6', name:'FA 02 — Junior staff',     gross:144_000_000},
  {id:'g7', name:'FA 01 — Support staff',    gross:108_000_000},
];

const LEAVE_TYPES = ['Annual','Casual','Sick','Maternity','Study','Compassionate'];
const BANKS = ['GTBank','Zenith','Access','UBA','First Bank','Sterling Bank'];
const PFAS = ['Stanbic IBTC Pensions','ARM Pension','Leadway Pensure','Premium Pension'];

/* -------------------------------------------------------------- timetable --- */
const PERIODS = [
  {id:'p1', label:'1st', from:'08:00', to:'08:40'},
  {id:'p2', label:'2nd', from:'08:40', to:'09:20'},
  {id:'p3', label:'3rd', from:'09:20', to:'10:00'},
  {id:'br', label:'Break', from:'10:00', to:'10:20', isBreak:true},
  {id:'p4', label:'4th', from:'10:20', to:'11:00'},
  {id:'p5', label:'5th', from:'11:00', to:'11:40'},
  {id:'p6', label:'6th', from:'11:40', to:'12:20'},
  {id:'p7', label:'7th', from:'12:20', to:'13:00'},
];
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

/* --------------------------------------------------------------- academics ---
   Question bank. Written to the Nigerian primary-to-JSS transition standard,
   which is what the entrance examination actually screens for.

   `answer` is the index into `options`. Storing the index rather than the text
   means an option can be reworded without silently invalidating every attempt
   already marked against it.                                                  */

const QUESTION_BANK = {
  MTH: [
    {stem:'What is 3/4 of 48?', options:['32','36','38','42'], answer:1},
    {stem:'Simplify: 2/3 + 1/6', options:['3/9','5/6','1/2','3/6'], answer:1},
    {stem:'A rectangle measures 8 cm by 5 cm. What is its perimeter?', options:['13 cm','26 cm','40 cm','20 cm'], answer:1},
    {stem:'What is 15% of 200?', options:['15','20','30','45'], answer:2},
    {stem:'If 5x = 45, what is the value of x?', options:['5','9','40','50'], answer:1},
    {stem:'Round 4,678 to the nearest hundred.', options:['4,600','4,680','4,700','5,000'], answer:2},
    {stem:'What is the lowest common multiple of 6 and 8?', options:['12','24','36','48'], answer:1},
    {stem:'Find the area of a triangle with base 10 cm and height 6 cm.', options:['16 cm²','30 cm²','60 cm²','24 cm²'], answer:1},
    {stem:'Express 0.25 as a fraction in its lowest terms.', options:['1/2','1/3','1/4','2/5'], answer:2},
    {stem:'A trader bought a bag of rice for ₦45,000 and sold it for ₦52,000. What was the profit?', options:['₦5,000','₦7,000','₦8,000','₦9,000'], answer:1},
    {stem:'What is the value of 7² − 3²?', options:['16','32','40','58'], answer:2},
    {stem:'How many minutes are there in 3¼ hours?', options:['180','195','200','215'], answer:1},
  ],
  ENG: [
    {stem:'Choose the correct plural of "child".', options:['childs','childrens','children','childes'], answer:2},
    {stem:'Which word is the opposite of "generous"?', options:['kind','stingy','wealthy','cheerful'], answer:1},
    {stem:'She ______ to school every morning.', options:['go','goes','going','gone'], answer:1},
    {stem:'Which of these is a noun?', options:['quickly','happiness','beautiful','running'], answer:1},
    {stem:'Choose the correctly spelt word.', options:['neccessary','necesary','necessary','necessarry'], answer:2},
    {stem:'What is the past tense of "buy"?', options:['buyed','bought','boughted','buys'], answer:1},
    {stem:'Identify the verb: "The boy kicked the ball."', options:['boy','kicked','ball','the'], answer:1},
    {stem:'Which sentence is correctly punctuated?', options:['where are you going','Where are you going?','where are you going?','Where are you going'], answer:1},
    {stem:'Choose the word that completes the proverb: "A stitch in time saves ______."', options:['nine','time','all','money'], answer:0},
    {stem:'Which is a pronoun?', options:['table','she','jump','blue'], answer:1},
  ],
  BSC: [
    {stem:'Which planet is the largest in our solar system?', options:['Earth','Mars','Jupiter','Saturn'], answer:2},
    {stem:'Which organ pumps blood around the body?', options:['Lungs','Heart','Liver','Kidney'], answer:1},
    {stem:'Which gas do plants absorb during photosynthesis?', options:['Oxygen','Nitrogen','Carbon dioxide','Hydrogen'], answer:2},
    {stem:'At sea level, water boils at what temperature?', options:['50°C','90°C','100°C','120°C'], answer:2},
    {stem:'Which of these is a renewable source of energy?', options:['Coal','Petrol','Sunlight','Diesel'], answer:2},
    {stem:'How many teeth does a normal adult human have?', options:['28','30','32','36'], answer:2},
    {stem:'Which part of the plant absorbs water from the soil?', options:['Leaf','Stem','Root','Flower'], answer:2},
    {stem:'What is the process by which water changes into vapour?', options:['Condensation','Evaporation','Precipitation','Filtration'], answer:1},
  ],
  SOS: [
    {stem:'What is the capital city of Nigeria?', options:['Lagos','Kano','Abuja','Ibadan'], answer:2},
    {stem:'How many states are there in Nigeria?', options:['30','34','36','37'], answer:2},
    {stem:'In which year did Nigeria gain independence?', options:['1957','1960','1963','1970'], answer:1},
    {stem:'Which is the longest river in Nigeria?', options:['River Benue','River Niger','River Kaduna','River Ogun'], answer:1},
    {stem:'The Federal Capital Territory is located in which part of Nigeria?', options:['North East','North Central','South West','South East'], answer:1},
    {stem:'Who is the head of a local government area in Nigeria?', options:['Governor','Chairman','Senator','Commissioner'], answer:1},
    {stem:'Which of these is a civic responsibility of a citizen?', options:['Paying taxes','Owning a car','Travelling abroad','Watching television'], answer:0},
    {stem:'Which colour appears on the Nigerian flag alongside white?', options:['Blue','Red','Green','Yellow'], answer:2},
  ],
};

const ASSIGNMENT_SEED = [
  {title:'Simultaneous equations — practice set', sub:'s1', instructions:'Solve questions 1 to 12 on page 84 of New General Mathematics. Show all working.'},
  {title:'Comprehension: "The Village Headmaster"', sub:'s2', instructions:'Read the passage and answer all questions in complete sentences.'},
  {title:'Photosynthesis diagram', sub:'s3', instructions:'Draw and label a diagram showing the process of photosynthesis in a green leaf.'},
  {title:'Essay: My community', sub:'s2', instructions:'Write not less than 250 words describing your community and one thing you would change about it.'},
  {title:'Nigerian federalism — short notes', sub:'s4', instructions:'Write short notes on the three tiers of government in Nigeria.'},
  {title:'Laboratory report: separating mixtures', sub:'s3', instructions:'Write up the filtration and evaporation experiment carried out in class.'},
];

const LESSON_TOPICS = {
  s1:['Whole numbers and place value','Fractions and decimals','Simple equations','Plane shapes and perimeter','Statistics — bar charts'],
  s2:['Parts of speech','Comprehension strategies','Letter writing','Oral English — vowel sounds','Summary writing'],
  s3:['Living and non-living things','The human body systems','Energy and its forms','Simple machines','Environmental pollution'],
  s4:['Family and community','Culture and national values','Nigerian government structure','Rights and responsibilities','Social problems'],
  s5:['Citizenship','The constitution','Democracy and rule of law','National consciousness','Civic duties'],
  s7:['Measurement and units','Motion','Heat energy','Waves','Electricity'],
  s8:['Particulate nature of matter','Chemical symbols and formulae','Acids, bases and salts','The mole concept','Hydrocarbons'],
  s9:['Cell structure','Nutrition in plants','Transport systems','Reproduction','Ecology'],
};

/* ---------------------------------------------------------------- library --- */
const BOOK_SEED = [
  {title:'Things Fall Apart',              author:'Chinua Achebe',        cat:'Literature', copies:12},
  {title:'The Lion and the Jewel',         author:'Wole Soyinka',         cat:'Literature', copies:10},
  {title:'Purple Hibiscus',                author:'C. N. Adichie',        cat:'Literature', copies:8},
  {title:'New General Mathematics JSS 2',  author:'M. F. Macrae',         cat:'Mathematics',copies:40},
  {title:'New School Physics',             author:'M. W. Anyakoha',       cat:'Science',    copies:25},
  {title:'Essential Chemistry for SS',     author:'A. Ababio',            cat:'Science',    copies:22},
  {title:'Modern Biology for Senior Sec.', author:'S. T. Ramalingam',     cat:'Science',    copies:20},
  {title:'Countdown to WAEC English',      author:'Various',              cat:'Reference',  copies:30},
  {title:'Atlas of Nigeria',               author:'Macmillan',            cat:'Reference',  copies:6},
  {title:'Government for Senior Sec.',     author:'C. C. Dibie',          cat:'Social',     copies:15},
  {title:'Half of a Yellow Sun',           author:'C. N. Adichie',        cat:'Literature', copies:5},
  {title:'Basic Science for JSS',          author:'STAN',                 cat:'Science',    copies:35},
];

/* -------------------------------------------------------------- transport --- */
const ROUTE_SEED = [
  {name:'Route A — Kubwa Village',  stops:['Byazhin','Phase 4','Arab Road','School'],       fare:450_000},
  {name:'Route B — Dutse Alhaji',   stops:['Dutse Junction','Tipper Garage','School'],      fare:450_000},
  {name:'Route C — Gwarinpa',       stops:['3rd Avenue','1st Avenue','Life Camp','School'], fare:600_000},
  {name:'Route D — Bwari',          stops:['Bwari Park','Ushafa','School'],                 fare:600_000},
];

/* ----------------------------------------------------------------- hostel --- */
const HOSTEL_SEED = [
  {name:'Sapphire House', gender:'M', rooms:10, bedsPerRoom:6},
  {name:'Coral House',    gender:'F', rooms:10, bedsPerRoom:6},
];

/* -------------------------------------------------------------- inventory --- */
const ITEM_CATEGORIES = ['Stationery','Laboratory','ICT Equipment','Furniture','Uniform','Health','Utilities','Cleaning','Other'];
const INVENTORY_LOCATIONS = ['Main Store','Science Lab','ICT Lab','Admin Office','Classroom Store'];
const ITEM_SEED = [
  {name:'Exercise book, 80 leaves', unit:'piece',  reorder:200, cost:35_000,     cat:'Stationery',    kind:'CONSUMABLE'},
  {name:'Chalk, box of 100',        unit:'box',    reorder:30,  cost:120_000,    cat:'Stationery',    kind:'CONSUMABLE'},
  {name:'Whiteboard marker',        unit:'piece',  reorder:50,  cost:55_000,     cat:'Stationery',    kind:'CONSUMABLE'},
  {name:'School uniform, JSS',      unit:'set',    reorder:40,  cost:850_000,    cat:'Uniform',       kind:'CONSUMABLE'},
  {name:'School uniform, SS',       unit:'set',    reorder:40,  cost:920_000,    cat:'Uniform',       kind:'CONSUMABLE'},
  {name:'Sports jersey',            unit:'piece',  reorder:25,  cost:450_000,    cat:'Uniform',       kind:'CONSUMABLE'},
  {name:'Laboratory beaker, 250ml', unit:'piece',  reorder:20,  cost:180_000,    cat:'Laboratory',    kind:'CONSUMABLE'},
  {name:'First aid kit',            unit:'kit',    reorder:5,   cost:1_500_000,  cat:'Health',        kind:'CONSUMABLE'},
  {name:'Diesel, generator',        unit:'litre',  reorder:200, cost:130_000,    cat:'Utilities',     kind:'CONSUMABLE'},
  {name:'Toilet tissue, carton',    unit:'carton', reorder:15,  cost:750_000,    cat:'Cleaning',      kind:'CONSUMABLE'},
  {name:'Desktop computer',         unit:'unit',   reorder:2,   cost:25_000_000, cat:'ICT Equipment', kind:'ASSET'},
  {name:'Projector',                unit:'unit',   reorder:1,   cost:18_000_000, cat:'ICT Equipment', kind:'ASSET'},
  {name:'Microscope',               unit:'unit',   reorder:2,   cost:9_500_000,  cat:'Laboratory',    kind:'ASSET'},
  {name:'Student desk & chair set', unit:'set',    reorder:10,  cost:2_800_000,  cat:'Furniture',     kind:'ASSET'},
  {name:'Staff office chair',       unit:'piece',  reorder:3,   cost:3_500_000,  cat:'Furniture',     kind:'ASSET'},
];

const FIRST = {
  m:['Chinedu','Emeka','Ibrahim','Yusuf','Tunde','Segun','Abdul','Musa','Kelechi','Obinna','Bashir','Femi','Uche','Sadiq','Chukwudi','Daniel','Samuel','Idris','Nnamdi','Gbenga'],
  f:['Aisha','Ngozi','Fatima','Halima','Chioma','Amina','Blessing','Zainab','Adaeze','Funke','Hauwa','Ifeoma','Maryam','Temitope','Kemi','Grace','Rukayat','Oluchi','Bilkisu','Yetunde'],
};
const LAST = ['Okafor','Adeyemi','Bello','Musa','Eze','Balogun','Nwachukwu','Abubakar','Olawale','Ogunleye','Danjuma','Chukwu','Yakubu','Adebayo','Ibrahim','Salami','Obi','Suleiman','Aliyu','Okonkwo','Lawal','Nwosu','Garba','Ojo'];

// ------------------------------------------------------------------ roles ---
/* Twenty modules, nine actions, independently grantable — the shape a real
   permissions table would take (a row per role/module/action, not a role
   holding one bundled "can do admin stuff" flag). grant() is just the cross
   product of modules × verbs; GRANTS below is what a role actually holds,
   which is almost always a proper subset of what's possible.

   portal.view sits outside the grid on purpose: it isn't a record type, it's
   the personalised landing page teaching and family roles get instead of
   the admin dashboard. */

const MODULES = [
  'admissions','academics','timetable','students','attendance','examinations',
  'finance','payroll','hr','staff','library','transport','hostel','inventory',
  'communication','files','reports','settings','website','audit',
  'medical','behaviour',
];
const VERBS = ['view','create','edit','delete','approve','reject','export','print','restore'];
const PERMISSIONS = ['portal.view', ...MODULES.flatMap(m => VERBS.map(v => `${m}.${v}`))];

const grant = (modules, verbs) => modules.flatMap(m => verbs.map(v => `${m}.${v}`));

const ROLES = {
  SUPER_ADMIN:          {name:'Ikenna Obi',         title:'Super Administrator',        scope:'GLOBAL'},
  PROPRIETOR:           {name:'Folake Adeyemi',      title:'School Proprietor',          scope:'GLOBAL'},
  PRINCIPAL:            {name:'Grace Adeyemi',       title:'Principal',                  scope:'GLOBAL'},
  VICE_PRINCIPAL:       {name:'Ahmed Suleiman',      title:'Vice Principal',             scope:'GLOBAL'},
  ACADEMIC_COORDINATOR: {name:'Chiamaka Nwachukwu',  title:'Academic Coordinator',       scope:'GLOBAL'},
  BURSAR:               {name:'Emeka Okafor',        title:'Bursar',                     scope:'GLOBAL'},
  SECRETARY:            {name:'Blessing Yakubu',     title:'Secretary',                  scope:'GLOBAL'},
  REGISTRAR:            {name:'Tunde Salami',        title:'Registrar',                  scope:'GLOBAL'},
  ICT_ADMIN:            {name:'Yusuf Garba',         title:'ICT Administrator',          scope:'GLOBAL'},
  TEACHER:              {name:'Ngozi Okonkwo',       title:'Teacher',                    scope:'GLOBAL'},
  CLASS_TEACHER:        {name:'Halima Bello',        title:'Class Teacher · JSS 2 Gold', scope:'CLASS', classId:'c3'},
  SUBJECT_TEACHER:      {name:'Segun Aliyu',         title:'Subject Teacher',            scope:'GLOBAL'},
  LIBRARIAN:            {name:'Fatima Lawal',        title:'Librarian',                  scope:'GLOBAL'},
  TRANSPORT_OFFICER:    {name:'Musa Danjuma',        title:'Transport Officer',          scope:'GLOBAL'},
  HOSTEL_ADMIN:         {name:'Kemi Ojo',            title:'Hostel Administrator',       scope:'GLOBAL'},
  STORE_KEEPER:         {name:'Chukwudi Abubakar',   title:'Store Keeper',               scope:'GLOBAL'},
  INVENTORY_OFFICER:    {name:'Amina Olawale',       title:'Inventory Officer',          scope:'GLOBAL'},
  HR_MANAGER:           {name:'Uche Ogunleye',       title:'HR Manager',                 scope:'GLOBAL'},
  PARENT:               {name:'Ibrahim Musa',        title:'Parent',                     scope:'OWN_RECORDS'},
  STUDENT:              {name:'Fatima Musa',         title:'Student · JSS 2 Gold',       scope:'SELF'},
  RECEPTIONIST:         {name:'Bilkisu Chukwu',      title:'Receptionist',               scope:'GLOBAL'},
  SECURITY_OFFICER:     {name:'Sadiq Adebayo',       title:'Security Officer',           scope:'GLOBAL'},
};

const GRANTS = {
  // Full system control — every module, every action. The account IT would
  // actually lock away, not hand out for daily use.
  SUPER_ADMIN: ['portal.view', ...grant(MODULES, VERBS)],

  // Owns the school, not its day-to-day operation: sees and signs off on
  // everything, edits only the policy layer directly.
  PROPRIETOR: [
    ...grant(MODULES, ['view','export','print','approve','reject']),
    ...grant(['settings'], ['view','create','edit']),
  ],

  // Runs the school day to day. Full control of academic and administrative
  // modules; finance and payroll are approved here but entered by the Bursar.
  PRINCIPAL: [
    'portal.view',
    ...grant(['admissions','academics','timetable','students','attendance','examinations',
      'staff','communication','library','transport','hostel','inventory','files','reports','behaviour'],
      ['view','create','edit','approve','reject','export','print']),
    ...grant(['medical'], ['view','export','print']),
    ...grant(['finance'], ['view','create','approve','export','print']),
    ...grant(['payroll'], ['view','approve']),
    ...grant(['hr'], ['view','approve','reject']),
    ...grant(['settings','website'], ['view','edit']),
    ...grant(['audit'], ['view','export']),
  ],

  // Deputises for the Principal on the academic and pastoral side; no
  // finance, payroll or settings access.
  VICE_PRINCIPAL: [
    'portal.view',
    ...grant(['admissions','academics','timetable','students','attendance','examinations','staff','communication','library','behaviour'],
      ['view','create','edit','approve','export','print']),
    ...grant(['medical'], ['view']),
    ...grant(['hr'], ['view','approve']),
    ...grant(['reports'], ['view','export','print']),
  ],

  // Owns curriculum, timetabling and results — not personnel or money.
  ACADEMIC_COORDINATOR: [
    'portal.view',
    ...grant(['academics','timetable','examinations'], ['view','create','edit','approve','reject','export','print']),
    ...grant(['students','attendance'], ['view','export']),
    ...grant(['reports'], ['view','export','print']),
  ],

  // Owns money: full control of finance and payroll, approves both runs.
  BURSAR: [
    ...grant(['finance','payroll'], ['view','create','edit','approve','export','print']),
    ...grant(['students'], ['view']),
    ...grant(['inventory'], ['view','approve']),
    ...grant(['reports'], ['view','export','print']),
  ],

  // Front-of-house admin support: correspondence and light filing. Nothing
  // financial, academic or personnel.
  SECRETARY: [
    ...grant(['communication'], ['view','create','edit','print']),
    ...grant(['students','admissions'], ['view','create']),
    ...grant(['files'], ['view','create']),
    ...grant(['reports'], ['view','print']),
  ],

  // Owns the student record from application to enrolment.
  REGISTRAR: [
    ...grant(['admissions'], ['view','create','edit','approve','reject','export','print']),
    ...grant(['students'], ['view','create','edit','approve','export','print']),
    ...grant(['academics'], ['view','create']),
    ...grant(['timetable','examinations','attendance'], ['view']),
    ...grant(['communication','files'], ['view','create']),
    ...grant(['medical'], ['view','create','edit']),
    ...grant(['behaviour'], ['view']),
    ...grant(['reports'], ['view','export']),
  ],

  // Runs the systems everyone else's permissions depend on: full control of
  // settings, files and audit, plus restore everywhere — the one role a
  // botched migration or a wrongly deleted record actually gets escalated to.
  ICT_ADMIN: [
    ...grant(['settings','files'], ['view','create','edit','export','print']),
    ...grant(['audit'], ['view','export','print']),
    ...grant(['website'], ['view','create','edit']),
    ...grant(MODULES, ['restore']),
  ],

  // Baseline teaching rights, shared by every teaching role below.
  TEACHER: [
    'portal.view',
    ...grant(['academics','timetable'], ['view','create','edit']),
    ...grant(['examinations'], ['view','edit']),
    ...grant(['students','attendance','library'], ['view']),
    ...grant(['communication'], ['view','create']),
    ...grant(['behaviour'], ['view','create']),
  ],

  // Everything a Teacher has, plus ownership of one class's daily register
  // and its report cards — the CLASS scope below is what actually narrows
  // that to a single arm.
  CLASS_TEACHER: [
    'portal.view',
    ...grant(['academics','timetable'], ['view','create','edit']),
    ...grant(['examinations'], ['view','edit','print']),
    ...grant(['attendance'], ['view','create','approve']),
    ...grant(['students','library'], ['view']),
    ...grant(['communication'], ['view','create']),
    ...grant(['behaviour'], ['view','create','approve']),
    ...grant(['medical'], ['view']),
  ],

  // A Teacher's rights scoped to one subject across classes — no homeroom
  // register, since taking daily attendance isn't a subject teacher's job.
  SUBJECT_TEACHER: [
    'portal.view',
    ...grant(['academics'], ['view','create','edit']),
    ...grant(['examinations'], ['view','edit']),
    ...grant(['timetable','students'], ['view']),
    ...grant(['communication'], ['view','create']),
    ...grant(['behaviour'], ['view','create']),
  ],

  LIBRARIAN: [
    ...grant(['library'], ['view','create','edit','delete','approve','export','print','restore']),
    ...grant(['students'], ['view']),
  ],

  TRANSPORT_OFFICER: [
    ...grant(['transport'], ['view','create','edit','delete','export','print']),
    ...grant(['students'], ['view']),
  ],

  HOSTEL_ADMIN: [
    ...grant(['hostel'], ['view','create','edit','delete','export','print']),
    ...grant(['students'], ['view']),
  ],

  // Records day-to-day stock movement; can't delete history or authorise a
  // write-off — that split of duties is the whole reason both roles exist.
  STORE_KEEPER: [
    ...grant(['inventory'], ['view','create','edit','print']),
  ],

  // Supervises the store: everything a Store Keeper does, plus the
  // approvals, write-offs and recovery a keeper can't self-authorise.
  INVENTORY_OFFICER: [
    ...grant(['inventory'], ['view','create','edit','delete','approve','reject','export','print','restore']),
  ],

  // Staff records and leave, end to end. Payroll figures are visible for
  // coordination but owned by the Bursar.
  HR_MANAGER: [
    ...grant(['staff','hr'], ['view','create','edit','approve','reject','export','print']),
    ...grant(['payroll','attendance'], ['view']),
    ...grant(['reports'], ['view','export']),
  ],

  // A self-service account, not a staff seat — OWN_RECORDS scope narrows
  // every one of these to this parent's own children before the permission
  // is even checked.
  PARENT: [
    'portal.view',
    ...grant(['students','academics','timetable','examinations','attendance','medical','behaviour'], ['view']),
    ...grant(['communication'], ['view','create']),
    ...grant(['finance'], ['view','create']),
  ],

  // SELF scope narrows every one of these to the signed-in student's own
  // record.
  STUDENT: [
    'portal.view',
    ...grant(['students','academics','timetable','examinations','attendance','communication','library'], ['view']),
  ],

  RECEPTIONIST: [
    ...grant(['admissions','students'], ['view','create']),
    ...grant(['communication','files'], ['view','create']),
    ...grant(['transport'], ['view']),
  ],

  SECURITY_OFFICER: [
    ...grant(['students','staff','transport','attendance','communication'], ['view']),
  ],
};

/** One account per demo persona, all sharing a password so the login screen
    stays usable without a credential vault behind it. Swapping this for a
    real identity provider would not touch anything downstream — everything
    else keys off ROLES[session.role], never off the account itself. */
const AUTH_USERS = [
  {username:'superadmin@fadesrek.edu.ng',    password:'fadesrek2026', role:'SUPER_ADMIN'},
  {username:'proprietor@fadesrek.edu.ng',    password:'fadesrek2026', role:'PROPRIETOR'},
  {username:'principal@fadesrek.edu.ng',     password:'fadesrek2026', role:'PRINCIPAL'},
  {username:'viceprincipal@fadesrek.edu.ng', password:'fadesrek2026', role:'VICE_PRINCIPAL'},
  {username:'coordinator@fadesrek.edu.ng',   password:'fadesrek2026', role:'ACADEMIC_COORDINATOR'},
  {username:'bursar@fadesrek.edu.ng',        password:'fadesrek2026', role:'BURSAR'},
  {username:'secretary@fadesrek.edu.ng',     password:'fadesrek2026', role:'SECRETARY'},
  {username:'registrar@fadesrek.edu.ng',     password:'fadesrek2026', role:'REGISTRAR'},
  {username:'ictadmin@fadesrek.edu.ng',      password:'fadesrek2026', role:'ICT_ADMIN'},
  {username:'teacher@fadesrek.edu.ng',       password:'fadesrek2026', role:'TEACHER'},
  {username:'classteacher@fadesrek.edu.ng',  password:'fadesrek2026', role:'CLASS_TEACHER'},
  {username:'subjectteacher@fadesrek.edu.ng',password:'fadesrek2026', role:'SUBJECT_TEACHER'},
  {username:'librarian@fadesrek.edu.ng',     password:'fadesrek2026', role:'LIBRARIAN'},
  {username:'transport@fadesrek.edu.ng',     password:'fadesrek2026', role:'TRANSPORT_OFFICER'},
  {username:'hosteladmin@fadesrek.edu.ng',   password:'fadesrek2026', role:'HOSTEL_ADMIN'},
  {username:'storekeeper@fadesrek.edu.ng',   password:'fadesrek2026', role:'STORE_KEEPER'},
  {username:'inventory@fadesrek.edu.ng',     password:'fadesrek2026', role:'INVENTORY_OFFICER'},
  {username:'hrmanager@fadesrek.edu.ng',     password:'fadesrek2026', role:'HR_MANAGER'},
  {username:'parent@fadesrek.edu.ng',        password:'fadesrek2026', role:'PARENT'},
  {username:'student@fadesrek.edu.ng',       password:'fadesrek2026', role:'STUDENT'},
  {username:'receptionist@fadesrek.edu.ng',  password:'fadesrek2026', role:'RECEPTIONIST'},
  {username:'security@fadesrek.edu.ng',      password:'fadesrek2026', role:'SECURITY_OFFICER'},
];

const can = key => GRANTS[state.role].includes(key);
const canAny = perm => Array.isArray(perm) ? perm.some(can) : can(perm);

// A NAV entry's gate (nav[3]) is normally a permission string or an array of
// them; it may also be a predicate function for access that isn't a single
// catalogue permission — e.g. the Admin Panel, which is role-restricted
// rather than permission-gated.
const navAllowed = perm => !perm || (typeof perm === 'function' ? !!perm() : canAny(perm));

// ------------------------------------------------------------- accounts ----
// Who may open the Admin Panel at all, and who may actually approve a
// pending account. Creation is delegated to the onboarding roles; the
// approval gate stays with the Super Administrator alone, as the brief asks.
const ACCOUNT_ADMIN_ROLES = ['SUPER_ADMIN', 'ICT_ADMIN', 'HR_MANAGER', 'PRINCIPAL'];
const canAdminAccounts   = () => ACCOUNT_ADMIN_ROLES.includes(state.role);
const canApproveAccounts = () => state.role === 'SUPER_ADMIN';

// The Admin Panel now also hosts the audit trail and the permissions matrix
// as tabs (they used to be their own sidebar pages). Each tab keeps its own
// gate, so the panel is reachable by anyone who can see at least one tab.
const canOpenAdminPanel = () => canAdminAccounts() || can('audit.view') || can('settings.view');

// Roles an account profile can be created against, split the way the create
// form splits them. SUPER_ADMIN / PROPRIETOR are deliberately not mintable
// from a form; PARENT / STUDENT are self-service, not staff seats.
const ADMIN_ACCOUNT_ROLES = ['PRINCIPAL','VICE_PRINCIPAL','ACADEMIC_COORDINATOR','BURSAR','SECRETARY',
  'REGISTRAR','ICT_ADMIN','HR_MANAGER','LIBRARIAN','TRANSPORT_OFFICER','HOSTEL_ADMIN','STORE_KEEPER',
  'INVENTORY_OFFICER','RECEPTIONIST','SECURITY_OFFICER'];
const TEACHING_ACCOUNT_ROLES = ['TEACHER','CLASS_TEACHER','SUBJECT_TEACHER'];
const ACCOUNT_DEPARTMENTS = ['Administration','Academic','Finance','Operations','ICT','Library','Health'];
const rolesForCategory = cat => cat === 'TEACHING' ? TEACHING_ACCOUNT_ROLES : ADMIN_ACCOUNT_ROLES;

const ACCT_STATUS_PILL = { PENDING:'p-warn', ACTIVE:'p-ok', REJECTED:'p-bad', SUSPENDED:'p-mute' };

const slugEmail = (first, last) => {
  const f = String(first).trim().toLowerCase().replace(/[^a-z]/g,'');
  const l = String(last).trim().toLowerCase().replace(/[^a-z]/g,'');
  return `${f}.${l}@fadesrek.edu.ng`.replace(/^\.+/,'').replace(/\.+@/,'@');
};

/** Demo-grade credential. The whole app keeps passwords in plain text
    (AUTH_USERS), so a temporary password stored on the account record is
    consistent with that — a real system would email a reset link and store
    only a hash. */
const tempPassword = () => 'FA-' + Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 6);

/** Makes an approved account able to actually sign in: adds it to AUTH_USERS
    (if not already there) so it appears on the login screen and Auth.login
    accepts it. Called on approve and on boot re-hydration. */
function provisionLogin(acct){
  if(!acct.credential || acct.status !== 'ACTIVE') return;
  const existing = AUTH_USERS.find(u => u.username === acct.email);
  if(existing){ existing.password = acct.credential; existing.role = acct.roleKey; }
  else AUTH_USERS.push({ username: acct.email, password: acct.credential, role: acct.roleKey });
}
function deprovisionLogin(email){
  const i = AUTH_USERS.findIndex(u => u.username === email);
  if(i > -1) AUTH_USERS.splice(i, 1);
}

/** Scope becomes a filter over the data, not a hidden button. A class teacher
    querying another arm gets an empty set, exactly as the API would return. */
function visibleStudents(){
  const r = ROLES[state.role];
  if(r.scope === 'CLASS')       return db.students.filter(s => s.classId === r.classId && s.status==='ACTIVE');
  if(r.scope === 'OWN_RECORDS') return db.students.filter(s => r.childIds.includes(s.id));
  if(r.scope === 'SELF')        return db.students.filter(s => s.id === r.studentId);
  return db.students.filter(s => s.status !== 'DELETED');
}

// ------------------------------------------------------------------- seed ---

const db = { students:[], staff:[], applications:[], attendance:{}, staffAttendance:{}, scores:{}, payments:[],
  notices:[], ledger:[], leave:[], timetable:{}, books:[], borrowings:[], reservations:[], routes:[],
  transportAlloc:[], vehicles:[], drivers:[], maintenanceLogs:[], fuelLogs:[],
  hostels:[], items:[], movements:[], suppliers:[], purchaseOrders:[], payrollRuns:[], messages:[], messageThreads:[], emergencyAlerts:[],
  lessonPlans:[], assignments:[], submissions:[],
  cbtExams:[], cbtQuestions:[], cbtAttempts:[], photos:{},
  pages:[], posts:[], events:[], gallery:[], mediaLibrary:[], testimonials:[], enquiries:[],
  auditLog:[], notifications:[], files:[], accounts:[],
  guardians:[], medicalProfiles:{}, medicalVisits:[], behaviourIncidents:[],
  promotions:[], graduations:[], transfers:[], withdrawals:[],
  certificates:[], studentDocuments:[], biometrics:[], timelineEvents:[],
  feeItems:[], scholarships:[], discounts:[], installmentPlans:[],
  income:[], expenses:[], budgets:[], reconciledRefs:[] };

function seed(){
  // fee structure — a mutable copy of FEE_ITEMS, since Settings needs to
  // edit it. The constant stays as the factory default the copy starts from.
  db.feeItems = FEE_ITEMS.map(f=>({...f}));

  // students -----------------------------------------------------------
  let n = 0;
  const counts = {c1:34,c2:32,c3:38,c4:35,c5:31,c6:24,c7:19,c8:22,c9:18};
  for(const c of CLASSES){
    for(let i=0;i<counts[c.id];i++){
      const gender = rng() > .48 ? 'F' : 'M';
      const first = pick(gender==='F'?FIRST.f:FIRST.m);
      const last = pick(LAST);
      n++;
      const boarder = rng() > .72;
      const transport = !boarder && rng() > .68;
      db.students.push({
        id:'st'+n,
        admissionNo:`FA/${2020+Math.floor(rng()*6)}/${String(n).padStart(4,'0')}`,
        firstName:first, lastName:last, gender,
        dob:`${2008+Math.floor(rng()*6)}-${String(between(1,12)).padStart(2,'0')}-${String(between(1,28)).padStart(2,'0')}`,
        classId:c.id, boarder, transport,
        guardian:`${pick(rng()>.5?FIRST.m:FIRST.f)} ${last}`,
        guardianPhone:`080${between(10000000,99999999)}`,
        status:'ACTIVE',
        enrolledOn:'2026-09-14',
      });
    }
  }

  // the parent's own children, so OWN_RECORDS scope has something real -----
  const musaKids = db.students.filter(s => s.lastName==='Musa').slice(0,2);
  if(musaKids.length < 2){
    db.students[5].lastName='Musa'; db.students[5].guardian='Ibrahim Musa';
    db.students[40].lastName='Musa'; db.students[40].guardian='Ibrahim Musa';
    ROLES.PARENT.childIds=[db.students[5].id, db.students[40].id];
  } else {
    musaKids.forEach(k=>k.guardian='Ibrahim Musa');
    ROLES.PARENT.childIds = musaKids.map(k=>k.id);
  }

  // staff ---------------------------------------------------------------
  // One teacher per class as class teacher, plus subject specialists. Nine
  // classes running concurrently need at least nine teachers free in every
  // period, or the timetable cannot be staffed at all.
  const posts = ['Principal','Vice Principal','Academic Coordinator',
    ...Array(9).fill('Class Teacher'),
    ...Array(14).fill('Subject Teacher'),
    'Bursar','Accountant','Registrar','Secretary','Librarian','Store Keeper',
    'Transport Officer','Hostel Administrator','ICT Administrator','Receptionist',
    'Security Officer','Nurse'];
  posts.forEach((p,i)=>{
    const gender = rng()>.5?'F':'M';
    db.staff.push({
      id:'sf'+(i+1), staffNo:`FA/STF/${String(i+1).padStart(3,'0')}`,
      firstName:pick(gender==='F'?FIRST.f:FIRST.m), lastName:pick(LAST),
      gender, position:p,
      department: /Teacher/.test(p)?'Academic': /Bursar|Store/.test(p)?'Finance':'Administration',
      phone:`080${between(10000000,99999999)}`, status:'ACTIVE',
      trcn: /Teacher|Principal/.test(p) ? `TRCN/${between(100000,999999)}` : null,
    });
  });
  const seat = (pos, first, last) => {
    const m = db.staff.find(x=>x.position===pos);
    if(m){ m.firstName=first; m.lastName=last; }
  };
  seat('Principal','Grace','Adeyemi');
  seat('Bursar','Emeka','Okafor');
  seat('Registrar','Tunde','Salami');
  seat('Class Teacher','Halima','Bello');

  // user accounts -----------------------------------------------------
  // One account profile per staff seat that maps to a system role, plus a
  // short queue of pending requests for the Admin Panel's approval flow.
  const POSITION_ROLE = {
    'Principal':'PRINCIPAL', 'Vice Principal':'VICE_PRINCIPAL', 'Academic Coordinator':'ACADEMIC_COORDINATOR',
    'Class Teacher':'CLASS_TEACHER', 'Subject Teacher':'SUBJECT_TEACHER', 'Bursar':'BURSAR',
    'Accountant':'BURSAR', 'Registrar':'REGISTRAR', 'Secretary':'SECRETARY', 'Librarian':'LIBRARIAN',
    'Store Keeper':'STORE_KEEPER', 'Transport Officer':'TRANSPORT_OFFICER',
    'Hostel Administrator':'HOSTEL_ADMIN', 'ICT Administrator':'ICT_ADMIN',
    'Receptionist':'RECEPTIONIST', 'Security Officer':'SECURITY_OFFICER',
  };
  const emailTaken = new Set();
  const uniqueEmail = (first, last) => {
    const base = slugEmail(first, last);
    if(!emailTaken.has(base)){ emailTaken.add(base); return base; }
    let n = 2, tryEmail;
    do { tryEmail = base.replace('@', `${n++}@`); } while(emailTaken.has(tryEmail));
    emailTaken.add(tryEmail); return tryEmail;
  };
  db.staff.forEach(m=>{
    const roleKey = POSITION_ROLE[m.position];
    if(!roleKey) return; // Nurse and anything else without a seat in ROLES
    const category = TEACHING_ACCOUNT_ROLES.includes(roleKey) ? 'TEACHING' : 'ADMIN';
    db.accounts.push({
      id:uid('acc'), staffId:m.id, firstName:m.firstName, lastName:m.lastName,
      email:uniqueEmail(m.firstName, m.lastName), phone:m.phone,
      category, roleKey, department:m.department,
      trcn: category==='TEACHING' ? m.trcn : null, subjectIds:[],
      status:'ACTIVE', credential:null, note:'',
      requestedBy:'System', requestedByRole:null, requestedAt:'2026-08-01T08:00:00.000Z',
      decidedBy:'Ikenna Obi', decidedByRole:'SUPER_ADMIN', decidedAt:'2026-08-01T09:30:00.000Z', decisionNote:'Migrated from the previous staff register.',
    });
  });
  // Pending requests waiting on the Super Administrator.
  const pendingSeed = [
    ['Adaeze','Nwosu','TEACHING','SUBJECT_TEACHER','Academic','TRCN/508841', 'Chemistry cover for SS 1–3 from the new term.', 'HR_MANAGER','Uche Ogunleye'],
    ['Bello','Sadiq','ADMIN','TRANSPORT_OFFICER','Operations',null, 'Second transport officer for the Kubwa and Gwarinpa routes.', 'PRINCIPAL','Grace Adeyemi'],
    ['Ngozi','Umeh','TEACHING','CLASS_TEACHER','Academic','TRCN/771230', 'Class teacher for the incoming JSS 1 Silver arm.', 'ICT_ADMIN','Yusuf Garba'],
  ];
  pendingSeed.forEach(([first,last,category,roleKey,department,trcn,note,byRole,byName],i)=>{
    db.accounts.push({
      id:uid('acc'), staffId:null, firstName:first, lastName:last,
      email:uniqueEmail(first,last), phone:`080${between(10000000,99999999)}`,
      category, roleKey, department, trcn, subjectIds:[],
      status:'PENDING', credential:null, note,
      requestedBy:byName, requestedByRole:byRole,
      requestedAt:new Date(Date.now() - (i+1)*36e5).toISOString(),
      decidedBy:null, decidedByRole:null, decidedAt:null, decisionNote:'',
    });
  });

  // admissions ----------------------------------------------------------
  const stages=['SUBMITTED','PAYMENT_CONFIRMED','UNDER_REVIEW','SHORTLISTED','EXAM_TAKEN','INTERVIEWED','OFFERED'];
  for(let i=0;i<24;i++){
    const gender = rng()>.5?'F':'M';
    db.applications.push({
      id:'ap'+(i+1), ref:`FA/ADM/2026/${String(i+1).padStart(3,'0')}`,
      firstName:pick(gender==='F'?FIRST.f:FIRST.m), lastName:pick(LAST), gender,
      dob:`${2012+Math.floor(rng()*3)}-${String(between(1,12)).padStart(2,'0')}-${String(between(1,28)).padStart(2,'0')}`,
      applyingFor: rng()>.3 ? 'JSS 1' : 'SS 1',
      guardian:`${pick(rng()>.5?FIRST.m:FIRST.f)} ${pick(LAST)}`,
      guardianPhone:`080${between(10000000,99999999)}`,
      previousSchool:pick(['Bright Star Academy, Kubwa','Government Primary School, Dutse','Little Angels Nursery & Primary','Faith Foundation School, Bwari','Model Primary School, Gwarinpa']),
      stage:pick(stages),
      examScore: null,
      submittedOn:`2026-07-${String(between(10,31)).padStart(2,'0')}`,
      feePaid: true,
    });
  }
  db.applications.forEach(a=>{
    if(['EXAM_TAKEN','INTERVIEWED','OFFERED'].includes(a.stage)) a.examScore = between(38,94);
  });

  // scores: one row per student × subject × component --------------------
  for(const s of db.students){
    const c = CLASSES.find(x=>x.id===s.classId);
    // A stable per-student tendency, then per-subject variation around it.
    // Centred so class top averages land in the low-to-mid 80s: a seeded school
    // where every class has a 95% student is not a school anyone recognises.
    const ability = 0.32 + rng()*0.45;
    for(const sub of subjectsFor(c)){
      const key = `${s.id}:${sub.id}`;
      const jitter = () => Math.max(0.05, Math.min(0.98, ability + (rng()-0.5)*0.26));
      db.scores[key] = {
        ca1: Math.round(jitter()*10),
        ca2: Math.round(jitter()*10),
        asg: Math.round(jitter()*10),
        exam:Math.round(jitter()*70),
      };
    }
  }

  // fees: one invoice per student, some paid in part -----------------------------
  for(const s of db.students){
    const billed = feeItemsFor(s).reduce((t,f)=>t+f.amount,0);
    const roll = rng();
    let paid = 0;
    if(roll > .55) paid = billed;
    else if(roll > .28) paid = Math.round(billed * (0.4+rng()*0.4) / 100000)*100000;
    else if(roll > .12) paid = Math.round(billed * (0.1+rng()*0.2) / 100000)*100000;
    if(paid > 0){
      db.payments.push({
        id:uid('pay'), studentId:s.id, amount:paid,
        method: pick(['PAYSTACK','BANK_TRANSFER','FLUTTERWAVE','CASH']),
        ref:`RCP/2026/${String(db.payments.length+1).padStart(5,'0')}`,
        at:`2026-07-${String(between(1,31)).padStart(2,'0')}`, reversed:false,
      });
    }
  }

  // scholarships, discounts, installment plans — awarded to students who
  // still carry a balance, so an award never has to explain away a payment
  // that already settled the old, undiscounted bill.
  {
    const owing = db.students.filter(s=>{
      const gross = feeItemsFor(s).reduce((t,f)=>t+f.amount,0);
      const paid = db.payments.filter(p=>p.studentId===s.id).reduce((t,p)=>t+p.amount,0);
      return gross - paid > 0;
    });
    const shuffled = [...owing].sort(()=>rng()-0.5);

    shuffled.slice(0,3).forEach(s=>{
      db.scholarships.push({id:uid('sch'), studentId:s.id, percent:pick([25,50,100]),
        reason:pick(['Merit — top of class, First Term','Academic excellence award','Sports scholarship — inter-house athletics','Need-based bursary']),
        awardedOn:'2026-07-10', awardedBy:'Grace Adeyemi'});
    });
    shuffled.slice(3,6).forEach(s=>{
      db.discounts.push({id:uid('disc'), studentId:s.id, amount:between(5,20)*100000,
        reason:pick(['Sibling discount','Early payment discount','Staff ward discount']),
        appliedOn:'2026-07-12', appliedBy:'Emeka Okafor'});
    });
    shuffled.slice(6,8).forEach(s=>{
      const gross = feeItemsFor(s).reduce((t,f)=>t+f.amount,0);
      const paid = db.payments.filter(p=>p.studentId===s.id).reduce((t,p)=>t+p.amount,0);
      const balance = gross - paid;
      const per = Math.floor(balance/3);
      const items = [];
      let d = new Date('2026-08-01T00:00:00');
      for(let i=0;i<3;i++){
        const amount = i===2 ? balance-per*2 : per;
        items.push({seq:i+1, label:`Installment ${i+1} of 3`, amount, dueDate:d.toISOString().slice(0,10)});
        d.setDate(d.getDate()+30);
      }
      db.installmentPlans.push({id:uid('plan'), studentId:s.id, term:TERM, session:SESSION, items, createdOn:'2026-07-15', createdBy:'Emeka Okafor'});
    });
  }

  // non-fee income and expenses — a modest scatter across the term so the
  // cashbook and financial reports aren't staring at an empty table.
  {
    const incomeSeed = [
      ['Donation','PTA end-of-term donation', 45000000],
      ['Facility rental','Hall rented for a weekend wedding', 15000000],
      ['Sundry income','Sale of old furniture', 6000000],
      ['Investment income','Interest on fixed deposit', 9000000],
    ];
    incomeSeed.forEach(([category,description,amount],i)=>{
      const ref = `INC/2026/${String(i+1).padStart(5,'0')}`;
      const at = `2026-07-${String(between(1,31)).padStart(2,'0')}`;
      db.income.push({id:uid('inc'), category, description, amount, at, ref, recordedBy:'Emeka Okafor'});
      db.ledger.push({journalRef:ref, debit:'CASH_AT_BANK', credit:'OTHER_INCOME', amount, at});
    });

    const expenseSeed = [
      ['Utilities','PHCN electricity bill, July', 18000000, 'APPROVED'],
      ['Maintenance & repairs','Plumbing repairs, hostel block B', 9500000, 'APPROVED'],
      ['Teaching materials','Textbooks — JSS science lab', 22000000, 'APPROVED'],
      ['Transport & fuel','Diesel for the school bus fleet', 14000000, 'APPROVED'],
      ['Administrative','Office stationery and printing', 4200000, 'APPROVED'],
      ['Utilities','Generator diesel, August', 8000000, 'PENDING'],
      ['Maintenance & repairs','Painting — admin block', 12000000, 'PENDING'],
    ];
    expenseSeed.forEach(([category,description,amount,status],i)=>{
      const ref = `EXP/2026/${String(i+1).padStart(5,'0')}`;
      const at = `2026-07-${String(between(1,31)).padStart(2,'0')}`;
      db.expenses.push({id:uid('exp'), category, description, amount, at, ref, status, recordedBy:'Emeka Okafor'});
      if(status==='APPROVED') db.ledger.push({journalRef:ref, debit:'EXPENSE', credit:'CASH_AT_BANK', amount, at});
    });

    // one budget line per expense category
    EXPENSE_CATEGORIES.forEach(cat=>{
      db.budgets.push({id:uid('bud'), category:cat, allocated:between(30,90)*1000000, term:TERM, session:SESSION});
    });

    // the earliest fee receipts are already reconciled against last month's
    // bank statement.
    db.reconciledRefs = db.payments.slice(0, Math.floor(db.payments.length*0.3)).map(p=>p.ref);
  }

  // attendance for today, pre-marked for a few classes -------------------
  for(const c of ['c1','c3','c6']){
    const roll = {};
    db.students.filter(s=>s.classId===c).forEach(s=>{ roll[s.id] = rng()>.06 ? 'PRESENT' : (rng()>.5?'ABSENT':'LATE'); });
    db.attendance[`${todayISO()}:${c}`] = {markedBy:'Seeded', markedAt:'07:45', roll};
  }

  // staff attendance for today — one roll for the whole school, not split
  // by department, since a school day starts with the same gate for everyone.
  {
    const roll = {};
    db.staff.filter(m=>m.status==='ACTIVE').forEach(m=>{ roll[m.id] = rng()>.05 ? 'PRESENT' : (rng()>.5?'ABSENT':'LATE'); });
    db.staffAttendance[todayISO()] = {markedBy:'Seeded', markedAt:'07:40', roll};
  }

  // salaries -------------------------------------------------------------
  const gradeFor = pos =>
    /^Principal/.test(pos) ? 'g1' : /Vice Principal/.test(pos) ? 'g2' :
    /Bursar|Registrar|ICT/.test(pos) ? 'g3' : /Class Teacher/.test(pos) ? 'g4' :
    /Teacher/.test(pos) ? 'g5' : /Librarian|Officer|Administrator/.test(pos) ? 'g6' : 'g7';
  db.staff.forEach(m => {
    m.gradeId = gradeFor(m.position);
    // Rent is declared by the employee; relief only applies with evidence.
    m.annualRent = rng() > .35 ? between(6,25)*100_000_00 : 0;
    m.bank = pick(BANKS);
    m.accountNo = String(between(1000000000,9999999999));
    m.pfa = pick(PFAS);
  });

  // leave requests --------------------------------------------------------
  for(let i=0;i<9;i++){
    const m = pick(db.staff);
    db.leave.push({
      id:'lv'+(i+1), staffId:m.id, type:pick(LEAVE_TYPES),
      from:`2026-0${between(8,9)}-${String(between(1,28)).padStart(2,'0')}`,
      days:between(2,14), reason:pick(['Family matter','Medical appointment','Personal','Further studies','Bereavement']),
      status:pick(['PENDING','PENDING','APPROVED','DECLINED']),
    });
  }

  // timetable -------------------------------------------------------------
  // Built by walking each class and assigning teachers, refusing any slot
  // where the teacher is already booked. Conflicts are prevented at write
  // time rather than reported afterwards.
  const teachers = db.staff.filter(m=>/Teacher|Principal/.test(m.position));
  const busy = {};   // `${day}:${period}:${teacherId}` -> true
  for(const c of CLASSES){
    const subs = subjectsFor(c);
    let si = 0;
    for(const day of DAYS){
      for(const per of PERIODS){
        if(per.isBreak) continue;
        const sub = subs[si % subs.length]; si++;
        const free = teachers.filter(t => !busy[`${day}:${per.id}:${t.id}`]);
        if(!free.length) continue;
        const teacher = free[Math.floor(rng()*free.length)];
        busy[`${day}:${per.id}:${teacher.id}`] = true;
        db.timetable[`${c.id}:${day}:${per.id}`] = {subjectId:sub.id, staffId:teacher.id, room:`Rm ${between(1,18)}`};
      }
    }
  }

  // library ---------------------------------------------------------------
  BOOK_SEED.forEach((b,i)=>{
    db.books.push({id:'bk'+(i+1), isbn:`978-${between(100,999)}-${between(1000,9999)}-${between(10,99)}-${between(0,9)}`,
      barcode:`FA-LIB-${String(i+1).padStart(6,'0')}`, ...b, available:b.copies});
  });
  for(let i=0;i<26;i++){
    const bk = pick(db.books);
    if(bk.available <= 0) continue;
    const st = pick(db.students);
    const out = `2026-07-${String(between(1,28)).padStart(2,'0')}`;
    const due = new Date(new Date(out).getTime() + 14*86400000).toISOString().slice(0,10);
    const returned = rng() > .45;
    if(!returned) bk.available--;
    const returnedOn = returned ? `2026-07-${String(between(15,31)).padStart(2,'0')}` : null;
    // A late return's fine is frozen at return time — that's what makes it
    // collectible afterwards, rather than vanishing the moment the book is
    // no longer overdue.
    let fineAmount = 0, fineStatus = 'NONE';
    if(returned && returnedOn > due){
      const days = Math.round((new Date(returnedOn)-new Date(due))/86400000);
      fineAmount = Math.min(days*5000, 500000);
      fineStatus = pick(['OWED','OWED','PAID']);
    }
    db.borrowings.push({id:'bw'+(i+1), bookId:bk.id, studentId:st.id, out, due, returnedOn, fineAmount, fineStatus});
    if(fineStatus==='PAID'){
      const ref = `INC/2026/${String(db.income.length+1).padStart(5,'0')}`;
      db.income.push({id:uid('inc'), category:'Library fines', description:`Fine — ${bk.title}`,
        amount:fineAmount, at:returnedOn, ref, recordedBy:'Fatima Lawal'});
    }
  }
  // reservations — a hold or two on titles that are fully checked out
  db.books.filter(b=>b.available===0).slice(0,2).forEach(bk=>{
    const st = pick(db.students.filter(s=>!db.borrowings.some(b=>b.bookId===bk.id && b.studentId===s.id && !b.returnedOn)));
    if(st) db.reservations.push({id:uid('res'), bookId:bk.id, studentId:st.id, reservedOn:'2026-07-20', status:'WAITING'});
  });

  // transport ---------------------------------------------------------------
  // Vehicles and drivers are normalized records now, not strings baked into
  // the route — a route just points at whichever of each is on duty for it.
  const VEH_MODELS = ['Toyota Hiace','Toyota Coaster','Nissan Urvan','Toyota Hiace'];
  db.vehicles.push(...[0,1,2,3].map(i=>({
    id:'veh'+(i+1),
    plate:`${['ABC','KUJ','FKJ','GWA'][i]}-${between(100,999)}${['XA','KB','ZC','MD'][i]}`,
    model:VEH_MODELS[i], capacity:pick([25,30,35]), condition:'ACTIVE',
    vioExpiry:`2027-0${between(1,9)}-${String(between(1,28)).padStart(2,'0')}`,
  })));
  db.drivers.push(...[0,1,2,3].map(i=>({
    id:'drv'+(i+1), name:`${pick(FIRST.m)} ${pick(LAST)}`, phone:`080${between(10000000,99999999)}`,
    licenseNo:`FCT/DL/${between(100000,999999)}`,
    licenseExpiry:`2027-0${between(1,9)}-${String(between(1,28)).padStart(2,'0')}`, status:'ACTIVE',
  })));
  ROUTE_SEED.forEach((r,i)=>{
    db.routes.push({id:'rt'+(i+1), ...r, vehicleId:db.vehicles[i].id, driverId:db.drivers[i].id});
  });
  db.students.filter(s=>s.transport).forEach(s=>{
    const r = pick(db.routes);
    db.transportAlloc.push({studentId:s.id, routeId:r.id, stop:pick(r.stops.slice(0,-1))});
  });

  // a service and a fuel fill for each vehicle, so Maintenance and Fuel
  // aren't staring at an empty table — one vehicle's service is still due.
  db.vehicles.forEach((v,i)=>{
    const done = i>0;
    const cost = between(15,45)*100000;
    db.maintenanceLogs.push({id:uid('mnt'), vehicleId:v.id, type:pick(['Service','Tyres','Inspection']),
      description:pick(['Routine service — oil, filters, brake check','New tyres, front axle','Annual roadworthiness inspection']),
      cost, date:done?`2026-07-${String(between(1,25)).padStart(2,'0')}`:todayISO(), status:done?'DONE':'DUE'});
    if(done){
      const ref = `EXP/2026/${String(db.expenses.length+1).padStart(5,'0')}`;
      db.expenses.push({id:uid('exp'), category:'Maintenance & repairs', description:`Vehicle service — ${v.plate}`,
        amount:cost, at:`2026-07-${String(between(1,25)).padStart(2,'0')}`, ref, status:'APPROVED', recordedBy:'Musa Danjuma'});
    }
    const litres = between(40,80), fuelCost = litres*70000;
    db.fuelLogs.push({id:uid('fuel'), vehicleId:v.id, date:`2026-07-${String(between(1,28)).padStart(2,'0')}`,
      litres, cost:fuelCost, odometer:between(30000,90000), recordedBy:'Musa Danjuma'});
    const ref2 = `EXP/2026/${String(db.expenses.length+1).padStart(5,'0')}`;
    db.expenses.push({id:uid('exp'), category:'Transport & fuel', description:`Fuel — ${v.plate} (${litres}L)`,
      amount:fuelCost, at:`2026-07-${String(between(1,28)).padStart(2,'0')}`, ref:ref2, status:'APPROVED', recordedBy:'Musa Danjuma'});
  });

  // hostel ----------------------------------------------------------------
  HOSTEL_SEED.forEach((h,hi)=>{
    const hostel = {id:'h'+(hi+1), ...h, rooms:[]};
    for(let r=1;r<=h.rooms;r++){
      const room = {id:`h${hi+1}r${r}`, number:`${h.name[0]}${String(r).padStart(2,'0')}`, beds:[]};
      for(let b=1;b<=h.bedsPerRoom;b++) room.beds.push({id:`h${hi+1}r${r}b${b}`, label:`${room.number}/${b}`, studentId:null});
      hostel.rooms.push(room);
    }
    db.hostels.push(hostel);
  });
  db.students.filter(s=>s.boarder).forEach(s=>{
    const hostel = db.hostels.find(h=>h.gender===s.gender);
    if(!hostel) return;
    for(const room of hostel.rooms){
      const bed = room.beds.find(b=>!b.studentId);
      if(bed){ bed.studentId = s.id; break; }
    }
  });

  // inventory -------------------------------------------------------------
  const LOC_FOR_CAT = {'ICT Equipment':'ICT Lab', Laboratory:'Science Lab', Furniture:'Admin Office'};
  ITEM_SEED.forEach((it,i)=>{
    const qty = between(0, it.reorder*3);
    db.items.push({id:'it'+(i+1), sku:`FA-${String(i+1).padStart(4,'0')}`,
      barcode:`FA-INV-${String(i+1).padStart(6,'0')}`, qrCode:`QR-FA-${String(i+1).padStart(6,'0')}`,
      location:LOC_FOR_CAT[it.cat]||'Main Store', ...it, qty});
    db.movements.push({id:uid('mv'), itemId:'it'+(i+1), kind:'RECEIPT', qty,
      at:`2026-07-${String(between(1,28)).padStart(2,'0')}`, note:'Opening stock', by:'Store Keeper'});
  });

  // suppliers ---------------------------------------------------------------
  db.suppliers.push(
    {id:'sup1', name:'Bookworm Educational Supplies', contact:'Adaeze Nwosu', phone:'08023456781', email:'sales@bookworm.ng', category:'Stationery', status:'ACTIVE'},
    {id:'sup2', name:'Kaduna Furniture Works',         contact:'Ibrahim Sule', phone:'08034567892', email:'orders@kadunafurniture.ng', category:'Furniture', status:'ACTIVE'},
    {id:'sup3', name:'CompuTech Nigeria Ltd',          contact:'Chidi Eze',    phone:'08045678903', email:'info@computech.ng', category:'ICT Equipment', status:'ACTIVE'},
    {id:'sup4', name:'SciLab Equipment Co.',           contact:'Fatima Bello', phone:'08056789014', email:'sales@scilab.ng', category:'Laboratory', status:'ACTIVE'},
  );

  // purchase orders — one awaiting approval, one already ordered and
  // awaiting delivery, so both live actions (approve, receive) have
  // something to act on rather than starting from an empty table.
  db.purchaseOrders.push(
    {id:uid('po'), poNumber:'PO/2026/00001', supplierId:'sup1',
      items:[{itemId:'it1',qty:500,unitCost:35000},{itemId:'it3',qty:100,unitCost:55000}],
      status:'DRAFT', orderedOn:null, expectedDate:'2026-08-20', createdBy:'Chukwudi Abubakar', approvedBy:null},
    {id:uid('po'), poNumber:'PO/2026/00002', supplierId:'sup3',
      items:[{itemId:'it11',qty:2,unitCost:25000000}],
      status:'ORDERED', orderedOn:'2026-08-01', expectedDate:'2026-08-15', createdBy:'Chukwudi Abubakar', approvedBy:'Amina Olawale'},
  );

  // lesson plans ----------------------------------------------------------
  const teachStaff = db.staff.filter(m=>/Teacher|Coordinator/.test(m.position));
  let lpn = 0;
  for(const c of CLASSES){
    for(const sub of subjectsFor(c).slice(0,4)){
      const topics = LESSON_TOPICS[sub.id];
      if(!topics) continue;
      for(let wk=1; wk<=3; wk++){
        lpn++;
        db.lessonPlans.push({
          id:'lp'+lpn, classId:c.id, subjectId:sub.id,
          staffId:pick(teachStaff).id, week:wk,
          topic:topics[(wk-1) % topics.length],
          objectives:'By the end of the lesson, students should be able to define the key terms, work through two examples, and complete the class exercise.',
          status: wk===1 ? 'APPROVED' : wk===2 ? 'SUBMITTED' : 'DRAFT',
        });
      }
    }
  }

  // assignments and submissions -------------------------------------------
  ASSIGNMENT_SEED.forEach((a,i)=>{
    const c = CLASSES[i % CLASSES.length];
    if(!subjectsFor(c).some(x=>x.id===a.sub)) return;
    const id = 'as'+(i+1);
    const due = `2026-08-${String(between(8,28)).padStart(2,'0')}`;
    db.assignments.push({id, classId:c.id, subjectId:a.sub, staffId:pick(teachStaff).id,
      title:a.title, instructions:a.instructions, dueAt:due, maxScore:20});

    // Not everyone submits. That is the point of the screen.
    for(const st of db.students.filter(x=>x.classId===c.id)){
      if(rng() > .32){
        const late = rng() > .85;
        const score = rng() > .12 ? between(8,20) : null;
        db.submissions.push({id:uid('sub'), assignmentId:id, studentId:st.id,
          submittedAt: late ? `2026-08-${String(between(29,30)).padStart(2,'0')}` : due,
          late, score, feedback: score===null ? null : score>=16 ? 'Well done.' : score>=12 ? 'Fair attempt — check your working.' : 'See me after class.'});
      }
    }
  });

  // CBT: the entrance examination -----------------------------------------
  const entrance = {id:'cbt1', title:'2026/2027 Entrance Examination', classId:null, subjectId:null,
    durationMins:45, questionCount:20, shuffle:true, forApplicants:true,
    opensAt:'2026-08-15T09:00', closesAt:'2026-08-15T13:00', status:'PUBLISHED'};
  db.cbtExams.push(entrance);
  let qn = 0;
  for(const code of ['MTH','ENG','BSC','SOS']){
    for(const q of QUESTION_BANK[code]){
      qn++;
      db.cbtQuestions.push({id:'q'+qn, examId:'cbt1', section:code, marks:1, ...q});
    }
  }

  // CBT: a class test, to show the internal path
  const test = {id:'cbt2', title:'JSS 2 Mathematics — Continuous Assessment 1', classId:'c3', subjectId:'s1',
    durationMins:25, questionCount:10, shuffle:true, forApplicants:false,
    opensAt:'2026-08-10T10:00', closesAt:'2026-08-10T12:00', status:'PUBLISHED'};
  db.cbtExams.push(test);
  for(const q of QUESTION_BANK.MTH){
    qn++;
    db.cbtQuestions.push({id:'q'+qn, examId:'cbt2', section:'MTH', marks:1, ...q});
  }

  // website ---------------------------------------------------------------
  // isLegacy marks a URL that already exists on the school's live site and is
  // linked from Google, printed prospectuses and WhatsApp. Those paths must
  // survive the move, or the school loses traffic it spent years earning.
  const leaders = ['Principal','Vice Principal','Academic Coordinator','Bursar','Registrar']
    .map(p=>db.staff.find(m=>m.position===p)).filter(Boolean).map(m=>m.id);
  db.pages = [
    {id:'pg1', title:'Home', path:'/', type:'HOME', isLegacy:true, status:'PUBLISHED', updated:'2026-07-18', views:4820,
      heading:'Admissions for 2026/2027 are open', subheading:'Entrance examination Saturday 15 August. Apply online — no forms to collect, no queue.',
      body:'', ctaText:'Apply online', ctaLink:'/apply', seoTitle:'Fadesrek Academy — Kubwa, Abuja FCT',
      seoDescription:'A day and boarding school in Kubwa, Abuja FCT, admitting JSS 1 and SS 1 for the 2026/2027 session.'},
    {id:'pg2', title:'About us', path:'/about', type:'GENERAL', isLegacy:true, status:'PUBLISHED', updated:'2026-06-02', views:1310,
      heading:'About Fadesrek Academy', subheading:'', body:'Fadesrek Academy has served Kubwa and the wider Abuja FCT since its founding, offering a broad academic programme alongside sport, the arts and pastoral care.',
      ctaText:'', ctaLink:'', seoTitle:'About us — Fadesrek Academy', seoDescription:'The school\'s history, values and campus.'},
    {id:'pg3', title:'Admissions', path:'/admission', type:'ADMISSIONS', isLegacy:true, status:'PUBLISHED', updated:'2026-07-30', views:3960,
      heading:'Join Fadesrek Academy', subheading:'', body:'Applications for JSS 1 and SS 1 are open for the 2026/2027 session. The entrance examination holds Saturday 15 August — apply online and the office confirms a slot within two working days.',
      ctaText:'Start an application', ctaLink:'/apply', seoTitle:'Admissions — Fadesrek Academy',
      seoDescription:'How to apply for JSS 1 and SS 1, entrance examination dates, and fees.'},
    {id:'pg4', title:'Academics', path:'/academics', type:'ACADEMICS', isLegacy:true, status:'PUBLISHED', updated:'2026-05-14', views:880,
      heading:'A broad curriculum, closely marked', subheading:'', body:'From JSS 1 through SS 3, pupils follow the Nigerian national curriculum across sciences, arts and commercial subjects, with continuous assessment feeding directly into every term\'s report card.',
      ctaText:'', ctaLink:'', seoTitle:'Academics — Fadesrek Academy', seoDescription:'Curriculum, subjects offered, and assessment structure.'},
    {id:'pg5', title:'Contact', path:'/contact', type:'CONTACT', isLegacy:true, status:'PUBLISHED', updated:'2026-04-09', views:1042,
      heading:'Get in touch', subheading:'', body:'Questions about admissions, fees or a campus visit — send a message below and the front office replies within one working day.',
      ctaText:'', ctaLink:'', seoTitle:'Contact — Fadesrek Academy', seoDescription:'Phone, address and a contact form for enquiries.'},
    {id:'pg6', title:'Apply online', path:'/apply', type:'GENERAL', isLegacy:false, status:'PUBLISHED', updated:'2026-08-01', views:612,
      heading:'Apply online', subheading:'', body:'The application form for JSS 1 and SS 1 entry.', ctaText:'', ctaLink:'',
      seoTitle:'', seoDescription:''},
    {id:'pg7', title:'Parent portal', path:'/portal', type:'GENERAL', isLegacy:false, status:'PUBLISHED', updated:'2026-08-01', views:298,
      heading:'Parent portal', subheading:'', body:'Sign in to see fees, results and attendance for your child.', ctaText:'', ctaLink:'',
      seoTitle:'', seoDescription:''},
    {id:'pg8', title:'Fees and payment', path:'/fees', type:'GENERAL', isLegacy:false, status:'DRAFT', updated:'2026-08-04', views:0,
      heading:'Fees and payment', subheading:'', body:'', ctaText:'', ctaLink:'', seoTitle:'', seoDescription:''},
    {id:'pg9', title:'Leadership', path:'/leadership', type:'LEADERSHIP', isLegacy:false, status:'PUBLISHED', updated:'2026-08-01', views:0,
      heading:'School leadership', subheading:'', body:'The people responsible for Fadesrek day to day.', ctaText:'', ctaLink:'',
      seoTitle:'Leadership — Fadesrek Academy', seoDescription:'The principal, vice principal and senior management team.',
      leadershipStaffIds:leaders},
    {id:'pg10', title:'Downloads', path:'/downloads', type:'DOWNLOADS', isLegacy:false, status:'PUBLISHED', updated:'2026-08-01', views:0,
      heading:'Downloads', subheading:'', body:'Forms and documents families ask for most.', ctaText:'', ctaLink:'',
      seoTitle:'Downloads — Fadesrek Academy', seoDescription:'Prospectus, admission form and school calendar.',
      downloadFiles:[
        {name:'2026/2027 Prospectus', description:'Fees, curriculum overview and campus facilities'},
        {name:'Admission form', description:'For JSS 1 and SS 1 applicants'},
        {name:'School calendar', description:'Term dates and public holidays for 2026/2027'},
      ]},
  ];
  db.posts = [
    {id:'ps1', title:'Fadesrek pupils sweep FCT science fair', slug:'/news/science-fair-2026',
     excerpt:'Three of our JSS 3 students placed in the top ten at the Federal Capital Territory science exhibition held at Eagle Square.',
     body:'Three JSS 3 pupils represented Fadesrek at this year\'s Federal Capital Territory science exhibition, held at Eagle Square, and placed in the top ten out of over sixty participating schools. The team\'s project on low-cost water filtration was praised by judges for its practical application to communities without reliable piped water.',
     status:'PUBLISHED', at:'2026-07-22', views:743},
    {id:'ps2', title:'2026/2027 admissions now open', slug:'/news/admissions-open-2026',
     excerpt:'Applications for JSS 1 and SS 1 are open. The entrance examination holds on Saturday 15 August.',
     body:'Applications for JSS 1 and SS 1 are now open for the 2026/2027 session. The entrance examination holds Saturday 15 August in Halls A and B, 9:00 am prompt. Parents can apply online — see the Admissions page for the full process and required documents.',
     status:'PUBLISHED', at:'2026-07-10', views:2914},
    {id:'ps3', title:'New science laboratory commissioned', slug:'/news/new-laboratory',
     excerpt:'The chemistry and physics laboratories have been refitted ahead of the new session.',
     body:'The chemistry and physics laboratories have been refitted with new benches, fume extraction and a full set of apparatus ahead of the new session, doubling practical class capacity for SS 1 through SS 3.',
     status:'PUBLISHED', at:'2026-06-28', views:401},
    {id:'ps4', title:'Inter-house sports — a look back', slug:'/news/inter-house-2026',
     excerpt:'Coral House took the trophy for the second year running.',
     body:'Coral House retained the inter-house sports trophy for the second year running, edging out Emerald House on the final relay. Full results and photographs are in the gallery.',
     status:'DRAFT', at:'2026-08-05', views:0},
  ];
  db.events = [
    {id:'ev1', title:'Entrance examination',   at:'2026-08-15', where:'Halls A and B', description:'Entrance examination for JSS 1 and SS 1 applicants. Gates open 8:30 am, examination starts 9:00 am prompt.', published:true},
    {id:'ev2', title:'Staff development week', at:'2026-08-24', where:'Main hall',     description:'Sessions on the new result-entry workflow. All teaching staff expected.', published:true},
    {id:'ev3', title:'Resumption, First Term', at:'2026-09-14', where:'School campus', description:'Boarders arrive Sunday 13 September. Day students Monday morning.', published:true},
    {id:'ev4', title:'Open day for parents',   at:'2026-09-26', where:'Main hall',     description:'Prospective families are welcome to tour the campus and meet teaching staff.', published:false},
  ];
  db.gallery = [
    {id:'gl1', album:'Inter-house sports 2026', cover:'sports'},
    {id:'gl2', album:'Science fair',            cover:'science'},
    {id:'gl3', album:'Graduation, SS 3',        cover:'graduation'},
    {id:'gl4', album:'New laboratory',          cover:'lab'},
  ];
  db.mediaLibrary = [
    {id:'md1', label:'Relay final — Coral vs Emerald', album:'Inter-house sports 2026', uploadedOn:'2026-07-20', uploadedBy:'Fatima Lawal'},
    {id:'md2', label:'Trophy presentation', album:'Inter-house sports 2026', uploadedOn:'2026-07-20', uploadedBy:'Fatima Lawal'},
    {id:'md3', label:'Long jump pit', album:'Inter-house sports 2026', uploadedOn:'2026-07-20', uploadedBy:'Fatima Lawal'},
    {id:'md4', label:'Water filtration project stand', album:'Science fair', uploadedOn:'2026-07-23', uploadedBy:'Yusuf Garba'},
    {id:'md5', label:'JSS 3 team with their award', album:'Science fair', uploadedOn:'2026-07-23', uploadedBy:'Yusuf Garba'},
    {id:'md6', label:'SS 3 graduating class, 2026', album:'Graduation, SS 3', uploadedOn:'2026-07-05', uploadedBy:'Yusuf Garba'},
    {id:'md7', label:'Valedictorian speech', album:'Graduation, SS 3', uploadedOn:'2026-07-05', uploadedBy:'Yusuf Garba'},
    {id:'md8', label:'New fume-extraction benches', album:'New laboratory', uploadedOn:'2026-06-29', uploadedBy:'Yusuf Garba'},
  ];
  db.testimonials = [
    {id:'tm1', name:'Mrs Chika Eze', role:'Parent, JSS 2', quote:'Fadesrek caught my daughter\'s dyscalculia early and put real support behind it — she\'s near the top of her class in maths now.', status:'PUBLISHED'},
    {id:'tm2', name:'Emeka O.', role:'SS 3 graduate, 2025', quote:'The teachers pushed us hard on the sciences but always made time outside class when something wasn\'t clicking.', status:'PUBLISHED'},
    {id:'tm3', name:'Mr Bashir Danjuma', role:'Parent, boarder', quote:'Communication from the hostel side has been consistent — I always know how my son is doing.', status:'PUBLISHED'},
    {id:'tm4', name:'Mrs Funke Adebayo', role:'Parent, JSS 1', quote:'The application and entrance exam process was far less stressful than at other schools we tried.', status:'DRAFT'},
  ];
  db.enquiries = [
    {id:'eq1', name:'Mrs Adaeze Nwosu',  email:'adaeze.nwosu@gmail.com',  phone:'08034556677',
     subject:'JSS 1 admission for my son', message:'My son is currently in Primary 6 and we would like to apply for JSS 1 for the 2026/2027 session. Could you let me know the entrance exam date and what documents we need to bring?',
     at:'2026-08-05', handled:false},
    {id:'eq2', name:'Mr Sadiq Aliyu',    email:'s.aliyu@yahoo.com',       phone:'08123344556',
     subject:'Does the school run a school bus to Gwarinpa?', message:'We live off 3rd Avenue in Gwarinpa. Does the school transport service cover that area, and what is the termly fare?',
     at:'2026-08-04', handled:false},
    {id:'eq3', name:'Dr Funke Ogunleye', email:'fogunleye@outlook.com',   phone:'07066778899',
     subject:'Transfer from another school, mid-session', message:'We are relocating to Abuja in September and my daughter is currently in SS 1. Is it possible to transfer her mid-session, and would she need to sit an assessment?',
     at:'2026-08-02', handled:true},
    {id:'eq4', name:'Mr Bashir Danjuma', email:'bdanjuma@gmail.com',      phone:'08099887766',
     subject:'Boarding facilities and fees', message:'Could you send details of the boarding facilities for SS students, including the termly boarding fee and what it covers?',
     at:'2026-07-29', handled:true},
  ];

  // notices --------------------------------------------------------------
  db.notices = [
    {id:'n1', cls:'n-yellow', art:'aExam', title:'Entrance examination',
     body:'Screening for the 2026/2027 intake. Halls A and B, 9:00 am prompt.', when:'Saturday 15 August', at:'2026-08-15'},
    {id:'n2', cls:'n-lilac', art:'aTraining', title:'Staff development week',
     body:'Sessions on the new result-entry workflow. All teaching staff expected.', when:'24 — 28 August', at:'2026-08-24'},
    {id:'n3', cls:'n-peach', art:'aResume', title:'Resumption, First Term',
     body:'Boarders arrive Sunday 13 September. Day students Monday morning.', when:'Monday 14 September', at:'2026-09-14'},
  ];

  // student information system ---------------------------------------------
  db.students.forEach(s => { s.lifecycleStatus = 'ENROLLED'; });

  const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
  const GENOTYPES = ['AA','AS','SS','AC'];
  const ALLERGY_NOTES = ['Peanuts','Penicillin','None known','Dust and pollen','Seafood','None known','None known'];
  db.students.forEach(s => {
    if(rng() > .55) return; // on file for roughly half the school
    db.medicalProfiles[s.id] = {
      bloodGroup: pick(BLOOD_GROUPS), genotype: pick(GENOTYPES),
      allergies: pick(ALLERGY_NOTES),
      conditions: rng() > .85 ? pick(['Mild asthma','Seasonal eczema']) : '',
      physicianName: rng() > .5 ? `Dr. ${pick(LAST)}` : '',
      physicianPhone: rng() > .5 ? `080${between(10000000,99999999)}` : '',
      emergencyContactName: s.guardian, emergencyContactPhone: s.guardianPhone,
      insuranceProvider: rng() > .6 ? pick(['Hygeia HMO','AXA Mansard','Reliance HMO']) : '',
      insuranceNo: rng() > .6 ? `INS/${between(100000,999999)}` : '',
    };
  });

  const VISIT_REASONS = ['Headache','Malaria symptoms','Minor cut, playground','Stomach ache','Fever','Sprained ankle, sports'];
  for(let i=0;i<10;i++){
    const s = pick(db.students);
    db.medicalVisits.push({id:uid('mv'), studentId:s.id,
      visitedOn:`2026-0${between(7,8)}-${String(between(1,28)).padStart(2,'0')}`,
      reason:pick(VISIT_REASONS),
      treatment:pick(['Paracetamol administered, rest advised','Wound cleaned and dressed','Observed, released after 30 minutes','Referred to parent for follow-up']),
      notes:'', recordedBy:'School Nurse'});
  }

  const sisTeachers = db.staff.filter(m=>/Teacher/.test(m.position));
  const MERITS = ['Represented the school at the inter-house quiz','Outstanding improvement in Mathematics','Helped a classmate settle in','Led the assembly reading with confidence','Perfect attendance for the term'];
  const DEMERITS = ['Late to morning assembly','Uniform infraction','Unruly conduct in the lunch queue','Incomplete homework, third occurrence','Talking during examination'];
  for(let i=0;i<14;i++){
    const s = pick(db.students);
    const isMerit = rng() > .45;
    const t = pick(sisTeachers);
    db.behaviourIncidents.push({id:uid('bi'), studentId:s.id,
      occurredOn:`2026-0${between(7,8)}-${String(between(1,28)).padStart(2,'0')}`,
      category:isMerit?'MERIT':'DEMERIT', severity:isMerit?'LOW':pick(['LOW','MEDIUM','HIGH']),
      description:isMerit?pick(MERITS):pick(DEMERITS),
      actionTaken:isMerit?'Commendation noted on record':pick(['Verbal warning issued','Parent notified','Detention, one day','Counselling session scheduled']),
      reportedBy:`${t.firstName} ${t.lastName}`});
  }

  // A handful of worked lifecycle examples — promotion, graduation, transfer
  // and withdrawal — so every tab has something real to show, not just the
  // live workflow buttons.
  const LEVEL_ORDER = ['JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
  const priorClassOf = c => {
    const i = LEVEL_ORDER.indexOf(c.level);
    if(i<=0) return null;
    const priorLevel = LEVEL_ORDER[i-1];
    return CLASSES.find(x=>x.level===priorLevel && (x.arm===c.arm||x.stream===c.stream)) || CLASSES.find(x=>x.level===priorLevel);
  };
  const promotable = db.students.filter(s=>s.classId!=='c1'&&s.classId!=='c2');
  for(let i=0;i<3;i++){
    const s = pick(promotable);
    const c = CLASSES.find(x=>x.id===s.classId);
    const from = priorClassOf(c);
    if(!from || db.promotions.some(p=>p.studentId===s.id)) continue;
    db.promotions.push({id:uid('pm'), studentId:s.id, fromClassId:from.id, toClassId:c.id,
      outcome:'PROMOTED', remarks:'End-of-session promotion — all subjects passed.', decidedOn:'2026-07-25'});
  }

  // Excludes the seeded Parent persona's own children so their portal demo
  // always shows two straightforwardly-enrolled kids, not a surprise
  // graduation.
  const lifecycleCandidates = db.students.filter(s=>s.classId!=='c1' && !(ROLES.PARENT.childIds||[]).includes(s.id));
  const grads = lifecycleCandidates.filter(s=>s.classId==='c9').slice(0,2);
  const afterGrads = lifecycleCandidates.filter(s=>!grads.includes(s));
  const transferee = afterGrads[Math.floor(rng()*afterGrads.length)];
  const afterTransfer = afterGrads.filter(s=>s!==transferee);
  const withdrawee = afterTransfer[Math.floor(rng()*afterTransfer.length)];

  grads.forEach((s,i)=>{
    s.lifecycleStatus = 'GRADUATED'; s.status = 'INACTIVE';
    db.graduations.push({id:uid('gr'), studentId:s.id, classId:s.classId,
      graduatedOn:'2026-07-20', remarks:'Completed the West African Senior School Certificate Examination.'});
    db.certificates.push({id:uid('ct'), studentId:s.id, type:'GRADUATION',
      serialNo:`FA/CERT/2026/${String(i+1).padStart(3,'0')}`, issuedOn:'2026-07-22', revoked:false});
  });

  transferee.lifecycleStatus = 'TRANSFERRED'; transferee.status = 'INACTIVE';
  db.transfers.push({id:uid('tr'), studentId:transferee.id, direction:'OUTGOING',
    otherSchool:'Chrisland College, Abuja', reason:'Family relocation to Lagos.',
    transferStatus:'COMPLETED', requestedOn:'2026-07-10', effectiveOn:'2026-07-18'});
  db.certificates.push({id:uid('ct'), studentId:transferee.id, type:'TRANSFER',
    serialNo:'FA/CERT/2026/010', issuedOn:'2026-07-18', revoked:false});

  withdrawee.lifecycleStatus = 'WITHDRAWN'; withdrawee.status = 'INACTIVE';
  db.withdrawals.push({id:uid('wd'), studentId:withdrawee.id, reason:'FINANCIAL',
    detail:'Guardian unable to continue fee payments for the session.', withdrawnOn:'2026-07-05', refundKobo:0});

  // documents ----------------------------------------------------------------
  const PLACEHOLDER_DOC = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="260"><rect width="200" height="260" fill="#E4EEF7"/><text x="100" y="130" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#1C0D5A">Document</text></svg>');
  const DOC_CATS = ['BIRTH_CERTIFICATE','PASSPORT_PHOTO','PREVIOUS_RESULT'];
  db.students.slice(0,20).forEach(s=>{
    const cat = pick(DOC_CATS);
    db.studentDocuments.push({id:uid('sd'), studentId:s.id, category:cat,
      name:`${cat.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())} — ${s.firstName} ${s.lastName}.pdf`,
      dataUrl:PLACEHOLDER_DOC, uploadedBy:'Registry', uploadedAt:'2026-09-14', verified: rng()>.3});
  });

  // biometrics -----------------------------------------------------------
  db.students.forEach(s=>{
    if(rng() > .5) return;
    db.biometrics.push({id:uid('bm'), studentId:s.id, type:'FINGERPRINT',
      enrolledOn:s.enrolledOn, deviceId:`ENROL-${between(100,199)}`});
  });

  // timeline — enrolment for everyone, plus a derived entry for every other
  // SIS record seeded above -----------------------------------------------
  db.students.forEach(s=>{
    db.timelineEvents.push({id:uid('tl'), studentId:s.id, category:'ENROLLMENT',
      title:'Enrolled at Fadesrek Academy', description:`Admitted as ${s.admissionNo}.`, occurredOn:s.enrolledOn});
  });
  db.behaviourIncidents.forEach(b=>{
    db.timelineEvents.push({id:uid('tl'), studentId:b.studentId, category:'BEHAVIOUR',
      title:b.category==='MERIT'?'Merit awarded':'Conduct incident logged', description:b.description, occurredOn:b.occurredOn});
  });
  db.medicalVisits.forEach(v=>{
    db.timelineEvents.push({id:uid('tl'), studentId:v.studentId, category:'MEDICAL',
      title:'Sick bay visit', description:v.reason, occurredOn:v.visitedOn});
  });
  db.promotions.forEach(p=>{
    const to = CLASSES.find(x=>x.id===p.toClassId);
    db.timelineEvents.push({id:uid('tl'), studentId:p.studentId, category:'LIFECYCLE',
      title:`Promoted to ${className(to)}`, description:p.remarks, occurredOn:p.decidedOn});
  });
  grads.forEach(s=>{
    db.timelineEvents.push({id:uid('tl'), studentId:s.id, category:'LIFECYCLE',
      title:'Graduated', description:'Completed studies and graduated from Fadesrek Academy.', occurredOn:'2026-07-20'});
  });
  db.timelineEvents.push({id:uid('tl'), studentId:transferee.id, category:'LIFECYCLE',
    title:'Transferred out', description:`Transferred to ${db.transfers[0].otherSchool}.`, occurredOn:db.transfers[0].effectiveOn});
  db.timelineEvents.push({id:uid('tl'), studentId:withdrawee.id, category:'LIFECYCLE',
    title:'Withdrawn', description:db.withdrawals[0].detail, occurredOn:db.withdrawals[0].withdrawnOn});
}

function subjectsFor(c){
  const junior = /JSS/.test(c.level);
  return SUBJECTS.filter(s => {
    if(s.core) return true;
    if(s.junior) return junior;
    if(s.senior) return !junior && (!c.stream || streamOk(s,c));
    return true;
  });
}
function streamOk(s,c){
  if(c.stream==='Science') return ['s7','s8','s9'].includes(s.id);
  if(c.stream==='Arts')    return ['s10','s11'].includes(s.id);
  return true;
}
/** The TRANSPORT fee item is a fallback flat rate. A student actually
    allocated to a route is billed that route's own fare instead — so
    changing a route's fare in Transport is what a family sees on their
    next invoice, not a second number kept in step by hand. */
function feeItemsFor(s){
  const items = db.feeItems.filter(f => f.applies==='ALL' || (f.applies==='BOARDER'&&s.boarder) || (f.applies==='TRANSPORT'&&s.transport));
  if(!s.transport) return items;
  const alloc = db.transportAlloc.find(a=>a.studentId===s.id);
  const route = alloc && db.routes.find(r=>r.id===alloc.routeId);
  if(!route) return items;
  return items.map(f => f.applies==='TRANSPORT' ? {...f, amount:route.fare, name:`Transport — ${route.name}`} : f);
}

// ------------------------------------------------------------ computation ---

/** Total is derived from the stored components, never read from a stored
    total. That is what makes a re-mark or a re-weighting recomputable. */
function subjectTotal(studentId, subjectId){
  const r = db.scores[`${studentId}:${subjectId}`];
  if(!r) return null;
  return r.ca1 + r.ca2 + r.asg + r.exam;
}

function studentResult(student){
  const c = CLASSES.find(x=>x.id===student.classId);
  const rows = subjectsFor(c).map(sub=>{
    const r = db.scores[`${student.id}:${sub.id}`] || {ca1:0,ca2:0,asg:0,exam:0};
    const total = r.ca1+r.ca2+r.asg+r.exam;
    return {subject:sub, ...r, total, ...gradeOf(total)};
  });
  const sum = rows.reduce((t,r)=>t+r.total,0);
  const avg = rows.length ? sum/rows.length : 0;
  return {rows, sum, avg, passed: rows.filter(r=>r.total>=40).length, count: rows.length};
}

/** Competition ranking: two students on 82 both take 3rd and the next takes
    5th. Dense ranking would quietly tell the second student they came 4th. */
function classPositions(classId){
  const list = db.students.filter(s=>s.classId===classId && s.status==='ACTIVE')
    .map(s=>({student:s, avg:studentResult(s).avg}));
  const sorted = [...list].map(x=>x.avg).sort((a,b)=>b-a);
  list.forEach(x => { x.position = sorted.findIndex(v => Math.abs(v-x.avg) < 1e-9) + 1; });
  return list.sort((a,b)=>a.position-b.position);
}
const ordinal = n => { const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };

/** Scholarships reduce the bill by percentage (capped at 100, so stacked
    awards can't go negative); discounts then come off the remainder as a
    flat kobo amount. Both are stored per student, never baked into a
    recomputed "final" total, so an award added or withdrawn mid-term is
    reflected everywhere on the next render — the same reason totals are
    never cached anywhere else in this file. */
function feeSummary(student){
  const items = feeItemsFor(student);
  const gross = items.reduce((t,f)=>t+f.amount,0);
  const scholPct = Math.min(100, db.scholarships.filter(x=>x.studentId===student.id).reduce((t,x)=>t+x.percent,0));
  const scholAmt = Math.round(gross * scholPct / 100);
  const discAmt = db.discounts.filter(x=>x.studentId===student.id).reduce((t,x)=>t+x.amount,0);
  const billed = Math.max(gross - scholAmt - discAmt, 0);
  const paid = db.payments.filter(p=>p.studentId===student.id && !p.reversed).reduce((t,p)=>t+p.amount,0);
  return {items, gross, scholPct, scholAmt, discAmt, billed, paid, balance: billed-paid, settled: billed-paid <= 0};
}

/** An installment's status is derived from cumulative payments against
    cumulative planned amounts, never stored — a payment recorded through the
    ordinary "Record payment" flow settles the plan's next due line on its
    own, with nothing to keep in sync by hand. */
function studentInstallments(studentId){
  const plan = db.installmentPlans.find(p=>p.studentId===studentId);
  if(!plan) return null;
  const student = db.students.find(s=>s.id===studentId);
  const paidTotal = feeSummary(student).paid;
  let cum = 0;
  const rows = plan.items.map(it=>{
    const prevCum = cum;
    cum += it.amount;
    const paidForThis = Math.max(0, Math.min(it.amount, paidTotal - prevCum));
    const status = paidForThis>=it.amount ? 'PAID' : paidForThis>0 ? 'PARTIAL' : (it.dueDate<todayISO() ? 'OVERDUE' : 'PENDING');
    return {...it, paidForThis, status};
  });
  return {plan, rows, totalPlanned:cum};
}

/**
 * A full payslip under the Nigeria Tax Act 2025 (in force 1 January 2026).
 *
 * Order matters and is set by the Act: pension, NHF and rent relief come off
 * gross first; the graduated bands then apply to what remains. The abolished
 * CRA is deliberately absent — applying it would under-deduct and leave the
 * school liable for the shortfall plus penalties.
 *
 * Everything is in kobo. Rounding happens once, at the end, on the annual
 * figure — rounding each band would drift by a few kobo a year and the
 * reconciliation would never quite close.
 */
function computePayslip(staff){
  const grade = SALARY_GRADES.find(g=>g.id===staff.gradeId) || SALARY_GRADES[6];
  const gross = grade.gross;

  const basic     = Math.round(gross * PAY_SPLIT.basic);
  const housing   = Math.round(gross * PAY_SPLIT.housing);
  const transport = Math.round(gross * PAY_SPLIT.transport);
  const other     = gross - basic - housing - transport;   // absorbs the rounding

  // Pensionable pay is Basic + Housing + Transport, never gross.
  const pensionable    = basic + housing + transport;
  const pensionEmp     = Math.round(pensionable * PENSION_EMPLOYEE);
  const pensionEmployer= Math.round(pensionable * PENSION_EMPLOYER);
  const nhf            = Math.round(basic * NHF_RATE);

  // Rent relief needs evidence, so it is nil unless rent has been declared.
  const rentRelief = staff.annualRent ? Math.min(Math.round(staff.annualRent * 0.20), RENT_RELIEF_CAP) : 0;

  const taxable = Math.max(0, gross - pensionEmp - nhf - rentRelief);

  let remaining = taxable, annualTax = 0;
  const bandRows = [];
  for(const band of PAYE_BANDS){
    if(remaining <= 0){ bandRows.push({...band, amount:0, tax:0}); continue; }
    const inBand = Math.min(remaining, band.width);
    const tax = inBand * band.rate;
    annualTax += tax;
    bandRows.push({...band, amount:inBand, tax:Math.round(tax)});
    remaining -= inBand;
  }
  annualTax = Math.round(annualTax);

  const monthlyGross = Math.round(gross/12);
  const monthlyPaye  = Math.round(annualTax/12);
  const monthlyPen   = Math.round(pensionEmp/12);
  const monthlyNhf   = Math.round(nhf/12);
  const net          = monthlyGross - monthlyPaye - monthlyPen - monthlyNhf;

  return {grade, gross, basic, housing, transport, other, pensionable,
    pensionEmp, pensionEmployer, nhf, rentRelief, taxable, annualTax, bandRows,
    monthlyGross, monthlyPaye, monthlyPen, monthlyNhf, net,
    effectiveRate: gross ? annualTax/gross*100 : 0};
}

function payrollTotals(){
  return db.staff.filter(m=>m.status==='ACTIVE').map(computePayslip)
    .reduce((a,p)=>{
      a.gross+=p.monthlyGross; a.paye+=p.monthlyPaye; a.pension+=p.monthlyPen;
      a.employerPension+=Math.round(p.pensionEmployer/12); a.nhf+=p.monthlyNhf; a.net+=p.net; a.count++;
      return a;
    },{gross:0,paye:0,pension:0,employerPension:0,nhf:0,net:0,count:0});
}

/* --------------------------------------------------------------- CBT engine ---
   Two rules make an online test defensible, and both are about not trusting
   the machine in front of the candidate:

   1. The question set is chosen and frozen when the attempt STARTS. Reshuffling
      on each render would let a candidate reload until they got easier
      questions, and would make a disputed paper impossible to reconstruct.

   2. The deadline is an absolute timestamp stored at start, not a countdown
      held in the browser. A candidate who closes the laptop, changes the
      system clock and comes back still finds the same expiry waiting.        */

function startAttempt(examId, candidateId, candidateKind){
  const exam = db.cbtExams.find(e=>e.id===examId);
  const pool = db.cbtQuestions.filter(q=>q.examId===examId);

  // Fisher-Yates, then take the first n. Frozen from here on.
  const order = pool.map(q=>q.id);
  if(exam.shuffle){
    for(let i=order.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [order[i],order[j]] = [order[j],order[i]];
    }
  }
  const served = order.slice(0, Math.min(exam.questionCount, order.length));

  const attempt = {
    id: uid('att'), examId, candidateId, candidateKind,
    startedAt: Date.now(),
    expiresAt: Date.now() + exam.durationMins*60_000,
    servedQuestionIds: served,
    answers: {},          // questionId -> chosen option index
    submittedAt: null, score: null, total: served.length,
  };
  db.cbtAttempts.push(attempt);
  return attempt;
}

/** Marks against the frozen served list. Unanswered counts as wrong, never as
    a skipped question worth part marks. */
function markAttempt(attempt, reason='SUBMITTED'){
  let score = 0;
  const detail = attempt.servedQuestionIds.map(qid=>{
    const q = db.cbtQuestions.find(x=>x.id===qid);
    const given = attempt.answers[qid];
    const right = given === q.answer;
    if(right) score += q.marks;
    return {q, given, right};
  });
  attempt.submittedAt = Date.now();
  attempt.score = score;
  attempt.percent = attempt.total ? Math.round(score/attempt.total*100) : 0;
  attempt.reason = reason;
  attempt.detail = detail;
  return attempt;
}

const attemptRemaining = a => Math.max(0, a.expiresAt - Date.now());
const attemptExpired = a => attemptRemaining(a) === 0;

const examStats = examId => {
  const done = db.cbtAttempts.filter(a=>a.examId===examId && a.submittedAt);
  if(!done.length) return {taken:0, avg:0, passRate:0};
  const avg = done.reduce((t,a)=>t+a.percent,0)/done.length;
  return {taken:done.length, avg, passRate: done.filter(a=>a.percent>=50).length/done.length*100};
};

/* ---------------------------------------------------------------- academics --- */

const assignmentStats = a => {
  const expected = db.students.filter(s=>s.classId===a.classId && s.status==='ACTIVE').length;
  const subs = db.submissions.filter(x=>x.assignmentId===a.id);
  const marked = subs.filter(x=>x.score!==null);
  return {
    expected, submitted: subs.length, missing: expected - subs.length,
    late: subs.filter(x=>x.late).length,
    marked: marked.length, unmarked: subs.length - marked.length,
    avg: marked.length ? marked.reduce((t,x)=>t+x.score,0)/marked.length : null,
  };
};

/* ------------------------------------------------------------- operations --- */

const overdueBorrowings = () => db.borrowings.filter(b=>!b.returnedOn && b.due < todayISO());
/** ₦50 a day, capped at the replacement cost so a forgotten book can never
    cost a parent more than simply buying another one. */
const fineFor = b => {
  if(b.returnedOn || b.due >= todayISO()) return 0;
  const days = Math.round((new Date(todayISO()) - new Date(b.due))/86400000);
  return Math.min(days * 5000, 500000);
};

const bedFor = studentId => {
  for(const h of db.hostels) for(const r of h.rooms) for(const b of r.beds)
    if(b.studentId===studentId) return {hostel:h, room:r, bed:b};
  return null;
};
const hostelOccupancy = h => {
  const beds = h.rooms.flatMap(r=>r.beds);
  return {total:beds.length, taken:beds.filter(b=>b.studentId).length};
};

const lowStock = () => db.items.filter(i=>i.qty <= i.reorder);

function attendanceRate(studentId){
  let present=0, total=0;
  for(const key of Object.keys(db.attendance)){
    const rec = db.attendance[key];
    if(rec.roll[studentId]){ total++; if(rec.roll[studentId]!=='ABSENT') present++; }
  }
  return total ? Math.round(present/total*100) : null;
}

function staffAttendanceRate(staffId){
  let present=0, total=0;
  for(const key of Object.keys(db.staffAttendance)){
    const rec = db.staffAttendance[key];
    if(rec.roll[staffId]){ total++; if(rec.roll[staffId]!=='ABSENT') present++; }
  }
  return total ? Math.round(present/total*100) : null;
}

// ------------------------------------------------------------------ icons ---

/* ---------------------------------------------------------------- photos ---
   A phone camera produces a 4MB JPEG. Storing that as-is would blow the
   per-key storage limit after a handful of uploads and make every table drag,
   so each image is centre-cropped square and re-encoded at 256px before it is
   ever stored. Nothing keeps the original — the school needs a passport photo,
   not a photograph.                                                          */

const PHOTO_PX = 256;
const PHOTO_QUALITY = 0.75;
const MAX_SOURCE_MB = 8;

function readPhoto(file){
  return new Promise((resolve, reject) => {
    if(!file) return reject(new Error('No file chosen.'));
    if(!/^image\/(jpeg|png|webp)$/.test(file.type))
      return reject(new Error('Use a JPEG, PNG or WebP image.'));
    if(file.size > MAX_SOURCE_MB*1024*1024)
      return reject(new Error(`That image is ${(file.size/1048576).toFixed(1)}MB. The limit is ${MAX_SOURCE_MB}MB.`));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        // Centre crop to a square, so a portrait and a landscape shot both end
        // up framed the same way in a list.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side)/2, sy = (img.height - side)/2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = PHOTO_PX;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Photos are stored one key per person rather than in a single blob, so
    uploading one picture does not rewrite every other picture in the school. */
async function savePhoto(id, dataUrl){
  db.photos[id] = dataUrl;
  await Store.set(`photo:${id}`, dataUrl);
}
async function removePhoto(id){
  delete db.photos[id];
  await Store.set(`photo:${id}`, null);
}
async function loadPhotos(){
  const keys = await Store.listKeys('photo:');
  for(const k of keys){
    const v = await Store.get(k);
    if(v) db.photos[k.replace(/^photo:/,'')] = v;
  }
}

/** One avatar renderer everywhere: photo if there is one, initials if not. */
function avatar(person, size = 29, extraClass = ''){
  const src = db.photos[person.id];
  const cls = `mini ${person.gender==='F'?'f':''} ${extraClass}`.trim();
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size*0.36)}px`;
  if(src) return `<span class="${cls}" style="${style};padding:0;overflow:hidden">
    <img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block"></span>`;
  return `<span class="${cls}" style="${style}">${initials(person.firstName, person.lastName)}</span>`;
}

/** The upload control, reused by every profile. */
function photoPicker(person, size = 96){
  const has = !!db.photos[person.id];
  return `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    ${avatar(person, size)}
    <div>
      <label class="btn btn-q btn-s" style="cursor:pointer;display:inline-flex">
        ${has?'Replace photo':'Upload photo'}
        <input type="file" accept="image/jpeg,image/png,image/webp" data-photo-for="${person.id}" style="display:none">
      </label>
      ${has?`<button class="btn btn-d btn-s" data-photo-clear="${person.id}" style="margin-left:6px">Remove</button>`:''}
      <div style="font-size:11px;color:var(--muted);margin-top:6px;max-width:34ch;line-height:1.5">
        JPEG, PNG or WebP. Cropped square and resized to ${PHOTO_PX}px before saving —
        the original is not kept.</div>
      <div class="err" id="photo-err-${person.id}" style="margin-top:4px"></div>
    </div>
  </div>`;
}

/** Wires every picker on the page. Called after each render. */
function wirePhotoPickers(onDone){
  document.querySelectorAll('[data-photo-for]').forEach(inp=>{
    inp.addEventListener('change', async e => {
      const id = inp.dataset.photoFor;
      const err = document.getElementById('photo-err-'+id);
      if(err) err.textContent = '';
      try {
        const url = await readPhoto(e.target.files[0]);
        await savePhoto(id, url);
        toast('Photo saved.');
        if(onDone) onDone(); else render();
      } catch(ex){
        if(err) err.textContent = ex.message;
        else toast(ex.message, true);
      }
    });
  });
  document.querySelectorAll('[data-photo-clear]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      await removePhoto(b.dataset.photoClear);
      toast('Photo removed.');
      if(onDone) onDone(); else render();
    });
  });
}

/* --------------------------------------------------------------- the crest ---
   The school's crest artwork, placed wherever the mark is needed — the rail,
   the login card, and printed documents (report cards, payslips, the site
   preview header).                                                            */

const LOGO_SRC = 'public/src/fadesrek logo.jpg';
const logoIMG = size => `<span style="width:${size}px;height:${size}px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px var(--rule);flex:none;display:grid;place-items:center;overflow:hidden">
  <img src="${LOGO_SRC}" alt="Fadesrek Academy" style="width:92%;height:92%;object-fit:contain;display:block">
</span>`;

const N='#1C0D5A', NL='#2B1780', Y='#1A6FAF', L='#E4EEF7', W='#fff', SK='#E8B79E';
const ICONS = {
  addStudent:`<circle cx="20" cy="17" r="8" fill="${SK}"/><path d="M12 15a8 8 0 0 1 16 0c0-1-3-3-8-3s-8 2-8 3z" fill="${N}"/><path d="M6 44c0-8 6-13 14-13s14 5 14 13z" fill="${N}"/><circle cx="36" cy="36" r="10" fill="${Y}"/><path d="M36 31v10M31 36h10" stroke="${N}" stroke-width="2.6" stroke-linecap="round"/>`,
  addStaff:`<circle cx="20" cy="16" r="8" fill="${SK}"/><path d="M12 14a8 8 0 0 1 16 0c0-1-3-3-8-3s-8 2-8 3z" fill="${N}"/><path d="M6 44c0-8 6-13 14-13s14 5 14 13z" fill="${NL}"/><path d="M20 31l3 6-3 4-3-4z" fill="${W}"/><circle cx="36" cy="36" r="10" fill="${Y}"/><path d="M36 31v10M31 36h10" stroke="${N}" stroke-width="2.6" stroke-linecap="round"/>`,
  attendance:`<rect x="9" y="6" width="30" height="38" rx="4" fill="${N}"/><rect x="14" y="2" width="20" height="8" rx="4" fill="${Y}"/><path d="M15 20l4 4 8-9" stroke="${W}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M15 32l4 4 8-9" stroke="${W}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M30 21h5M30 34h5" stroke="${L}" stroke-width="2.4" stroke-linecap="round"/>`,
  collectFees:`<rect x="4" y="12" width="40" height="26" rx="4" fill="${N}"/><rect x="4" y="19" width="40" height="6" fill="${W}"/><rect x="9" y="30" width="12" height="4" rx="2" fill="${Y}"/><circle cx="35" cy="31" r="5" fill="${Y}"/>`,
  scholarship:`<path d="M24 6l20 9-20 9-20-9z" fill="${N}"/><path d="M13 21v10c0 4 5 7 11 7s11-3 11-7V21l-11 5z" fill="${NL}"/><path d="M42 17v13" stroke="${Y}" stroke-width="3" stroke-linecap="round"/><circle cx="42" cy="34" r="4" fill="${Y}"/>`,
  transport:`<rect x="5" y="10" width="38" height="24" rx="5" fill="${Y}"/><rect x="9" y="15" width="12" height="9" rx="2" fill="${W}"/><rect x="27" y="15" width="12" height="9" rx="2" fill="${W}"/><rect x="5" y="27" width="38" height="5" fill="${N}"/><circle cx="14" cy="37" r="5" fill="${N}"/><circle cx="34" cy="37" r="5" fill="${N}"/>`,
  hostel:`<path d="M24 5L4 19h40z" fill="${Y}"/><rect x="8" y="19" width="32" height="24" rx="3" fill="${N}"/><rect x="13" y="27" width="9" height="16" rx="1.5" fill="${W}"/><rect x="26" y="27" width="9" height="8" rx="1.5" fill="${L}"/>`,
  income:`<circle cx="24" cy="24" r="19" fill="${N}"/><path d="M24 13v22M18 18h9a4 4 0 0 1 0 8h-9M18 26h12" stroke="${W}" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="38" cy="12" r="8" fill="${Y}"/><path d="M38 8v8M34 12h8" stroke="${N}" stroke-width="2.4" stroke-linecap="round"/>`,
  expense:`<circle cx="24" cy="24" r="19" fill="${NL}"/><path d="M24 13v22M18 18h9a4 4 0 0 1 0 8h-9M18 26h12" stroke="${W}" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="38" cy="12" r="8" fill="${Y}"/><path d="M34 12h8" stroke="${N}" stroke-width="2.4" stroke-linecap="round"/>`,
  notice:`<path d="M6 20l22-11v30L6 28z" fill="${N}"/><path d="M28 9c8 2 13 7 13 15s-5 13-13 15z" fill="${NL}"/><rect x="8" y="28" width="7" height="14" rx="3" fill="${Y}"/>`,
  staffAttendance:`<circle cx="17" cy="15" r="8" fill="${SK}"/><path d="M9 13a8 8 0 0 1 16 0c0-1-3-3-8-3s-8 2-8 3z" fill="${N}"/><path d="M4 42c0-8 6-13 13-13s13 5 13 13z" fill="${N}"/><circle cx="36" cy="34" r="11" fill="${Y}"/><path d="M36 28v6l4 3" stroke="${N}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`,
  leave:`<rect x="6" y="9" width="36" height="34" rx="4" fill="${N}"/><rect x="6" y="9" width="36" height="9" rx="4" fill="${NL}"/><rect x="13" y="5" width="4" height="8" rx="2" fill="${Y}"/><rect x="31" y="5" width="4" height="8" rx="2" fill="${Y}"/><circle cx="24" cy="28" r="5" fill="${SK}"/><path d="M15 40c0-5 4-8 9-8s9 3 9 8z" fill="${W}"/>`,
  scores:`<rect x="8" y="5" width="28" height="38" rx="4" fill="${W}" stroke="${N}" stroke-width="2.5"/><path d="M14 15h14M14 22h14M14 29h8" stroke="${L}" stroke-width="2.6" stroke-linecap="round"/><path d="M43 14l-14 14-5 1 1-5 14-14z" fill="${Y}" stroke="${N}" stroke-width="2" stroke-linejoin="round"/>`,
  sClasses:`<rect x="4" y="8" width="40" height="27" rx="3" fill="${N}"/><rect x="8" y="12" width="32" height="19" rx="2" fill="${W}"/><path d="M13 20h10M13 25h16" stroke="${L}" stroke-width="2.4" stroke-linecap="round"/><rect x="20" y="35" width="8" height="6" fill="${NL}"/>`,
  sStudents:`<path d="M24 6l19 8-19 8-19-8z" fill="${N}"/><path d="M14 20v8c0 3 4 6 10 6s10-3 10-6v-8l-10 4z" fill="${Y}"/><path d="M41 15v11" stroke="${NL}" stroke-width="2.6" stroke-linecap="round"/>`,
  sStaff:`<circle cx="17" cy="17" r="8" fill="${Y}"/><circle cx="33" cy="19" r="7" fill="${L}"/><path d="M3 40c0-8 6-13 14-13s14 5 14 13z" fill="${N}"/><path d="M27 40c1-6 5-10 11-10 4 0 7 3 7 10z" fill="${NL}"/>`,
  sPending:`<circle cx="24" cy="24" r="19" fill="${Y}"/><path d="M24 13v11l7 5" stroke="${N}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  aExam:`<rect x="14" y="6" width="34" height="44" rx="4" fill="${W}"/><path d="M22 18h18M22 27h18M22 36h11" stroke="${N}" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="42" r="12" fill="${Y}"/><path d="M13 42l4 4 7-8" stroke="${N}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  aTraining:`<circle cx="20" cy="18" r="9" fill="${SK}"/><path d="M11 16a9 9 0 0 1 18 0c0-1-4-3-9-3s-9 2-9 3z" fill="${N}"/><path d="M4 54c0-10 7-16 16-16s16 6 16 16z" fill="${N}"/><rect x="38" y="14" width="26" height="20" rx="3" fill="${Y}"/><path d="M44 22h14M44 28h9" stroke="${N}" stroke-width="2.6" stroke-linecap="round"/>`,
  aResume:`<path d="M8 44h56" stroke="${N}" stroke-width="3" stroke-linecap="round"/><rect x="14" y="16" width="20" height="28" rx="3" fill="${N}"/><rect x="19" y="22" width="10" height="8" rx="1.5" fill="${W}"/><rect x="38" y="24" width="18" height="20" rx="3" fill="${Y}"/><path d="M44 30h6" stroke="${N}" stroke-width="2.4" stroke-linecap="round"/>`,
};
const svg = (n,s=44,vb='0 0 48 48') => `<svg viewBox="${vb}" width="${s}" height="${s}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ICONS[n]}</svg>`;

// ------------------------------------------------------------------ state ---

const state = { role:'PRINCIPAL', route:'dashboard', calMonth:7,
  studentQuery:'', studentClass:'', attClass:'c3', attStaffScope:'', examClass:'c3', examSubject:'s1',
  financeQuery:'', admissionStage:'', tab:'overview', ttClass:'c3', opsTab:'library', acTab:'lessons', acClass:'', webTab:'pages',
  auditQuery:'', filesQuery:'', permRole:null, reconStatement:'', libTab:'catalog', libQuery:'', libCat:'', transTab:'routes',
  invTab:'catalog', invQuery:'', invCat:'', invKind:'', commTab:'announcements',
  acctTab:'pending', acctCat:'', acctQuery:'' };

const NAV = [
  ['portal',       'My portal',    'M3 9l7-6 7 6v8a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z', 'portal.view'],
  ['dashboard',    'Dashboard',    'M3 9l7-6 7 6v8a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z', null],
  ['admissions',   'Admissions',   'M4 4h12v12H4zM7 8h6M7 11h6', 'admissions.view'],
  ['students',     'Students',     'M10 3l8 4-8 4-8-4zM5 9v4c0 1.5 2.2 3 5 3s5-1.5 5-3V9', 'students.view'],
  ['attendance',   'Attendance',   'M4 4h12v12H4zM7 9l2 2 3-4', 'attendance.view'],
  ['academics',    'Academics',    'M4 3h9l3 3v11H4zM7 8h6M7 11h6M7 14h4', 'academics.view'],
  ['timetable',    'Timetable',    'M3 5h14v12H3zM3 9h14M8 5v12', 'timetable.view'],
  ['exams',        'Examinations', 'M5 3h10v14H5zM8 7h4M8 10h4M8 13h2', 'examinations.view'],
  ['finance',      'Finance',      'M10 3v14M6 6h5a2.5 2.5 0 0 1 0 5H6M6 11h8', 'finance.view'],
  ['payroll',      'Payroll & HR', 'M3 7h14v9H3zM7 7V4h6v3M7 12h6', 'payroll.view'],
  ['operations',   'Operations',   'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2v2M10 16v2M2 10h2M16 10h2', ['library.view','transport.view','hostel.view','inventory.view']],
  ['communication','Communication','M3 5h14v9H3zM3 5l7 5 7-5', 'communication.view'],
  ['files',        'Files',        'M4 4a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'files.view'],
  ['staff',        'Staff',        'M7 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0M3 17c0-4 3-6 7-6s7 2 7 6', 'staff.view'],
  ['website',      'Website',      'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16M2 10h16M10 2c2 2.4 3 5 3 8s-1 5.6-3 8c-2-2.4-3-5-3-8s1-5.6 3-8', 'website.view'],
  ['reports',      'Reports',      'M4 16V8M9 16V4M14 16v-6', 'reports.view'],
  ['accounts',     'Admin Panel',  'M10 2l6 2.6v4.4c0 3.7-2.6 6.6-6 7.6-3.4-1-6-3.9-6-7.6V4.6zM7.4 10l1.9 1.9L13 8', canOpenAdminPanel],
  ['settings',     'Settings',     'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 1.5v2M10 16.5v2M3.5 6l1.7 1M14.8 13l1.7 1M3.5 14l1.7-1M14.8 7l1.7-1', 'settings.view'],
];

// ----------------------------------------------------------------- chrome ---

function renderNav(){
  $('#nav').innerHTML = NAV.map(([id,label,d,perm])=>{
    const ok = navAllowed(perm);
    const need = typeof perm === 'function' ? 'a higher access level'
               : Array.isArray(perm) ? perm.join(' or ') : perm;
    return `<button data-route="${id}" ${ok?'':'disabled'} aria-current="${state.route===id}"
      title="${ok?'':'Requires '+need}">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>
      ${label}</button>`;
  }).join('');
  $('#nav').querySelectorAll('button[data-route]').forEach(b=>
    b.addEventListener('click',()=>{ state.route=b.dataset.route; state.tab='overview'; render(); }));
}

function paintCrests(){
  const rail = $('#rail-crest');
  if(rail && !rail.firstChild) rail.innerHTML = logoIMG(40);
  document.querySelectorAll('[data-crest]').forEach(n=>{
    if(!n.firstChild) n.innerHTML = logoIMG(Number(n.dataset.crest));
  });
}

function renderHeader(){
  const r = ROLES[state.role];
  $('#who-name').textContent = r.name;
  const meId = r.scope==='SELF' ? r.studentId
             : db.staff.find(m=>`${m.firstName} ${m.lastName}`===r.name)?.id;
  const av = $('#who-av');
  if(meId && db.photos[meId]){
    av.innerHTML = `<img src="${db.photos[meId]}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">`;
    av.style.padding = '0'; av.style.overflow = 'hidden';
  } else {
    av.textContent = initials(...r.name.split(' '));
  }
  $('#term-chip').innerHTML = `<b>${TERM}</b> · ${SESSION} session`;
  $('#who-role').textContent = r.title;
  renderBell();
}

/** Notifications are addressed to a role, so "mine" is whatever is addressed
    to the signed-in role plus anything broadcast to everyone. */
function myNotifications(){
  return db.notifications.filter(n=>n.to===state.role || n.to==='ALL');
}

function renderBell(){
  const btn = $('#notif-bell');
  if(!btn) return;
  const unread = myNotifications().filter(n=>!n.read).length;
  btn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8z"/><path d="M8 15.5a2 2 0 0 0 4 0"/></svg>${unread?`<span class="dot">${unread>9?'9+':unread}</span>`:''}`;
}

function openNotifications(){
  const list = myNotifications();
  modal({
    title:'Notifications', sub: list.length ? `${list.filter(n=>!n.read).length} unread, addressed to ${esc(ROLES[state.role].title)}` : 'Nothing yet',
    body: list.length ? `<div class="tw"><table><tbody>${list.map(n=>`
        <tr>
          <td ${n.read?'':'style="background:var(--tint)"'}>
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
              <b style="font-size:12.5px">${esc(n.title)}</b>
              ${n.read?'':'<span class="pill p-info">NEW</span>'}
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(n.body)}</div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:5px">${fmtDateTime(n.at)}</div>
          </td>
        </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><b>No notifications</b>Activity relevant to ${esc(ROLES[state.role].title)} will show up here.</div>`,
    foot: list.some(n=>!n.read)
      ? `<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="notif-read-all">Mark all read</button>`
      : `<button class="btn btn-q" data-close>Close</button>`,
    wire(){
      const b = $('#notif-read-all');
      if(b) b.addEventListener('click', ()=>{
        list.forEach(n=>n.read=true);
        persist(); closeModal(); renderBell();
        toast('All notifications marked read.');
      });
    },
  });
}

// -------------------------------------------------------------- assistant ---
// A thin client for the real backend in server/ — everything in this block
// talks to Postgres-backed data over HTTP, not the in-memory `db` above.
// The chat history here is just this tab's view of it; the server is the
// source of truth (AiConversation/AiMessage), so nothing is lost by closing
// the panel, only by not having asked yet.

const aiState = { conversationId: null, messages: [] };

// apiState/ensureApiLogin are shared by the AI chat below *and* the Parent/
// Student/Teacher portal (script.js "portal" route) — both talk to the same
// real backend session, minted from the same demo account already signed
// into this (mock, client-only) app. See prisma/seed.js DEMO_USERS: every
// AUTH_USERS entry here has a same-named, same-password seeded account.
const apiState = { loggedIn: false };

/** Reads the non-httpOnly `csrf` cookie login sets (server/lib/requireCsrf.js
    — double-submit pattern) and echoes it back as a header on every
    mutating call. Empty before login / after logout, which is fine: the
    server only checks this on mutating requests, and there's no session to
    protect yet at that point anyway. */
function csrfHeader(){
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? {'X-CSRF-Token': decodeURIComponent(m[1])} : {};
}

async function ensureApiLogin(){
  if(apiState.loggedIn) return true;
  try{
    const res = await fetch(`${AI_API}/api/auth/login`, {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username: Auth.session.username, password:'fadesrek2026'}),
    });
    apiState.loggedIn = res.ok;
  } catch(e){ apiState.loggedIn = false; }
  return apiState.loggedIn;
}

/** Thin JSON fetch wrapper for the real backend — credentials + one
    401-retry, the same shape sendAiMessage below already hand-rolled for
    the AI endpoints. Throws on a non-OK response so callers can try/catch
    rather than checking `.ok` everywhere. */
async function apiFetch(path, opts={}){
  await ensureApiLogin();
  const { headers, ...rest } = opts;
  const doReq = () => fetch(`${AI_API}${path}`, {
    credentials:'include', headers:{'Content-Type':'application/json', ...csrfHeader(), ...headers}, ...rest,
  });
  let res = await doReq();
  if(res.status===401){ apiState.loggedIn=false; await ensureApiLogin(); res = await doReq(); }
  if(!res.ok){ const err = new Error(`api_error_${res.status}`); err.status = res.status; throw err; }
  return res;
}
async function apiGet(path){ return (await apiFetch(path)).json(); }
async function apiPost(path, body){ return (await apiFetch(path, {method:'POST', body:JSON.stringify(body)})).json(); }
async function apiPatch(path, body){ return (await apiFetch(path, {method:'PATCH', body:JSON.stringify(body)})).json(); }
async function apiPut(path, body){ return (await apiFetch(path, {method:'PUT', body:JSON.stringify(body)})).json(); }

/** Classifies a caught apiFetch error into a short reason code, so a page's
    error state can say something more useful than "check the backend" when
    the backend was actually fine and the real cause was, say, a missing
    permission or the login rate limit. `e.status` is set by apiFetch for
    any non-OK HTTP response; its absence means fetch() itself threw
    (backend unreachable, CORS, offline, ...). */
function apiErrorReason(e){
  if(!e || !e.status) return 'network';
  if(e.status===403) return 'permission';
  if(e.status===429) return 'rate_limited';
  return `http_${e.status}`;
}
function apiErrorMessage(reason){
  if(reason==='permission') return "Your account doesn't have permission to view this — sign in with a different role, or";
  if(reason==='rate_limited') return "Too many attempts in a short time — wait a few minutes, then";
  if(reason && reason.startsWith('http_')) return `The server returned an error (${reason.slice(5)}) — try again, or if it keeps happening,`;
  return 'Check that the backend (npm run dev:server) is running, then';
}

// ------------------------------------------------------------ real portal ---
// Modules 14-16 (Parent/Student/Teacher Portal) are the one place in this
// app that reads real backend data instead of the mock `db` above — every
// other route/module is untouched. `render()` is synchronous (PAGES[route]()
// returns an HTML string immediately), so real data needs a fetch-then-
// re-render cache rather than being read inline: PAGES.portal shows a
// loading state and calls loadPortalData() if the cache is empty, otherwise
// renders straight from it. Any action that changes something server-side
// (reply to a thread, hand in homework, mark a register) calls
// invalidatePortalCache() and reloads — the same "mutate, then render()"
// shape every other module in this file already uses, just with a fetch in
// between.

const REAL_PORTAL_ROLES = ['PARENT','STUDENT','TEACHER','CLASS_TEACHER','SUBJECT_TEACHER'];
const portalCache = { data:null, loading:false, error:false };
function invalidatePortalCache(){ portalCache.data = null; portalCache.error = false; }

async function loadPortalData(){
  if(portalCache.loading) return;
  portalCache.loading = true; portalCache.error = false;
  try{
    const me = await apiGet('/api/auth/me');
    let data;
    if(me.roleKey==='PARENT') data = await loadParentPortalData(me);
    else if(me.roleKey==='STUDENT') data = await loadStudentPortalData(me);
    else data = await loadTeacherPortalData(me);
    data.me = me;
    portalCache.data = data;
  } catch(e){
    portalCache.error = true;
  } finally{
    portalCache.loading = false;
    if(state.route==='portal') render();
  }
}

async function loadParentPortalData(me){
  const list = await apiGet('/api/students?pageSize=50');
  const [kids, invoices, payments, scores, notices, threads, subjects] = await Promise.all([
    Promise.all(list.data.map(s=>apiGet(`/api/students/${s.id}`))),
    apiGet('/api/finance/invoices?pageSize=200'),
    apiGet('/api/finance/payments?pageSize=200'),
    apiGet('/api/examinations/scores?pageSize=500'),
    apiGet('/api/communication/notices?pageSize=20'),
    apiGet('/api/communication/threads?pageSize=50'),
    apiGet('/api/settings/subjects/lookup'),
  ]);
  const perChild = await Promise.all(kids.map(async k=>{
    const classId = k.enrollments?.[0]?.classId || null;
    const [attendance, assignmentsRes] = await Promise.all([
      apiGet(`/api/attendance/records?studentId=${k.id}`),
      classId ? apiGet(`/api/academics/assignments?classId=${classId}&pageSize=50`) : Promise.resolve({data:[]}),
    ]);
    const submissions = (await Promise.all((assignmentsRes.data||[]).map(a=>
      apiGet(`/api/academics/assignments/${a.id}/submissions`).then(r=>r.data.map(x=>({...x, assignmentId:a.id})))
    ))).flat();
    return { student:k, classId, attendance:attendance.data, assignments:assignmentsRes.data||[], submissions };
  }));
  return { kids:perChild, invoices:invoices.data, payments:payments.data, scores:scores.data,
    notices:notices.data, threads:threads.data, subjects:subjects.data||[] };
}

async function loadStudentPortalData(me){
  if(!me.studentId) return { noStudent:true };
  const student = await apiGet(`/api/students/${me.studentId}`);
  const classId = student.enrollments?.[0]?.classId || null;
  const [scores, attendance, assignmentsRes, slotsRes, materialsRes, notificationsRes, subjects, periods] = await Promise.all([
    apiGet('/api/examinations/scores?pageSize=500'),
    apiGet(`/api/attendance/records?studentId=${me.studentId}`),
    classId ? apiGet(`/api/academics/assignments?classId=${classId}&pageSize=50`) : Promise.resolve({data:[]}),
    classId ? apiGet(`/api/timetable/slots?classId=${classId}&pageSize=100`) : Promise.resolve({data:[]}),
    classId ? apiGet(`/api/academics/materials?classId=${classId}`) : Promise.resolve({data:[]}),
    apiGet('/api/notifications?pageSize=20'),
    apiGet('/api/settings/subjects/lookup'),
    apiGet('/api/settings/periods/lookup'),
  ]);
  const submissions = (await Promise.all((assignmentsRes.data||[]).map(a=>
    apiGet(`/api/academics/assignments/${a.id}/submissions`).then(r=>r.data.map(x=>({...x, assignmentId:a.id})))
  ))).flat();
  return { student, classId, scores:scores.data, attendance:attendance.data, assignments:assignmentsRes.data||[],
    submissions, slots:slotsRes.data||[], materials:materialsRes.data||[], notifications:notificationsRes.data||[],
    subjects:subjects.data||[], periods:periods.data||[] };
}

async function loadTeacherPortalData(me){
  const classId = me.homeroomClassId;
  if(!classId) return { noClass:true };

  const todayISOReal = new Date().toISOString().slice(0,10);
  const [rosterRes, registersRes, assignmentsRes, scores, subjects, periods, slotsRes] = await Promise.all([
    apiGet('/api/students?pageSize=200'),
    apiGet(`/api/attendance/registers?classId=${classId}&date=${todayISOReal}`),
    apiGet(`/api/academics/assignments?classId=${classId}&pageSize=50`),
    apiGet('/api/examinations/scores?pageSize=1000'),
    apiGet('/api/settings/subjects/lookup'),
    apiGet('/api/settings/periods/lookup'),
    apiGet(`/api/timetable/slots?classId=${classId}&pageSize=100`),
  ]);

  let register = registersRes.data[0] || null;
  if(register) register = await apiGet(`/api/attendance/registers/${register.id}`);

  const submissions = (await Promise.all((assignmentsRes.data||[]).map(a=>
    apiGet(`/api/academics/assignments/${a.id}/submissions`).then(r=>r.data.map(x=>({...x, assignmentId:a.id})))
  ))).flat();

  return { classId, roster:rosterRes.data||[], register, assignments:assignmentsRes.data||[], submissions,
    scores:scores.data||[], subjects:subjects.data||[], periods:periods.data||[], slots:slotsRes.data||[] };
}

function renderAiThreadHTML(){
  if(!aiState.messages.length){
    return `<div class="empty"><b>Ask me anything</b>Try "Which students owe school fees?" or "Show today's attendance." Answers are scoped to what ${esc(ROLES[state.role].title)} can see.</div>`;
  }
  return aiState.messages.map(m=>{
    if(m.pending) return `<div class="ai-msg assistant pending"><div class="ai-bubble">···</div></div>`;
    const fb = (m.role==='assistant' && m.id) ? `
      <div class="ai-fb">
        <button class="ai-fb-btn ${m.feedback==='UP'?'active':''}" data-fb="UP" data-mid="${m.id}" aria-label="Good answer">&#128077;</button>
        <button class="ai-fb-btn ${m.feedback==='DOWN'?'active':''}" data-fb="DOWN" data-mid="${m.id}" aria-label="Not helpful">&#128078;</button>
      </div>` : '';
    return `<div class="ai-msg ${m.role}"><div class="ai-bubble">${esc(m.text)}</div>${fb}</div>`;
  }).join('');
}

function wireAiFeedback(){
  document.querySelectorAll('.ai-fb-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const mid = btn.dataset.mid, fb = btn.dataset.fb;
      const msg = aiState.messages.find(m=>m.id===mid);
      if(msg) msg.feedback = fb;
      btn.parentElement.querySelectorAll('.ai-fb-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      try{
        await fetch(`${AI_API}/api/ai/feedback`, {
          method:'POST', credentials:'include', headers:{'Content-Type':'application/json', ...csrfHeader()},
          body: JSON.stringify({messageId:mid, feedback:fb}),
        });
      } catch(e){ /* best-effort — feedback is a nicety, not a critical path */ }
    });
  });
}

function refreshAiThread(){
  const thread = $('#ai-thread');
  if(!thread) return; // panel was closed mid-request
  thread.innerHTML = renderAiThreadHTML();
  thread.scrollTop = thread.scrollHeight;
  wireAiFeedback();
}

async function sendAiMessage(text){
  aiState.messages.push({role:'user', text});
  aiState.messages.push({role:'assistant', text:'', pending:true});
  refreshAiThread();

  const doRequest = () => fetch(`${AI_API}/api/ai/query`, {
    method:'POST', credentials:'include', headers:{'Content-Type':'application/json', ...csrfHeader()},
    body: JSON.stringify({conversationId: aiState.conversationId, message:text}),
  });

  let json = null;
  try{
    await ensureApiLogin();
    let res = await doRequest();
    if(res.status===401){ apiState.loggedIn=false; await ensureApiLogin(); res = await doRequest(); }
    if(res.ok) json = await res.json();
  } catch(e){ json = null; }

  aiState.messages.pop(); // the pending placeholder
  if(!json){
    aiState.messages.push({role:'assistant', text:"I couldn't reach the AI service just now — check that the backend (npm run dev:server) is running, then try again."});
  } else {
    aiState.conversationId = json.conversationId;
    aiState.messages.push({role:'assistant', text:json.reply, id:json.messageId});
  }
  refreshAiThread();
}

function openAssistant(){
  modal({
    title:'AI Assistant', wide:true,
    sub:`Scoped to what ${esc(ROLES[state.role].title)} can see — it never shows you data your role can't access.`,
    body:`<div class="ai-panel">
      <div class="ai-thread" id="ai-thread">${renderAiThreadHTML()}</div>
      <form id="ai-form" class="ai-form">
        <input type="text" id="ai-input" placeholder="Ask a question…" autocomplete="off">
        <button type="submit" class="btn btn-p">Send</button>
      </form>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Close</button>`,
    wire(){
      wireAiFeedback();
      const thread = $('#ai-thread'); if(thread) thread.scrollTop = thread.scrollHeight;
      $('#ai-form').addEventListener('submit', async e=>{
        e.preventDefault();
        const input = $('#ai-input');
        const text = input.value.trim();
        if(!text) return;
        input.value=''; input.disabled = true;
        await sendAiMessage(text);
        input.disabled = false; input.focus();
      });
    },
  });
}

const PAGES = {};

function render(){
  renderHeader(); renderNav(); paintCrests();
  const nav = NAV.find(n=>n[0]===state.route);
  if(nav && nav[3] && !navAllowed(nav[3])){
    const detail = typeof nav[3] === 'function'
      ? `<code>${esc(ROLES[state.role].title)}</code> is not one of the roles this area is open to.`
      : `${ROLES[state.role].title} doesn't hold <code>${Array.isArray(nav[3])?nav[3].join(' or '):nav[3]}</code>. The API returns 403 for this route — it never lists what you do hold, so it can't be used to map someone's access.`;
    $('#page').innerHTML = `<div class="denied"><h2>Not available at this role</h2><p>${detail}</p></div>`;
    return;
  }
  $('#page').innerHTML = PAGES[state.route]();
  if(PAGES[state.route+'_wire']) PAGES[state.route+'_wire']();
  wirePhotoPickers();
}

// --------------------------------------------------------------- dashboard --

const ACTIONS = [
  ['addStaff','Add staff','staff.create',()=>openStaffForm()],
  ['addStudent','Add student','students.create',()=>openStudentForm()],
  ['attendance','Take attendance','attendance.create',()=>{state.route='attendance';state.tab='students';render();}],
  ['collectFees','Collect fees','finance.create',()=>{state.route='finance';render();}],
  ['scholarship','Award scholarship','finance.approve',()=>{state.route='finance';render();}],
  ['transport','Transport fees','finance.create',()=>{state.route='operations';state.opsTab='transport';render();}],
  ['hostel','Hostel fees','finance.create',()=>{state.route='operations';state.opsTab='hostel';render();}],
  ['income','Record income','finance.create',()=>{state.route='finance';state.tab='incexp';render();openIncomeForm();}],
  ['expense','Record expense','finance.create',()=>{state.route='finance';state.tab='incexp';render();openExpenseForm();}],
  ['notice','Post notice','communication.create',()=>openNoticeForm()],
  ['staffAttendance','Staff attendance','hr.view',()=>{state.route='attendance';state.tab='staff';render();}],
  ['leave','Staff leave','hr.approve',()=>{state.route='payroll';state.tab='leave';render();}],
];

const EVENTS = {
  '2026-08-10':{label:'Admissions screening opens',kind:'event'},
  '2026-08-15':{label:'Entrance examination',kind:'exam'},
  '2026-08-22':{label:'Interview panel — JSS 1 offers',kind:'event'},
  '2026-08-24':{label:'Staff development week begins',kind:'event'},
  '2026-08-28':{label:'Staff development week ends',kind:'event'},
  '2026-09-14':{label:'Resumption — First Term',kind:'event'},
};

function dashStats(){
  const mine = visibleStudents();
  const r = ROLES[state.role];
  if(state.role==='BURSAR'){
    const totals = db.students.reduce((a,s)=>{const f=feeSummary(s);a.b+=f.billed;a.p+=f.paid;a.owing+=f.balance>0?1:0;return a;},{b:0,p:0,owing:0});
    return [[naira(totals.p),'Collected'],[naira(totals.b-totals.p),'Outstanding'],[String(totals.owing),'Students owing'],[String(db.payments.length),'Payments recorded']];
  }
  if(state.role==='PARENT'){
    const owed = mine.reduce((t,s)=>t+feeSummary(s).balance,0);
    return [[String(mine.length),'Children enrolled'],[naira(Math.max(owed,0)),'Outstanding'],
            [(attendanceRate(mine[0]?.id)??'—')+'%','Attendance'],[String(mine.length),'Report cards ready']];
  }
  if(state.role==='CLASS_TEACHER'){
    const rec = db.attendance[`${todayISO()}:${r.classId}`];
    const present = rec ? Object.values(rec.roll).filter(v=>v!=='ABSENT').length : 0;
    return [['1','Your class'],[String(mine.length),'Students'],
            [rec?`${present}/${mine.length}`:'Not marked','Present today'],
            [String(subjectsFor(CLASSES.find(c=>c.id===r.classId)).length),'Subjects to mark']];
  }
  if(state.role==='REGISTRAR'){
    const pending = db.applications.filter(a=>!['OFFERED','ENROLLED','REJECTED'].includes(a.stage)).length;
    return [[String(pending),'To review'],[String(db.applications.filter(a=>a.stage==='OFFERED').length),'Offers made'],
            [String(db.students.length),'Enrolled'],[String(db.applications.length),'Applications']];
  }
  return [[String(CLASSES.length),'Total classes'],[String(db.students.filter(s=>s.status==='ACTIVE').length),'Total students'],
          [String(db.staff.length),'Total staff'],[String(db.applications.filter(a=>a.stage!=='OFFERED').length),'Pending admissions']];
}

PAGES.dashboard = () => {
  const stats = dashStats();
  const statIcons = ['sClasses','sStudents','sStaff','sPending'];
  const locked = ACTIONS.filter(([,,k])=>!can(k)).length;

  return `
  <div class="grid-actions">
    ${ACTIONS.map(([icon,label,key],i)=>{
      const ok = can(key);
      return `<button class="tile ${ok?'':'locked'}" ${ok?`data-act="${i}"`:'disabled'} title="${ok?key:'Requires '+key}">
        ${svg(icon)}<span class="lb">${label}</span></button>`;
    }).join('')}
  </div>

  <div class="grid-stats">
    ${stats.map(([v,l],i)=>`<div class="stat">${svg(statIcons[i],40)}<div><div class="v">${v}</div><div class="l">${l}</div></div></div>`).join('')}
  </div>

  <div class="grid-bottom">
    <section class="block">
      <h2>Calendar <small>2026</small></h2>
      <div class="cal-months" id="cal-months"></div>
      <div class="cal-grid" id="cal-grid"></div>
      <div class="cal-key"><span><i style="background:var(--blue)"></i>School event</span><span><i style="background:var(--clay)"></i>Examination</span></div>
    </section>
    <section class="block">
      <h2>Notice board <small>${db.notices.length} posted</small></h2>
      <div id="notice-list">${db.notices.map(n=>`
        <article class="notice ${n.cls}">
          <div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><span class="when">${esc(n.when)}</span></div>
          <svg viewBox="0 0 68 58" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ICONS[n.art]||ICONS.aExam}</svg>
        </article>`).join('')}</div>
    </section>
  </div>

  <p class="note"><b>${ROLES[state.role].title}</b> resolves to <b>${GRANTS[state.role].length}</b> of ${PERMISSIONS.length} permissions —
  ${MODULES.length} modules × ${VERBS.length} actions, checked independently.
  ${locked?`${locked} of the 12 tiles are greyed — hover to see the key each needs. Greyed rather than hidden, so nobody wonders why a colleague has a button they don't.`:'Every tile is available at this role.'}
  Scope is separate: <code>${ROLES[state.role].scope}</code> narrows what the queries return, not just what the screen shows.
  ${can('settings.view')?'See the <a href="#" data-goto="permissions">full permissions matrix</a>.':''}</p>`;
};

PAGES.dashboard_wire = () => {
  document.querySelectorAll('[data-act]').forEach(b=>
    b.addEventListener('click',()=>ACTIONS[+b.dataset.act][3]()));
  const goto = $('[data-goto="permissions"]');
  if(goto) goto.addEventListener('click', e=>{ e.preventDefault(); state.route='accounts'; state.acctTab='permissions'; render(); });
  renderCalendar();
};

function renderCalendar(){
  const mroot = $('#cal-months'); if(!mroot) return;
  mroot.innerHTML = MONTHS.map((m,i)=>`<button data-m="${i}" aria-pressed="${i===state.calMonth}">${m}</button>`).join('');
  mroot.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.calMonth=+b.dataset.m;renderCalendar();}));

  const first = new Date(2026,state.calMonth,1).getDay();
  const days = new Date(2026,state.calMonth+1,0).getDate();
  const cells = ['S','M','T','W','T','F','S'].map(d=>`<div class="dow">${d}</div>`);
  for(let i=0;i<first;i++) cells.push('<div class="day pad">0</div>');
  for(let d=1;d<=days;d++){
    const iso = `2026-${String(state.calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const ev = EVENTS[iso];
    const dow = new Date(2026,state.calMonth,d).getDay();
    const today = state.calMonth===TODAY.getMonth() && d===TODAY.getDate();
    cells.push(`<div class="day ${today?'today':''} ${ev?'event '+ev.kind:''} ${(dow===0||dow===6)&&!today?'weekend':''}" ${ev?`title="${esc(ev.label)}"`:''}>${d}</div>`);
  }
  $('#cal-grid').innerHTML = cells.join('');
}

// ---------------------------------------------------------------- students --

// -------------------------------------------------------------- students ---
// Real backend data — same fetch-then-cache-then-render shape as the portal
// and reports work above (render() is synchronous, so a fetch needs a cache
// to land in before the page can show it). classesCache is small reference
// data (GET /api/settings/classes/lookup) shared by the class filter here
// and by every form below that needs to pick a class (Add student, Promote).

const classesCache = { data:null, loading:false };
async function loadClasses(){
  if(classesCache.data || classesCache.loading) return classesCache.data;
  classesCache.loading = true;
  try{ classesCache.data = (await apiGet('/api/settings/classes/lookup')).data; }
  catch(e){ classesCache.data = []; }
  finally{ classesCache.loading = false; }
  return classesCache.data;
}

// Server-side search/class-filter (POST-mock, this is a real paginated
// table, not a client-side array to slice) — CLASS-scope roles (Class
// Teacher) are narrowed to their homeroom automatically by the API itself
// (server/rbac/permissionEngine.js#resolveScope), so the dropdown here just
// lists every class rather than trying to replicate that narrowing client-side.
const studentsCache = { data:null, meta:null, loading:false, error:false, errorReason:null };
function invalidateStudentsCache(){ studentsCache.data = null; studentsCache.error = false; }
async function loadStudentsData(){
  if(studentsCache.loading) return;
  studentsCache.loading = true; studentsCache.error = false; studentsCache.errorReason = null;
  try{
    await loadClasses();
    const params = new URLSearchParams({ pageSize:'60' });
    if(state.studentQuery) params.set('q', state.studentQuery);
    if(state.studentClass) params.set('classId', state.studentClass);
    const res = await apiGet(`/api/students?${params}`);
    studentsCache.data = res.data; studentsCache.meta = res.meta;
  } catch(e){ studentsCache.error = true; studentsCache.errorReason = apiErrorReason(e); }
  finally{ studentsCache.loading = false; if(state.route==='students') render(); }
}

PAGES.students = () => {
  if(studentsCache.error){
    return `<div class="empty"><b>Couldn't load students</b>${apiErrorMessage(studentsCache.errorReason)} <a href="#" id="st-retry">try again</a>.</div>`;
  }
  if(!studentsCache.data){
    loadStudentsData();
    return `<div class="empty"><b>Loading students…</b>Fetching records from the school's database.</div>`;
  }
  const list = studentsCache.data;
  const meta = studentsCache.meta;
  const classes = classesCache.data || [];

  return `
  <div class="phead">
    <div><h1>Students</h1>
      <p>${ROLES[state.role].scope==='GLOBAL'?'All enrolled students.':ROLES[state.role].scope==='CLASS'?'Narrowed to your class by the CLASS scope on your role.':'Narrowed to your own children by the OWN_RECORDS scope.'}</p></div>
    ${can('students.create')?'<button class="btn btn-y" id="add-student">Add student</button>':''}
  </div>

  <div class="toolbar">
    <input type="text" class="search" id="q" placeholder="Search name or admission no." value="${esc(state.studentQuery)}">
    <select class="pick" id="cls">
      <option value="">All classes</option>
      ${classes.map(c=>`<option value="${c.id}" ${state.studentClass===c.id?'selected':''}>${className(c)}</option>`).join('')}
    </select>
    <span class="spacer"></span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${meta.total} record${meta.total===1?'':'s'}</span>
  </div>

  ${list.length===0?`<div class="tw"><div class="empty"><b>No students match</b>Try a different class or clear the search.</div></div>`:`
  <div class="tw"><table>
    <thead><tr><th>Student</th><th>Class</th><th>Guardian</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.map(s=>{
      const enr = s.enrollments && s.enrollments[0];
      const g = s.guardians && s.guardians[0] && s.guardians[0].guardian;
      return `<tr>
        <td><div class="who-cell">${realAvatar(s)}
          <div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
        <td>${enr?className(enr.class):'<span style="color:var(--muted)">Not enrolled</span>'}${s.boarder?' <span class="pill p-info">BOARDER</span>':''}</td>
        <td>${g?`<div style="font-size:12.5px">${esc(g.firstName)} ${esc(g.lastName)}</div><div class="sm" style="font-family:var(--mono);font-size:10px;color:var(--muted)">${esc(g.phone)}</div>`:'<span style="color:var(--muted)">—</span>'}</td>
        <td><span class="pill ${LIFECYCLE_PILL[s.lifecycleStatus]}">${s.lifecycleStatus}</span></td>
        <td><button class="btn btn-q btn-s" data-view="${s.id}">Open</button></td>
      </tr>`;}).join('')}</tbody>
  </table></div>
  ${meta.total>list.length?`<p class="note">Showing ${list.length} of ${meta.total}. Narrow the search or pick a class to find a specific student.</p>`:''}`}`;
};

let studentSearchTimer = null;
PAGES.students_wire = () => {
  const retry = $('#st-retry'); if(retry) retry.addEventListener('click', e=>{ e.preventDefault(); invalidateStudentsCache(); render(); });
  const q = $('#q');
  if(q) q.addEventListener('input', e=>{
    state.studentQuery = e.target.value;
    clearTimeout(studentSearchTimer);
    studentSearchTimer = setTimeout(()=>{ invalidateStudentsCache(); render(); }, 350);
  });
  const cls = $('#cls'); if(cls) cls.addEventListener('change', e=>{ state.studentClass=e.target.value; invalidateStudentsCache(); render(); });
  const add = $('#add-student'); if(add) add.addEventListener('click',()=>openStudentForm());
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>openStudent(b.dataset.view)));
};

const LIFECYCLE_PILL = {
  ENROLLED:'p-ok', GRADUATED:'p-info', TRANSFERRED:'p-warn', WITHDRAWN:'p-bad',
};

// One fetch bundles everything every tab needs for one student — cheaper
// and simpler than each tab function firing its own request on every tab
// switch, and it means a mutation only has to invalidate one thing to make
// every tab refresh consistently. can()-gated pieces that this role has no
// permission for are just skipped rather than fired and left to 403.
const studentDetailCache = { id:null, data:null, loading:false, error:false, errorReason:null };
function invalidateStudentDetailCache(){ studentDetailCache.data = null; studentDetailCache.error = false; }
async function loadStudentDetail(id){
  if(studentDetailCache.loading) return;
  studentDetailCache.id = id; studentDetailCache.loading = true; studentDetailCache.error = false; studentDetailCache.errorReason = null;
  try{
    const term = await apiGet('/api/settings/current-term').catch(()=>null);
    const [student, medicalProfile, medicalVisits, behaviour, attendanceRecords, documents, certificates, timeline, biometrics, reportCard] = await Promise.all([
      apiGet(`/api/students/${id}`),
      can('medical.view') ? apiGet(`/api/medical/profiles/${id}`).catch(()=>null) : Promise.resolve(null),
      can('medical.view') ? apiGet(`/api/medical/visits?studentId=${id}`).then(r=>r.data).catch(()=>[]) : Promise.resolve([]),
      can('behaviour.view') ? apiGet(`/api/behaviour?studentId=${id}`).then(r=>r.data).catch(()=>[]) : Promise.resolve([]),
      can('attendance.view') ? apiGet(`/api/attendance/records?studentId=${id}`).then(r=>r.data).catch(()=>[]) : Promise.resolve([]),
      apiGet(`/api/students/${id}/documents`).then(r=>r.data),
      apiGet(`/api/students/${id}/certificates`).then(r=>r.data),
      apiGet(`/api/students/${id}/timeline`).then(r=>r.data),
      apiGet(`/api/students/${id}/biometrics`).then(r=>r.data),
      (can('examinations.view') && term && term.id) ? apiGet(`/api/examinations/report-card?studentId=${id}&termId=${term.id}`).catch(()=>null) : Promise.resolve(null),
    ]);
    studentDetailCache.data = { student, term, medicalProfile, medicalVisits, behaviour, attendanceRecords, documents, certificates, timeline, biometrics, reportCard };
  } catch(e){ studentDetailCache.error = true; studentDetailCache.errorReason = apiErrorReason(e); }
  finally{ studentDetailCache.loading = false; if(studentDetailCache.id===id) openStudent(id); }
}

/** The Student Information System home: one record, eight tabs. Each tab is
    its own render function so the modal body composes the same way a page
    would — the tab strip just swaps which one runs. */
function openStudent(id){
  if(studentDetailCache.id !== id) invalidateStudentDetailCache();
  studentDetailCache.id = id;

  if(studentDetailCache.error){
    modal({ title:'Student', body:`<div class="empty"><b>Couldn't load this student</b>${apiErrorMessage(studentDetailCache.errorReason)} <a href="#" id="sd-retry">try again</a>.</div>`,
      foot:`<button class="btn btn-q" data-close>Close</button>`,
      wire(){ $('#sd-retry').addEventListener('click', e=>{ e.preventDefault(); invalidateStudentDetailCache(); openStudent(id); }); } });
    return;
  }
  if(!studentDetailCache.data){
    loadStudentDetail(id);
    modal({ title:'Loading…', body:`<div class="empty"><b>Loading student record…</b>Fetching from the school's database.</div>`, foot:`<button class="btn btn-q" data-close>Close</button>` });
    return;
  }

  const { student:s } = studentDetailCache.data;
  if(!state.studentModalTab) state.studentModalTab = 'profile';
  const tab = state.studentModalTab;
  const enr = s.enrollments && s.enrollments[0];

  const tabs = [
    ['profile','Profile'],
    ['guardian','Guardian'],
    can('medical.view') ? ['medical','Medical'] : null,
    can('examinations.view') ? ['academic','Academic'] : null,
    can('attendance.view') ? ['attendance','Attendance'] : null,
    can('behaviour.view') ? ['behaviour','Behaviour'] : null,
    ['documents','Documents'],
    ['timeline','Timeline'],
  ].filter(Boolean);
  if(!tabs.some(t=>t[0]===tab)) state.studentModalTab = 'profile';

  const bodies = {
    profile: studentProfileTab, guardian: studentGuardianTab, medical: studentMedicalTab,
    academic: studentAcademicTab, attendance: studentAttendanceTab, behaviour: studentBehaviourTab,
    documents: studentDocumentsTab, timeline: studentTimelineTab,
  };

  modal({
    title:`${s.firstName} ${s.lastName}`,
    sub:`${esc(s.admissionNo)} · ${enr?className(enr.class):'Not enrolled'}${s.lifecycleStatus!=='ENROLLED'?` · <span class="pill ${LIFECYCLE_PILL[s.lifecycleStatus]}">${s.lifecycleStatus}</span>`:''}`,
    wide:true,
    body:`
      <div class="tabs">${tabs.map(([tid,label])=>`<button class="tab" data-stab="${tid}" aria-selected="${state.studentModalTab===tid}">${label}</button>`).join('')}</div>
      ${(bodies[state.studentModalTab]||studentProfileTab)(s)}`,
    foot:`<button class="btn btn-q" data-close>Close</button>`,
    wire(){
      document.querySelectorAll('[data-stab]').forEach(b=>b.addEventListener('click',()=>{
        state.studentModalTab = b.dataset.stab; openStudent(id);
      }));
      wireStudentTab(s);
    },
  });
}

// ------------------------------------------------------------------- profile
function studentProfileTab(s){
  const { term, reportCard, biometrics } = studentDetailCache.data;
  const enr = s.enrollments && s.enrollments[0];
  const canAct = can('students.approve') && s.lifecycleStatus==='ENROLLED';
  const feeBalance = reportCard && reportCard.feeBalanceKobo!==null ? Number(reportCard.feeBalanceKobo) : null;

  return `
      <div style="padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid var(--rule)">
        ${photoPicker({...s, gender: s.gender==='FEMALE'?'F':'M'}, 88)}
      </div>
      <div class="fgrid" style="align-items:start">
        <div>
          <h3 style="font-size:13px;margin-bottom:10px">Details</h3>
          <dl class="kv">
            <dt>Admission no.</dt><dd style="font-family:var(--mono);font-size:12px">${esc(s.admissionNo)}</dd>
            <dt>Class</dt><dd>${enr?className(enr.class):'<span style="color:var(--muted)">Not enrolled</span>'}</dd>
            <dt>Date of birth</dt><dd>${fmtDate(s.dob)}</dd>
            <dt>Gender</dt><dd>${s.gender==='FEMALE'?'Female':'Male'}</dd>
            <dt>Residence</dt><dd>${s.boarder?'Boarder':'Day student'}${s.usesTransport?' · uses transport':''}</dd>
            <dt>Status</dt><dd><span class="pill ${LIFECYCLE_PILL[s.lifecycleStatus]}">${s.lifecycleStatus}</span></dd>
            <dt>Biometric</dt><dd>${biometrics.length?biometrics.map(b=>`<span class="pill p-info">${b.type}</span>`).join(' '):'<span style="color:var(--muted)">Not enrolled</span>'}</dd>
          </dl>
        </div>
        <div>
          <h3 style="font-size:13px;margin-bottom:10px">This term${term?` <small style="font-weight:400;color:var(--muted)">· ${esc(term.name)}</small>`:''}</h3>
          ${reportCard?`<dl class="kv">
            <dt>Subjects scored</dt><dd>${reportCard.scores.length}</dd>
            <dt>Position</dt><dd>${reportCard.classPosition?ordinal(reportCard.classPosition)+' of '+reportCard.classSize:'—'}</dd>
            <dt>Attendance</dt><dd>${reportCard.attendanceRate===null?'Not yet marked':reportCard.attendanceRate+'%'}</dd>
            <dt>Fee balance</dt><dd style="color:${feeBalance>0?'var(--clay)':'var(--moss)'}">${feeBalance===null?'No invoice raised':nairaFull(Math.max(feeBalance,0))}</dd>
          </dl>`:`<p class="sub">${term?'No results, attendance or fee record for this term yet.':'No current term is set.'}</p>`}
        </div>
      </div>
      ${can('students.approve')||can('students.print')?`
      <div class="block" style="margin-top:18px">
        <h2 style="font-size:13.5px">Lifecycle</h2>
        <p class="sub">Promotion, graduation, transfer and withdrawal — each writes to the student's timeline and, where it applies, closes their active status.</p>
        <div class="toolbar" style="margin-bottom:0">
          ${canAct?`<button class="btn btn-q btn-s" id="act-promote">Promote</button>`:''}
          ${canAct&&enr&&enr.class.level==='SS 3'?`<button class="btn btn-q btn-s" id="act-graduate">Graduate</button>`:''}
          ${canAct?`<button class="btn btn-q btn-s" id="act-transfer">Transfer</button>`:''}
          ${canAct?`<button class="btn btn-d btn-s" id="act-withdraw">Withdraw</button>`:''}
          ${can('students.print')?`<button class="btn btn-q btn-s" id="act-certificate">Issue certificate</button>`:''}
          ${!canAct && s.lifecycleStatus!=='ENROLLED'?`<span style="font-size:12px;color:var(--muted)">No further lifecycle actions — record is ${s.lifecycleStatus.toLowerCase()}.</span>`:''}
        </div>
      </div>`:''}
      ${biometrics.length===0 && can('students.create')?`<div class="toolbar" style="margin-top:10px"><button class="btn btn-q btn-s" id="act-biometric">Enrol biometric</button></div>`:''}`;
}

// ------------------------------------------------------------------ guardian
function studentGuardianTab(s){
  const guardians = s.guardians || [];
  return `
    ${guardians.length?`<div class="tw"><table>
      <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th></tr></thead>
      <tbody>${guardians.map(sg=>`<tr>
        <td>${esc(sg.guardian.firstName)} ${esc(sg.guardian.lastName)} ${sg.isPrimary?'<span class="pill p-info">PRIMARY</span>':''}</td>
        <td>${esc(sg.relationship)}</td>
        <td style="font-family:var(--mono);font-size:11.5px">${esc(sg.guardian.phone)}</td>
        <td>${sg.guardian.email?esc(sg.guardian.email):'<span style="color:var(--muted)">—</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:`<div class="empty"><b>No guardian on file</b>Add one so the school has someone to contact.</div>`}
    ${can('students.edit')?`<div class="toolbar" style="margin-top:12px"><button class="btn btn-q btn-s" id="act-add-guardian">Add guardian</button></div>`:''}`;
}

// ------------------------------------------------------------------- medical
function studentMedicalTab(s){
  const mp = studentDetailCache.data.medicalProfile;
  const visits = studentDetailCache.data.medicalVisits;
  return `
    <div class="block" style="margin-bottom:0">
      <h2 style="font-size:13.5px">Health profile</h2>
      ${mp?`<dl class="kv" style="margin-top:10px">
        <dt>Blood group</dt><dd>${mp.bloodGroup||'—'}</dd>
        <dt>Genotype</dt><dd>${mp.genotype||'—'}</dd>
        <dt>Allergies</dt><dd>${esc(mp.allergies||'None recorded')}</dd>
        <dt>Conditions</dt><dd>${mp.conditions?esc(mp.conditions):'None recorded'}</dd>
        <dt>Physician</dt><dd>${mp.physicianName?`${esc(mp.physicianName)} · ${esc(mp.physicianPhone||'')}`:'—'}</dd>
        <dt>Emergency contact</dt><dd>${esc(mp.emergencyContactName||'—')} ${mp.emergencyContactPhone?`· ${esc(mp.emergencyContactPhone)}`:''}</dd>
        <dt>Insurance</dt><dd>${mp.insuranceProvider?`${esc(mp.insuranceProvider)} · ${esc(mp.insuranceNo||'')}`:'—'}</dd>
      </dl>`:`<p class="sub">No health profile on file yet.</p>`}
      ${can('medical.create')||can('medical.edit')?`<div class="toolbar" style="margin-top:12px;margin-bottom:0"><button class="btn btn-q btn-s" id="act-medical-profile">${mp?'Edit profile':'Create profile'}</button></div>`:''}
    </div>
    <h2 style="font-size:13.5px;margin-top:18px">Visit log</h2>
    ${visits.length?`<div class="tw" style="margin-top:8px"><table>
      <thead><tr><th>Date</th><th>Reason</th><th>Treatment</th></tr></thead>
      <tbody>${visits.map(v=>`<tr>
        <td style="font-family:var(--mono);font-size:11.5px">${fmtDate(v.visitedOn)}</td>
        <td>${esc(v.reason)}</td><td style="font-size:12.5px">${esc(v.treatment||'—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:`<div class="empty"><b>No visits recorded</b>Sick-bay visits will appear here.</div>`}
    ${can('medical.create')?`<div class="toolbar" style="margin-top:10px"><button class="btn btn-q btn-s" id="act-medical-visit">Log a visit</button></div>`:''}`;
}

// ------------------------------------------------------------------ academic
function studentAcademicTab(s){
  const { reportCard, term } = studentDetailCache.data;
  if(!reportCard) return `<div class="empty"><b>No results yet</b>${term?`Scores for ${esc(term.name)} will appear here once entered.`:'No current term is set.'}</div>`;
  const bySubject = new Map();
  for(const sc of reportCard.scores){
    if(!bySubject.has(sc.subject.id)) bySubject.set(sc.subject.id, { name:sc.subject.name, total:0, components:[] });
    const entry = bySubject.get(sc.subject.id);
    entry.total += sc.value;
    entry.components.push(`${sc.component.label} ${sc.value}`);
  }
  const rows = [...bySubject.values()];
  return `
    <div class="tw"><table>
      <thead><tr><th>Subject</th><th>Components</th><th class="num">Total</th><th>Grade</th></tr></thead>
      <tbody>${rows.length?rows.map(r=>{
        const g = gradeOf(r.total);
        return `<tr><td>${esc(r.name)}</td><td style="font-size:11.5px;color:var(--muted)">${esc(r.components.join(', '))}</td>
          <td class="num" style="font-weight:600">${r.total}</td><td><span class="pill ${r.total>=50?'p-ok':r.total>=40?'p-warn':'p-bad'}">${g.g}</span></td></tr>`;
      }).join(''):`<tr><td colspan="4"><div class="empty"><b>No scores entered</b>Subject scores for this term will appear here once entered.</div></td></tr>`}</tbody>
    </table></div>
    <p class="note">${esc(term.name)} · position ${reportCard.classPosition?ordinal(reportCard.classPosition)+' of '+reportCard.classSize:'not yet ranked'}.</p>`;
}

// ---------------------------------------------------------------- attendance
function studentAttendanceTab(s){
  const { reportCard } = studentDetailCache.data;
  const records = (studentDetailCache.data.attendanceRecords||[]).slice(0,15);
  const rate = reportCard ? reportCard.attendanceRate : null;
  return `
    <div class="grid-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="stat"><div><div class="v">${rate===null||rate===undefined?'—':rate+'%'}</div><div class="l">Term rate</div></div></div>
      <div class="stat"><div><div class="v">${records.filter(r=>r.mark==='ABSENT').length}</div><div class="l">Absences shown</div></div></div>
      <div class="stat"><div><div class="v">${records.filter(r=>r.mark==='LATE').length}</div><div class="l">Late shown</div></div></div>
    </div>
    ${records.length?`<div class="tw"><table>
      <thead><tr><th>Date</th><th>Class</th><th>Mark</th></tr></thead>
      <tbody>${records.map(r=>{
        const c = (classesCache.data||[]).find(x=>x.id===r.register.classId);
        return `<tr><td style="font-family:var(--mono);font-size:11.5px">${fmtDate(r.register.date)}</td><td>${c?className(c):'—'}</td>
        <td><span class="pill ${r.mark==='PRESENT'?'p-ok':r.mark==='LATE'?'p-warn':'p-bad'}">${r.mark}</span></td></tr>`;
      }).join('')}</tbody>
    </table></div>`:`<div class="empty"><b>No register entries yet</b>Marked registers will appear here.</div>`}`;
}

// --------------------------------------------------------------- behaviour
function studentBehaviourTab(s){
  const list = studentDetailCache.data.behaviour;
  return `
    ${list.length?`<div class="tw"><table>
      <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Action taken</th></tr></thead>
      <tbody>${list.map(b=>`<tr>
        <td style="font-family:var(--mono);font-size:11.5px">${fmtDate(b.occurredOn)}</td>
        <td><span class="pill ${b.category==='MERIT'?'p-ok':b.severity==='HIGH'?'p-bad':'p-warn'}">${b.category}</span></td>
        <td style="font-size:12.5px">${esc(b.description)}</td>
        <td style="font-size:12.5px">${esc(b.actionTaken||'—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:`<div class="empty"><b>No incidents on record</b>Merits and conduct notes will appear here.</div>`}
    ${can('behaviour.create')?`<div class="toolbar" style="margin-top:10px"><button class="btn btn-q btn-s" id="act-behaviour">Log an incident</button></div>`:''}`;
}

// -------------------------------------------------------------- documents
const DOC_CAT_LABEL = {BIRTH_CERTIFICATE:'Birth certificate', PASSPORT_PHOTO:'Passport photo',
  IMMUNISATION_RECORD:'Immunisation record', PREVIOUS_RESULT:'Previous result', INDIGENE_CERTIFICATE:'Indigene certificate',
  MEDICAL_REPORT:'Medical report', OTHER:'Other'};

function studentDocumentsTab(s){
  const docs = studentDetailCache.data.documents;
  const certs = studentDetailCache.data.certificates;
  return `
    <h2 style="font-size:13.5px">Archive</h2>
    ${docs.length?`<div class="tw" style="margin-top:8px"><table>
      <thead><tr><th>Document</th><th>Category</th><th>Uploaded</th><th>Verified</th></tr></thead>
      <tbody>${docs.map(d=>`<tr>
        <td>${esc(d.fileAsset?d.fileAsset.name:'—')}</td><td><span class="pill p-info">${DOC_CAT_LABEL[d.category]||d.category}</span></td>
        <td style="font-family:var(--mono);font-size:11px">${fmtDate(d.createdAt)}</td>
        <td>${d.verifiedOn?'<span class="pill p-ok">VERIFIED</span>':'<span class="pill p-mute">UNVERIFIED</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:`<div class="empty"><b>No documents archived</b>Birth certificates, photos and previous results will appear here.</div>`}
    <p class="note" style="margin-top:6px">File contents aren't stored yet — this records each document's name and category only.</p>
    ${can('students.create')?`<div class="toolbar" style="margin-top:10px"><button class="btn btn-q btn-s" id="act-doc-upload">Upload document</button></div>`:''}

    <h2 style="font-size:13.5px;margin-top:20px">Certificates</h2>
    ${certs.length?`<div class="tw" style="margin-top:8px"><table>
      <thead><tr><th>Type</th><th>Serial no.</th><th>Issued</th><th>Status</th></tr></thead>
      <tbody>${certs.map(c=>`<tr>
        <td>${c.certificateType}</td><td style="font-family:var(--mono);font-size:11.5px">${esc(c.serialNo)}</td>
        <td style="font-family:var(--mono);font-size:11px">${fmtDate(c.issuedOn)}</td>
        <td>${c.revoked?'<span class="pill p-bad">REVOKED</span>':'<span class="pill p-ok">VALID</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:`<p class="note" style="margin-top:8px">No certificates issued yet.</p>`}`;
}

// ---------------------------------------------------------------- timeline
// Colour-coded dots, not emoji — an emoji glyph depends on the OS having a
// matching font installed; a CSS background colour always renders the same.
const TIMELINE_COLOR = {ENROLLMENT:'var(--blue)', ACADEMIC:'var(--accent)', ATTENDANCE:'var(--moss)',
  BEHAVIOUR:'var(--amber)', MEDICAL:'var(--clay)', LIFECYCLE:'var(--navy)', DOCUMENT:'var(--muted)'};

function studentTimelineTab(s){
  const events = studentDetailCache.data.timeline;
  if(!events.length) return `<div class="empty"><b>Nothing recorded yet</b>Enrolment, results, behaviour and lifecycle events will build this student's history here.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:2px">
    ${events.map(e=>`
      <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--rule)">
        <div style="flex:none;width:26px;display:flex;align-items:center;justify-content:center">
          <span style="width:9px;height:9px;border-radius:50%;background:${TIMELINE_COLOR[e.category]||'var(--muted)'};display:inline-block"></span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:10px">
            <b style="font-size:12.5px">${esc(e.title)}</b>
            <span style="font-family:var(--mono);font-size:10.5px;color:var(--muted);white-space:nowrap">${fmtDate(e.occurredOn)}</span>
          </div>
          ${e.description?`<div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(e.description)}</div>`:''}
        </div>
      </div>`).join('')}
  </div>`;
}

/** Wires every action button across all eight tabs — only the ones present
    in the current tab's DOM actually find an element, the rest are no-ops. */
function wireStudentTab(s){
  const on = (id,fn) => { const b=$('#'+id); if(b) b.addEventListener('click',fn); };
  on('act-promote',        ()=>openPromoteForm(s));
  on('act-graduate',       ()=>openGraduateForm(s));
  on('act-transfer',       ()=>openTransferForm(s));
  on('act-withdraw',       ()=>openWithdrawForm(s));
  on('act-certificate',    ()=>openCertificateForm(s));
  on('act-biometric',      ()=>openBiometricForm(s));
  on('act-add-guardian',   ()=>openGuardianForm(s));
  on('act-medical-profile',()=>openMedicalProfileForm(s));
  on('act-medical-visit',  ()=>openMedicalVisitForm(s));
  on('act-behaviour',      ()=>openBehaviourForm(s));
  on('act-doc-upload',     ()=>openStudentDocUpload(s));
}

function openPromoteForm(s){
  const enr = s.enrollments && s.enrollments[0];
  const c = enr ? enr.class : null;
  const classes = classesCache.data || [];
  const LEVEL_ORDER = ['JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
  const nextLevel = c ? LEVEL_ORDER[LEVEL_ORDER.indexOf(c.level)+1] : null;
  const suggested = nextLevel ? (classes.find(x=>x.level===nextLevel && (x.arm===c.arm||x.stream===c.stream)) || classes.find(x=>x.level===nextLevel)) : null;
  modal({
    title:'Promote student', sub:`${esc(s.firstName)} ${esc(s.lastName)} — currently ${c?className(c):'not enrolled'}`,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Promote to</label><select id="pm-class">
        ${classes.map(x=>`<option value="${x.id}" ${suggested&&x.id===suggested.id?'selected':''}>${className(x)}</option>`).join('')}</select></div>
      <div class="f"><label>Outcome</label><select id="pm-outcome">
        <option value="PROMOTED">Promoted</option><option value="CONDITIONAL">Conditional</option><option value="REPEATED">Repeated — stay in current class</option></select></div>
      <div class="f wide"><label>Remarks</label><textarea id="pm-remarks" rows="2" placeholder="End-of-session promotion — all subjects passed."></textarea></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="pm-save">Promote</button>`,
    wire(){
      $('#pm-save').addEventListener('click', async ()=>{
        if(!enr){ toast('This student has no active enrolment to promote from.', true); return; }
        const toClassId = $('#pm-class').value, outcome = $('#pm-outcome').value, remarks = $('#pm-remarks').value.trim();
        try{
          await apiPost(`/api/students/${s.id}/promote`, {
            fromEnrollmentId: enr.id, toClassId: outcome==='REPEATED'?undefined:toClassId,
            outcome, remarks, decidedOn: new Date().toISOString().slice(0,10),
          });
          toast(`<b>${esc(s.firstName)} ${esc(s.lastName)}</b> ${outcome==='REPEATED'?'recorded as repeating the class':outcome.toLowerCase()}.`);
          invalidateStudentDetailCache(); invalidateStudentsCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not record the promotion.', true); }
      });
    },
  });
}

function openGraduateForm(s){
  const enr = s.enrollments && s.enrollments[0];
  const c = enr ? enr.class : null;
  modal({
    title:'Graduate student', sub:`${esc(s.firstName)} ${esc(s.lastName)} — ${c?className(c):'not enrolled'}`,
    body:`<div class="fgrid">
      <div class="f wide"><label>Remarks</label><textarea id="gr-remarks" rows="2" placeholder="Completed WASSCE, all subjects."></textarea></div>
    </div>
    <p class="note">Graduating closes this student's active enrolment and issues a graduation certificate.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="gr-save">Graduate</button>`,
    wire(){
      $('#gr-save').addEventListener('click', async ()=>{
        if(!enr){ toast('This student has no active enrolment to graduate from.', true); return; }
        const remarks = $('#gr-remarks').value.trim();
        try{
          await apiPost(`/api/students/${s.id}/graduate`, { classId: enr.classId, graduatedOn: new Date().toISOString().slice(0,10), remarks });
          toast(`<b>${esc(s.firstName)} ${esc(s.lastName)}</b> graduated.`);
          invalidateStudentDetailCache(); invalidateStudentsCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not record the graduation.', true); }
      });
    },
  });
}

// The real workflow splits a transfer into a request then a separate
// approval (server/routes/students.js POST /:id/transfer, PATCH
// /transfers/:id) — this form chains both for a role that holds both
// students.create and students.approve, so it still reads as one action.
function openTransferForm(s){
  modal({
    title:'Transfer student', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Destination school</label><input type="text" id="tr-school"><div class="err" id="e-trschool"></div></div>
      <div class="f wide"><label>Reason</label><textarea id="tr-reason" rows="2"></textarea></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="tr-save">Confirm transfer</button>`,
    wire(){
      $('#tr-save').addEventListener('click', async ()=>{
        const school = $('#tr-school').value.trim();
        const err = $('#e-trschool'); err.textContent='';
        if(!school){ err.textContent='Enter the destination school.'; return; }
        const reason = $('#tr-reason').value.trim();
        const today = new Date().toISOString().slice(0,10);
        try{
          const record = await apiPost(`/api/students/${s.id}/transfer`, { direction:'OUTGOING', otherSchoolName:school, reason, requestedOn:today });
          if(can('students.approve')) await apiPatch(`/api/students/transfers/${record.id}`, { transferStatus:'COMPLETED', effectiveOn:today });
          toast(`<b>${esc(s.firstName)} ${esc(s.lastName)}</b> marked transferred.`);
          invalidateStudentDetailCache(); invalidateStudentsCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not record the transfer.', true); }
      });
    },
  });
}

function openWithdrawForm(s){
  modal({
    title:'Withdraw student', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f"><label>Reason</label><select id="wd-reason">
        <option value="RELOCATION">Relocation</option><option value="FINANCIAL">Financial</option>
        <option value="ACADEMIC">Academic</option><option value="DISCIPLINARY">Disciplinary</option>
        <option value="MEDICAL">Medical</option><option value="OTHER">Other</option></select></div>
      <div class="f wide"><label>Detail</label><textarea id="wd-detail" rows="2"></textarea></div>
    </div>
    <p class="note">Withdrawing closes this student's active enrolment. This does not reverse any fees already paid.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-d" id="wd-save">Withdraw</button>`,
    wire(){
      $('#wd-save').addEventListener('click', async ()=>{
        const reason = $('#wd-reason').value, detail = $('#wd-detail').value.trim();
        try{
          await apiPost(`/api/students/${s.id}/withdraw`, { reason, detail, withdrawnOn: new Date().toISOString().slice(0,10), refundKobo:0 });
          toast(`${esc(s.firstName)} ${esc(s.lastName)} marked withdrawn.`);
          invalidateStudentDetailCache(); invalidateStudentsCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not record the withdrawal.', true); }
      });
    },
  });
}

function openCertificateForm(s){
  modal({
    title:'Issue certificate', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f wide"><label>Type</label><select id="ct-type">
        <option value="TESTIMONIAL">Testimonial</option><option value="RESULT">Result</option>
        <option value="BIRTH_ATTESTATION">Birth attestation</option>
        <option value="GRADUATION">Graduation</option><option value="TRANSFER">Transfer</option></select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="ct-save">Issue</button>`,
    wire(){
      $('#ct-save').addEventListener('click', async ()=>{
        const certificateType = $('#ct-type').value;
        const serialNo = `FA/CERT/${new Date().getFullYear()}/${Math.random().toString(16).slice(2,8).toUpperCase()}`;
        try{
          await apiPost(`/api/students/${s.id}/certificates`, { certificateType, serialNo, issuedOn: new Date().toISOString().slice(0,10) });
          toast(`Certificate ${serialNo} issued.`);
          invalidateStudentDetailCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not issue the certificate.', true); }
      });
    },
  });
}

/** kind picks which foreign key the enrolment is filed under and which
    profile re-opens afterwards — otherwise identical for a student or a
    member of staff.

    Only FACE is a real capture: it opens the machine's own camera and saves
    an actual still frame, the same way photoPicker() saves a profile photo.
    FINGERPRINT and IRIS need a vendor scanner SDK (SecuGen, ZKTeco, Suprema…)
    running as a local bridge service — a browser cannot reach that hardware
    on its own, so those stay disabled rather than faking a success. QR is
    just a badge code: a USB barcode scanner types it like a keyboard, so the
    text field already accepts a real scan. */
let bioCameraStream = null;
function openBiometricForm(s, kind='student'){
  const idField = kind==='staff' ? 'staffId' : 'studentId';
  let capturedPhoto = null;

  const hwNote = {
    FACE: 'Uses this device’s camera to capture an actual photo, stored on the enrolment record.',
    QR: 'Scan a badge with a USB barcode/QR scanner — it types into the field below like a keyboard.',
    FINGERPRINT: 'Requires a fingerprint scanner SDK (e.g. SecuGen, ZKTeco, Suprema) installed as a local bridge service. None is connected in this build, so enrolment is disabled for this modality.',
    IRIS: 'Requires an iris scanner SDK installed as a local bridge service. None is connected in this build, so enrolment is disabled for this modality.',
  };

  modal({
    title:'Enrol biometric', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f"><label>Modality</label><select id="bm-type">
        <option value="FACE">Face</option><option value="FINGERPRINT" disabled>Fingerprint (no scanner connected)</option>
        <option value="IRIS" disabled>Iris (no scanner connected)</option><option value="QR">QR code badge</option></select></div>
      <div class="f" id="bm-device-wrap"><label>Device</label><input type="text" id="bm-device" placeholder="Camera in use" readonly></div>
    </div>
    <div id="bm-capture-area"></div>
    <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:12.5px;line-height:1.5">
      <input type="checkbox" id="bm-consent" style="margin-top:3px">
      <span>A parent or guardian has consented to this biometric enrolment. Biometric data of a minor may not be captured without it.</span>
    </label>
    <div class="err" id="bm-err" style="margin-top:6px"></div>
    <p class="note" id="bm-hwnote"></p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="bm-save">Enrol</button>`,
    wire(){
      const typeSel = $('#bm-type');
      const err = $('#bm-err');
      const setErr = m => { err.textContent = m||''; };

      async function startCamera(){
        const area = $('#bm-capture-area');
        try{
          setErr('');
          bioCameraStream = await navigator.mediaDevices.getUserMedia({video:true});
          const track = bioCameraStream.getVideoTracks()[0];
          const devLabel = track?.label || 'Camera';
          $('#bm-device').value = devLabel;
          area.innerHTML = `<div style="margin-top:10px">
            <video id="bm-video" autoplay playsinline muted style="width:100%;max-width:320px;border-radius:10px;background:#000;aspect-ratio:1/1;object-fit:cover"></video>
            <canvas id="bm-canvas" style="display:none"></canvas>
            <div style="margin-top:8px"><button type="button" class="btn btn-q btn-s" id="bm-shoot">Capture photo</button></div>
          </div>`;
          const video = $('#bm-video');
          video.srcObject = bioCameraStream;
          $('#bm-shoot').addEventListener('click', capturePhoto);
        }catch(ex){
          setErr(ex.name==='NotAllowedError' ? 'Camera permission was denied.' : 'Could not access a camera on this device.');
        }
      }

      function capturePhoto(){
        const video = $('#bm-video');
        const side = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - side)/2, sy = (video.videoHeight - side)/2;
        const canvas = $('#bm-canvas');
        canvas.width = canvas.height = PHOTO_PX;
        canvas.getContext('2d').drawImage(video, sx, sy, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
        capturedPhoto = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
        if(bioCameraStream){ bioCameraStream.getTracks().forEach(t=>t.stop()); bioCameraStream = null; }
        $('#bm-capture-area').innerHTML = `<div style="margin-top:10px">
          <img src="${capturedPhoto}" alt="Captured photo" style="width:160px;height:160px;object-fit:cover;border-radius:10px">
          <div style="margin-top:8px"><button type="button" class="btn btn-q btn-s" id="bm-retake">Retake</button></div>
        </div>`;
        $('#bm-retake').addEventListener('click', ()=>{ capturedPhoto = null; startCamera(); });
      }

      function renderForType(){
        const type = typeSel.value;
        setErr('');
        $('#bm-hwnote').textContent = hwNote[type] || '';
        capturedPhoto = null;
        if(bioCameraStream){ bioCameraStream.getTracks().forEach(t=>t.stop()); bioCameraStream = null; }
        const deviceWrap = $('#bm-device-wrap');
        const area = $('#bm-capture-area');
        const saveBtn = $('#bm-save');

        if(type==='FACE'){
          deviceWrap.style.display = '';
          $('#bm-device').value = '';
          area.innerHTML = `<div style="margin-top:10px"><button type="button" class="btn btn-q btn-s" id="bm-start">Start camera</button></div>`;
          $('#bm-start').addEventListener('click', startCamera);
          saveBtn.disabled = false;
        } else if(type==='QR'){
          deviceWrap.style.display = 'none';
          area.innerHTML = `<div class="f wide" style="margin-top:10px"><label>Badge code</label><input type="text" id="bm-badge" placeholder="Scan or type the badge code"></div>`;
          saveBtn.disabled = false;
        } else {
          deviceWrap.style.display = 'none';
          area.innerHTML = '';
          saveBtn.disabled = true;
        }
      }

      typeSel.addEventListener('change', renderForType);
      renderForType();

      $('#bm-save').addEventListener('click', async ()=>{
        const type = typeSel.value;
        if(!$('#bm-consent').checked){ setErr('Confirm guardian consent before enrolling.'); return; }

        let device = '', extra = {};
        if(type==='FACE'){
          if(!capturedPhoto){ setErr('Capture a photo first.'); return; }
          device = $('#bm-device').value || 'Camera';
          extra = { photoData: capturedPhoto, capturedAt: new Date().toISOString() };
        } else if(type==='QR'){
          const badge = ($('#bm-badge')?.value||'').trim();
          if(!badge){ setErr('Scan or enter the badge code.'); return; }
          device = badge;
          extra = { badgeCode: badge };
        } else {
          return; // FINGERPRINT / IRIS: no SDK connected, Enrol stays disabled.
        }

        // Staff biometrics are still mock db (Staff isn't wired to the real
        // backend yet) — only the student path below talks to the API.
        if(kind==='staff'){
          db.biometrics.push({id:uid('bm'), [idField]:s.id, type, enrolledOn:todayISO(), deviceId:device, consentConfirmed:true, ...extra});
          logAudit('staff.biometric', `${type} biometric enrolled for ${s.firstName} ${s.lastName}`);
          persist(); closeModal();
          toast('Biometric enrolled.');
          openStaffProfile(s.id);
          return;
        }

        // No object storage configured for the captured frame (see
        // FileAsset's schema comment) — templateRef is just an opaque
        // pointer, the same contract any real device integration would use.
        const templateRef = type==='FACE' ? `face_${Date.now().toString(36)}` : device;
        try{
          await apiPost(`/api/students/${s.id}/biometrics`, { type, templateRef, enrolledOn: new Date().toISOString().slice(0,10), deviceId: device });
          toast('Biometric enrolled.');
          invalidateStudentDetailCache();
          closeModal(); openStudent(s.id);
        } catch(ex){ setErr('Could not enrol this biometric — it may already be enrolled for this modality.'); }
      });
    },
  });
}

function openGuardianForm(s){
  modal({
    title:'Add guardian', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f"><label class="req">First name</label><input type="text" id="gd-first"><div class="err" id="e-gdfirst"></div></div>
      <div class="f"><label class="req">Surname</label><input type="text" id="gd-last"><div class="err" id="e-gdlast"></div></div>
      <div class="f"><label>Relationship</label><input type="text" id="gd-rel" placeholder="Uncle, Aunt, ..."></div>
      <div class="f"><label class="req">Phone</label><input type="text" id="gd-phone" placeholder="08012345678"><div class="err" id="e-gdphone"></div></div>
      <div class="f wide"><label>Email</label><input type="text" id="gd-email"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="gd-save">Add guardian</button>`,
    wire(){
      $('#gd-save').addEventListener('click', async ()=>{
        const v = id => ($('#'+id)?.value||'').trim();
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const errs = {};
        if(!v('gd-first')) errs['e-gdfirst']='Enter the first name.';
        if(!v('gd-last')) errs['e-gdlast']='Enter the surname.';
        const phone = v('gd-phone');
        if(!phone) errs['e-gdphone']='Enter a phone number.';
        else if(!/^0[789][01]\d{8}$/.test(phone)) errs['e-gdphone']='Use an 11-digit Nigerian number.';
        if(Object.keys(errs).length){ for(const [k,m] of Object.entries(errs)){const n=$('#'+k);if(n)n.textContent=m;} return; }
        try{
          const guardian = await apiPost('/api/students/guardians', { firstName:v('gd-first'), lastName:v('gd-last'), phone, email:v('gd-email')||undefined });
          await apiPost(`/api/students/${s.id}/guardians`, { guardianId:guardian.id, relationship:v('gd-rel')||'Guardian', isPrimary:false });
          toast('Guardian added.');
          invalidateStudentDetailCache(); invalidateStudentsCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not add the guardian.', true); }
      });
    },
  });
}

const BLOOD_GROUPS = [['A_POS','A+'],['A_NEG','A-'],['B_POS','B+'],['B_NEG','B-'],['AB_POS','AB+'],['AB_NEG','AB-'],['O_POS','O+'],['O_NEG','O-']];

function openMedicalProfileForm(s){
  const mp = studentDetailCache.data.medicalProfile || {};
  const primary = (s.guardians||[]).find(g=>g.isPrimary) || (s.guardians||[])[0];
  const guardianName = primary ? `${primary.guardian.firstName} ${primary.guardian.lastName}` : '';
  const guardianPhone = primary ? primary.guardian.phone : '';
  modal({
    title: studentDetailCache.data.medicalProfile ? 'Edit health profile' : 'Create health profile', sub:`${esc(s.firstName)} ${esc(s.lastName)}`, wide:true,
    body:`<div class="fgrid">
      <div class="f"><label>Blood group</label><select id="mp-blood"><option value="">—</option>${BLOOD_GROUPS.map(([val,label])=>`<option value="${val}" ${mp.bloodGroup===val?'selected':''}>${label}</option>`).join('')}</select></div>
      <div class="f"><label>Genotype</label><select id="mp-geno"><option value="">—</option>${['AA','AS','SS','AC'].map(g=>`<option ${mp.genotype===g?'selected':''}>${g}</option>`).join('')}</select></div>
      <div class="f wide"><label>Allergies</label><input type="text" id="mp-allergies" value="${esc(mp.allergies||'')}"></div>
      <div class="f wide"><label>Conditions</label><input type="text" id="mp-conditions" value="${esc(mp.conditions||'')}"></div>
      <div class="f"><label>Physician name</label><input type="text" id="mp-phys" value="${esc(mp.physicianName||'')}"></div>
      <div class="f"><label>Physician phone</label><input type="text" id="mp-physphone" value="${esc(mp.physicianPhone||'')}"></div>
      <div class="f"><label>Emergency contact</label><input type="text" id="mp-ec" value="${esc(mp.emergencyContactName||guardianName)}"></div>
      <div class="f"><label>Emergency phone</label><input type="text" id="mp-ecphone" value="${esc(mp.emergencyContactPhone||guardianPhone)}"></div>
      <div class="f"><label>Insurance provider</label><input type="text" id="mp-ins" value="${esc(mp.insuranceProvider||'')}"></div>
      <div class="f"><label>Insurance no.</label><input type="text" id="mp-insno" value="${esc(mp.insuranceNo||'')}"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="mp-save">Save profile</button>`,
    wire(){
      $('#mp-save').addEventListener('click', async ()=>{
        const v = id => ($('#'+id)?.value||'').trim();
        try{
          await apiPut(`/api/medical/profiles/${s.id}`, {
            bloodGroup:v('mp-blood')||undefined, genotype:v('mp-geno')||undefined,
            allergies:v('mp-allergies'), conditions:v('mp-conditions'),
            physicianName:v('mp-phys'), physicianPhone:v('mp-physphone'),
            emergencyContactName:v('mp-ec'), emergencyContactPhone:v('mp-ecphone'),
            insuranceProvider:v('mp-ins'), insuranceNo:v('mp-insno'),
          });
          toast('Health profile saved.');
          invalidateStudentDetailCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not save the health profile.', true); }
      });
    },
  });
}

function openMedicalVisitForm(s){
  modal({
    title:'Log a sick-bay visit', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Reason</label><input type="text" id="mv-reason"><div class="err" id="e-mvreason"></div></div>
      <div class="f wide"><label>Treatment given</label><textarea id="mv-treatment" rows="2"></textarea></div>
      <div class="f wide"><label>Notes</label><textarea id="mv-notes" rows="2"></textarea></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="mv-save">Save visit</button>`,
    wire(){
      $('#mv-save').addEventListener('click', async ()=>{
        const reason = $('#mv-reason').value.trim();
        const err = $('#e-mvreason'); err.textContent='';
        if(!reason){ err.textContent='Enter a reason for the visit.'; return; }
        try{
          await apiPost('/api/medical/visits', {
            studentId:s.id, visitedOn: new Date().toISOString().slice(0,10), reason,
            treatment:$('#mv-treatment').value.trim(), notes:$('#mv-notes').value.trim(),
          });
          toast('Visit logged.');
          invalidateStudentDetailCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not save the visit.', true); }
      });
    },
  });
}

function openBehaviourForm(s){
  modal({
    title:'Log a behaviour incident', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f"><label>Type</label><select id="bh-cat"><option value="MERIT">Merit</option><option value="DEMERIT">Demerit</option></select></div>
      <div class="f"><label>Severity</label><select id="bh-sev"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></div>
      <div class="f wide"><label class="req">Description</label><textarea id="bh-desc" rows="2"></textarea><div class="err" id="e-bhdesc"></div></div>
      <div class="f wide"><label>Action taken</label><input type="text" id="bh-action"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="bh-save">Log incident</button>`,
    wire(){
      $('#bh-save').addEventListener('click', async ()=>{
        const desc = $('#bh-desc').value.trim();
        const err = $('#e-bhdesc'); err.textContent='';
        if(!desc){ err.textContent='Describe what happened.'; return; }
        try{
          await apiPost('/api/behaviour', {
            studentId:s.id, occurredOn: new Date().toISOString().slice(0,10), category:$('#bh-cat').value,
            severity:$('#bh-sev').value, description:desc, actionTaken:$('#bh-action').value.trim(),
          });
          toast('Incident logged.');
          invalidateStudentDetailCache();
          closeModal(); openStudent(s.id);
        } catch(e){ toast('Could not log the incident.', true); }
      });
    },
  });
}

function openStudentDocUpload(s){
  modal({
    title:'Upload document', sub:`${esc(s.firstName)} ${esc(s.lastName)}`,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">File</label><input type="file" id="sd-file"><div class="err" id="e-sdfile"></div></div>
      <div class="f"><label>Category</label><select id="sd-cat">${Object.entries(DOC_CAT_LABEL).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div>
    </div>
    <p class="note">Only the document's name and category are recorded — there's no file storage configured yet, so the file's contents aren't kept.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="sd-save">Upload</button>`,
    wire(){
      $('#sd-save').addEventListener('click', async ()=>{
        const err = $('#e-sdfile'); err.textContent='';
        const file = $('#sd-file').files[0];
        if(!file){ err.textContent='Choose a file first.'; return; }
        const category = $('#sd-cat').value;
        try{
          const storageKey = `local/${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}-${file.name}`;
          const asset = await apiPost('/api/files', { name:file.name, category, storageKey, sizeBytes:file.size, mimeType:file.type });
          await apiPost(`/api/students/${s.id}/documents`, { category, fileAssetId:asset.id });
          toast('Document recorded.');
          invalidateStudentDetailCache();
          closeModal(); openStudent(s.id);
        } catch(ex){ err.textContent = ex.status===400 ? "That file type isn't supported — use PDF, Word, Excel, or an image." : 'Could not record the document.'; }
      });
    },
  });
}

function openStudentForm(){
  const classes = classesCache.data || [];
  modal({
    title:'Add student', sub:'Creates the student record, this session\u2019s enrolment and a primary guardian together.',
    body:`<div class="fgrid">
      <div class="f"><label class="req">First name</label><input type="text" id="nf-first"><div class="err" id="e-first"></div></div>
      <div class="f"><label class="req">Surname</label><input type="text" id="nf-last"><div class="err" id="e-last"></div></div>
      <div class="f"><label class="req">Date of birth</label><input type="date" id="nf-dob" max="2020-01-01"><div class="err" id="e-dob"></div></div>
      <div class="f"><label>Gender</label><select id="nf-gender"><option value="MALE">Male</option><option value="FEMALE">Female</option></select></div>
      <div class="f"><label class="req">Class</label><select id="nf-class">${classes.map(c=>`<option value="${c.id}">${className(c)}</option>`).join('')}</select></div>
      <div class="f"><label>Residence</label><select id="nf-res"><option value="day">Day student</option><option value="boarder">Boarder</option></select></div>
      <div class="f"><label class="req">Guardian first name</label><input type="text" id="nf-gfirst"><div class="err" id="e-gfirst"></div></div>
      <div class="f"><label class="req">Guardian surname</label><input type="text" id="nf-glast"><div class="err" id="e-glast"></div></div>
      <div class="f"><label class="req">Guardian phone</label><input type="text" id="nf-phone" placeholder="08012345678"><div class="err" id="e-phone"></div></div>
    </div>
    <p class="note">The admission number is generated on save \u2014 the school can change it afterwards.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="nf-save">Save student</button>`,
    wire(){ $('#nf-save').addEventListener('click',saveStudent); },
  });
}

async function saveStudent(){
  const v = id => ($('#'+id)?.value||'').trim();
  const errs = {};
  if(!v('nf-first')) errs['e-first']='Enter the first name.';
  if(!v('nf-last')) errs['e-last']='Enter the surname.';
  if(!v('nf-dob')) errs['e-dob']='Enter the date of birth.';
  if(!v('nf-gfirst')) errs['e-gfirst']='Enter the guardian\u2019s first name.';
  if(!v('nf-glast')) errs['e-glast']='Enter the guardian\u2019s surname.';
  const phone = v('nf-phone');
  if(!phone) errs['e-phone']='Enter a phone number.';
  else if(!/^0[789][01]\d{8}$/.test(phone)) errs['e-phone']='Use an 11-digit Nigerian number, e.g. 08012345678.';

  document.querySelectorAll('.err').forEach(e=>e.textContent='');
  if(Object.keys(errs).length){
    for(const [id,msg] of Object.entries(errs)) { const n=$('#'+id); if(n) n.textContent=msg; }
    return;
  }

  const classId = v('nf-class');
  const btn = $('#nf-save');
  if(btn) btn.disabled = true;
  try{
    const term = await apiGet('/api/settings/current-term').catch(()=>null);
    if(!term || !term.academicSessionId){
      toast('No current academic session is set \u2014 ask an administrator to set one first.', true);
      if(btn) btn.disabled = false;
      return;
    }
    const admissionNo = `FA/${new Date().getFullYear()}/${Math.random().toString(16).slice(2,8).toUpperCase()}`;
    const student = await apiPost('/api/students', {
      admissionNo, firstName:v('nf-first'), lastName:v('nf-last'), gender:v('nf-gender'), dob:v('nf-dob'),
      boarder: v('nf-res')==='boarder', usesTransport:false, enrolledOn: new Date().toISOString().slice(0,10),
    });
    await apiPost(`/api/students/${student.id}/enrollments`, { classId, academicSessionId: term.academicSessionId });
    const guardian = await apiPost('/api/students/guardians', { firstName:v('nf-gfirst'), lastName:v('nf-glast'), phone });
    await apiPost(`/api/students/${student.id}/guardians`, { guardianId:guardian.id, relationship:'Guardian', isPrimary:true });
    invalidateStudentsCache();
    closeModal();
    toast(`<b>${esc(student.firstName)} ${esc(student.lastName)}</b> added as ${esc(admissionNo)}.`);
  } catch(e){
    toast('Could not save the student.', true);
    if(btn) btn.disabled = false;
  }
}

// -------------------------------------------------------------- attendance --
// Real backend data for the Student register + Reports tabs — see
// server/routes/attendance.js: registers are per (classId, date), students
// only. The Staff register tab stays on mock db below: there is no
// StaffAttendance* model in the schema at all (not just "not wired yet"),
// so it has nothing real to switch to until a Staff/HR pass adds one.

// Shared "who am I, really" lookup (real session, not the mock ROLES entry)
// — needed here to resolve a Class Teacher's actual homeroomClassId, and
// reusable by any future module that needs the signed-in user's real ids.
const meCache = { data:null, loading:false };
async function loadMe(){
  if(meCache.data || meCache.loading) return meCache.data;
  meCache.loading = true;
  try{ meCache.data = await apiGet('/api/auth/me'); } catch(e){ meCache.data = null; }
  finally{ meCache.loading = false; }
  return meCache.data;
}

const attendanceCache = { classId:null, date:null, roster:null, register:null, loading:false, error:false, errorReason:null };
function invalidateAttendanceCache(){ attendanceCache.classId = null; attendanceCache.roster = null; attendanceCache.register = null; attendanceCache.error = false; }
async function loadAttendanceData(classId){
  if(attendanceCache.loading) return;
  attendanceCache.loading = true; attendanceCache.error = false; attendanceCache.errorReason = null;
  const date = new Date().toISOString().slice(0,10);
  try{
    const [rosterRes, registersRes] = await Promise.all([
      apiGet(`/api/students?classId=${classId}&pageSize=100`),
      apiGet(`/api/attendance/registers?classId=${classId}&date=${date}`),
    ]);
    let register = registersRes.data[0] || null;
    if(register) register = await apiGet(`/api/attendance/registers/${register.id}`);
    attendanceCache.classId = classId; attendanceCache.date = date;
    attendanceCache.roster = rosterRes.data; attendanceCache.register = register;
  } catch(e){ attendanceCache.error = true; attendanceCache.errorReason = apiErrorReason(e); }
  finally{ attendanceCache.loading = false; if(state.route==='attendance' && state.tab!=='staff' && state.tab!=='reports') render(); }
}

const attendanceReportsCache = { data:null, loading:false, error:false, errorReason:null };
function invalidateAttendanceReportsCache(){ attendanceReportsCache.data = null; attendanceReportsCache.error = false; }
async function loadAttendanceReportsData(){
  if(attendanceReportsCache.loading) return;
  attendanceReportsCache.loading = true; attendanceReportsCache.error = false; attendanceReportsCache.errorReason = null;
  try{ attendanceReportsCache.data = await apiGet('/api/reports/attendance-summary'); }
  catch(e){ attendanceReportsCache.error = true; attendanceReportsCache.errorReason = apiErrorReason(e); }
  finally{ attendanceReportsCache.loading = false; if(state.route==='attendance' && state.tab==='reports') render(); }
}

/** Three tabs on one module: the student register (per class, as before),
    a staff register (one roll for the whole school — a teacher is still
    just a staff member, so a second parallel register would only invite the
    two to drift apart), and a reports view neither had before. */
PAGES.attendance = () => {
  const tabs = [['students','Student register'], ...(can('hr.view')?[['staff','Staff register']]:[]), ['reports','Reports']];
  if(!tabs.some(t=>t[0]===state.tab)) state.tab = 'students';

  return `
  <div class="phead"><div><h1>Attendance</h1>
    <p>Marked once here, read everywhere else the app needs a rate — report cards, dashboards, and the alerts that go home.</p></div></div>

  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-attab="${id}" aria-selected="${state.tab===id}">${l}</button>`).join('')}</div>

  ${state.tab==='staff' ? attendanceStaffBody() : state.tab==='reports' ? attendanceReportsBody() : attendanceStudentBody()}`;
};

PAGES.attendance_wire = () => {
  document.querySelectorAll('[data-attab]').forEach(b=>b.addEventListener('click',()=>{ state.tab=b.dataset.attab; render(); }));
  if(state.tab==='staff') wireStaffAttendance();
  else if(state.tab==='reports') wireAttendanceReports();
  else wireStudentAttendance();
};

function attendanceStudentBody(){
  const r = ROLES[state.role];

  if(attendanceCache.error){
    return `<div class="tw" style="margin-top:14px"><div class="empty"><b>Couldn't load the register</b>${apiErrorMessage(attendanceCache.errorReason)} <a href="#" id="att-retry">try again</a>.</div></div>`;
  }
  const needsMe = r.scope==='CLASS' && !meCache.data;
  const needsClasses = !classesCache.data;
  if(needsMe || needsClasses){
    const rerender = () => { if(state.route==='attendance' && state.tab!=='staff' && state.tab!=='reports') render(); };
    if(needsMe) loadMe().then(rerender);
    if(needsClasses) loadClasses().then(rerender);
    return `<div class="tw" style="margin-top:14px"><div class="empty"><b>Loading…</b>${needsMe?'Finding your homeroom class.':'Fetching classes.'}</div></div>`;
  }
  const classes = classesCache.data || [];
  const classId = r.scope==='CLASS' ? (meCache.data && meCache.data.homeroomClassId) : (state.attClass || (classes[0] && classes[0].id) || '');
  if(r.scope==='CLASS' && !classId){
    return `<div class="tw" style="margin-top:14px"><div class="empty"><b>No homeroom class</b>This account isn't set as class teacher for any class, so there's no register to take here.</div></div>`;
  }
  if(!classId){
    return `<div class="tw" style="margin-top:14px"><div class="empty"><b>No classes set up yet</b></div></div>`;
  }
  if(attendanceCache.classId !== classId){
    loadAttendanceData(classId);
    return `<div class="tw" style="margin-top:14px"><div class="empty"><b>Loading register…</b>Fetching today's roster from the school's database.</div></div>`;
  }

  const c = classes.find(x=>x.id===classId);
  const roster = attendanceCache.roster || [];
  const register = attendanceCache.register;
  const editable = can('attendance.create');
  const marked = register && !register.isDraft;
  const recordByStudent = new Map((register?.records||[]).map(x=>[x.studentId, x.mark]));
  const present = roster.filter(s=>recordByStudent.get(s.id) && recordByStudent.get(s.id)!=='ABSENT').length;

  return `
  <div class="toolbar" style="margin-top:14px">
    ${r.scope==='CLASS' ? `<span class="pill p-info">${className(c)} — your class</span>` :
      `<select class="pick" id="att-class">${classes.map(x=>`<option value="${x.id}" ${x.id===classId?'selected':''}>${className(x)}</option>`).join('')}</select>`}
    <span class="spacer"></span>
    ${marked?`<span class="pill p-ok">SAVED · ${present}/${roster.length} present</span>`:'<span class="pill p-warn">NOT MARKED</span>'}
    ${editable?`<button class="btn btn-y btn-s" id="take-register">${register?'Update register':'Take the register'}</button>`:''}
  </div>

  <div class="tw"><table>
    <thead><tr><th>Student</th><th>Status</th></tr></thead>
    <tbody>${roster.map(s=>{
      const mark = recordByStudent.get(s.id);
      return `<tr>
        <td><div class="who-cell">${realAvatar(s)}
          <div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
        <td>${mark?`<span class="pill ${mark==='ABSENT'?'p-bad':mark==='LATE'?'p-warn':'p-ok'}">${mark}</span>`:'<span class="pill p-mute">—</span>'}</td>
      </tr>`;}).join('')}</tbody>
  </table></div>
  <p class="note">Marking a register here is what everywhere else in the app reads from — report cards, the student profile's Attendance tab, and the parent/student portal.</p>`;
}

function wireStudentAttendance(){
  const retry = $('#att-retry'); if(retry) retry.addEventListener('click', e=>{ e.preventDefault(); invalidateAttendanceCache(); render(); });
  const sel = $('#att-class'); if(sel) sel.addEventListener('change', e=>{ state.attClass = e.target.value; invalidateAttendanceCache(); render(); });
  const take = $('#take-register');
  if(take) take.addEventListener('click', ()=> openRealRegisterMark(attendanceCache.classId, attendanceCache.register, attendanceCache.roster));
}

// A teacher is a staff record with a TRCN licence — the same field the
// Staff page already uses to say "this is a teaching post". Filtering the
// one roll by that field gives a teacher-only view without a second
// register that could ever disagree with the staff one.
const isTeachingStaff = m => !!m.trcn;

function attendanceStaffBody(){
  const editable = can('hr.create');
  const scope = state.attStaffScope||'';
  const list = db.staff.filter(m=>m.status==='ACTIVE' &&
    (scope==='teaching' ? isTeachingStaff(m) : scope==='nonteaching' ? !isTeachingStaff(m) : true));
  const key = todayISO();
  const rec = db.staffAttendance[key];

  return `
  <div class="toolbar" style="margin-top:14px">
    <div style="display:flex;gap:5px">
      ${[['','All staff'],['teaching','Teaching staff'],['nonteaching','Non-teaching staff']].map(([v,l])=>
        `<button class="btn btn-s ${scope===v?'btn-p':'btn-q'}" data-satscope="${v}">${l}</button>`).join('')}
    </div>
    <span class="spacer"></span>
    ${rec?`<span class="pill p-ok">SAVED ${esc(rec.markedAt)}</span>`:'<span class="pill p-warn">NOT MARKED</span>'}
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)" id="satally"></span>
    ${editable?`<button class="btn btn-y btn-s" id="smark-all">Mark all present</button>`:''}
  </div>

  <div class="tw"><table>
    <thead><tr><th>Staff</th><th>Position</th><th style="width:230px">Status</th><th class="num">Term rate</th></tr></thead>
    <tbody>${list.map(m=>{
      const cur = rec?.roll[m.id] || '';
      const rate = staffAttendanceRate(m.id);
      return `<tr>
        <td><div class="who-cell">${avatar(m)}
          <div><div class="nm">${esc(m.firstName)} ${esc(m.lastName)}</div><div class="sm">${esc(m.staffNo)}</div></div></div></td>
        <td>${esc(m.position)}</td>
        <td>${editable ? `<div style="display:flex;gap:5px">
            ${['PRESENT','LATE','ABSENT'].map(v=>`<button class="btn btn-s ${cur===v?(v==='ABSENT'?'btn-d':'btn-p'):'btn-q'}" data-smark="${m.id}" data-v="${v}">${v[0]+v.slice(1).toLowerCase()}</button>`).join('')}
          </div>` : cur ? `<span class="pill ${cur==='ABSENT'?'p-bad':cur==='LATE'?'p-warn':'p-ok'}">${cur}</span>` : '<span class="pill p-mute">—</span>'}</td>
        <td class="num">${rate===null?'—':`<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
          <div class="bar"><i class="${rate<75?'low':rate<90?'mid':''}" style="width:${rate}%"></i></div>${rate}%</div>`}</td>
      </tr>`;}).join('')}</tbody>
  </table></div>

  ${editable?`<div class="toolbar" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-p" id="save-satt">Save register</button></div>`:''}
  <p class="note">One roll for the whole staff — teaching and non-teaching alike. Absences notify HR and the Principal once saved.</p>`;
}

function wireStaffAttendance(){
  document.querySelectorAll('[data-satscope]').forEach(b=>b.addEventListener('click',()=>{ state.attStaffScope=b.dataset.satscope; render(); }));

  const scope = state.attStaffScope||'';
  const list = db.staff.filter(m=>m.status==='ACTIVE' &&
    (scope==='teaching' ? isTeachingStaff(m) : scope==='nonteaching' ? !isTeachingStaff(m) : true));
  const key = todayISO();
  if(!db.staffAttendance[key]) db.staffAttendance[key] = {markedBy:ROLES[state.role].name, markedAt:'', roll:{}, draft:true};
  const rec = db.staffAttendance[key];

  const tally = () => {
    const vals = list.map(m=>rec.roll[m.id]).filter(Boolean);
    const p = vals.filter(v=>v==='PRESENT').length, l = vals.filter(v=>v==='LATE').length, a = vals.filter(v=>v==='ABSENT').length;
    const t = $('#satally'); if(t) t.textContent = `${p} present · ${l} late · ${a} absent`;
  };
  tally();

  document.querySelectorAll('[data-smark]').forEach(b=>b.addEventListener('click',()=>{
    rec.roll[b.dataset.smark] = b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach(x=>{
      const on = x.dataset.v === b.dataset.v;
      x.className = 'btn btn-s ' + (on ? (x.dataset.v==='ABSENT'?'btn-d':'btn-p') : 'btn-q');
    });
    tally();
  }));

  const all = $('#smark-all');
  if(all) all.addEventListener('click',()=>{
    list.forEach(m=>rec.roll[m.id]='PRESENT');
    toast('All staff marked present. Change the exceptions, then save.');
    render();
  });

  const save = $('#save-satt');
  if(save) save.addEventListener('click',()=>{
    const missing = list.filter(m=>!rec.roll[m.id]).length;
    if(missing){ toast(`${missing} staff still unmarked. Mark everyone before saving.`, true); return; }
    rec.markedAt = new Date().toTimeString().slice(0,5);
    rec.draft = false;
    const absent = list.filter(m=>rec.roll[m.id]==='ABSENT').length;
    logAudit('attendance.staffRegister', `Staff register saved — ${absent} absence${absent===1?'':'s'} of ${list.length}`);
    if(absent>0){
      const msg = `${absent} of ${list.length} staff marked absent in today's register.`;
      notify('HR_MANAGER', `${absent} staff absence${absent===1?'':'s'} today`, msg);
      notify('PRINCIPAL', `${absent} staff absence${absent===1?'':'s'} today`, msg);
    }
    persist();
    toast(`Staff register saved. ${absent} absence${absent===1?'':'s'} recorded.`);
    render();
  });
}

// Real data via the same /api/reports/attendance-summary the Reports
// module's own dashboard uses — today's per-class marks only (present/
// absent/late), not a term rate. Chronic-absentee tracking and the staff
// breakdown needed a term-long aggregate query this pass didn't build
// (see server/routes/reports.js#computeAttendanceSummary) and staff
// attendance has no backend model at all yet — both dropped rather than
// faked; the note at the bottom says so.
function attendanceReportsBody(){
  if(attendanceReportsCache.error){
    return `<div class="empty"><b>Couldn't load the report</b>${apiErrorMessage(attendanceReportsCache.errorReason)} <a href="#" id="attrep-retry">try again</a>.</div>`;
  }
  if(!attendanceReportsCache.data){
    loadAttendanceReportsData();
    return `<div class="empty"><b>Loading report…</b>Fetching today's attendance from the school's database.</div>`;
  }
  const { rows, date, registersMarked, registersTotal, byMark } = attendanceReportsCache.data;

  return `
  <div class="toolbar" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-q" id="print-att-rep">Print</button></div>

  <div class="grid-stats">
    <div class="stat">${svg('sPending',40)}<div><div class="v">${registersMarked}/${registersTotal}</div><div class="l">Registers marked today</div></div></div>
    <div class="stat">${svg('attendance',40)}<div><div class="v">${byMark.PRESENT||0}</div><div class="l">Present today</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${byMark.ABSENT||0}</div><div class="l">Absent today</div></div></div>
    <div class="stat">${svg('scores',40)}<div><div class="v">${byMark.LATE||0}</div><div class="l">Late today</div></div></div>
  </div>

  <div class="block">
    <h2>Attendance by class <small>${fmtDate(date)}</small></h2>
    ${rows.length?`<div class="tw"><table>
      <thead><tr><th>Class</th><th>Marked</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Late</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td>${esc(r.class)}</td>
        <td>${r.marked==='Yes'?'<span class="pill p-ok">YES</span>':'<span class="pill p-warn">NO</span>'}</td>
        <td class="num">${r.present}</td><td class="num">${r.absent}</td><td class="num">${r.late}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No registers opened yet today.</p>'}
  </div>
  <p class="note">Chronic-absentee tracking and staff attendance summaries will land once those areas move off mock data too.</p>`;
}

function wireAttendanceReports(){
  const retry = $('#attrep-retry'); if(retry) retry.addEventListener('click', e=>{ e.preventDefault(); invalidateAttendanceReportsCache(); render(); });
  const b = $('#print-att-rep'); if(b) b.addEventListener('click',()=>window.print());
}

// ------------------------------------------------------------ examinations --

PAGES.exams = () => {
  const r = ROLES[state.role];
  const classId = r.scope==='CLASS' ? r.classId : state.examClass;
  const c = CLASSES.find(x=>x.id===classId);
  const subs = subjectsFor(c);
  if(!subs.find(s=>s.id===state.examSubject)) state.examSubject = subs[0].id;
  const sub = subs.find(s=>s.id===state.examSubject);
  const list = db.students.filter(s=>s.classId===classId && s.status==='ACTIVE');
  const editable = can('examinations.edit');

  return `
  <div class="phead">
    <div><h1>Examinations</h1><p>Scores are stored per component and never pre-summed. Totals, grades and positions are all derived, so a re-mark or a change of weighting recomputes rather than migrates.</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-q" id="broadsheet">Broadsheet</button>
      ${can('examinations.approve')?'<button class="btn btn-y" id="approve">Approve results</button>':''}
    </div>
  </div>

  <div class="toolbar">
    ${r.scope==='CLASS'?`<span class="pill p-info">${className(c)} — your class</span>`:
      `<select class="pick" id="ex-class">${CLASSES.map(x=>`<option value="${x.id}" ${x.id===classId?'selected':''}>${className(x)}</option>`).join('')}</select>`}
    <select class="pick" id="ex-subject">${subs.map(s=>`<option value="${s.id}" ${s.id===state.examSubject?'selected':''}>${s.name}</option>`).join('')}</select>
    <span class="spacer"></span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${COMPONENTS.map(c=>`${c.label} ${c.max}`).join(' · ')} = 100</span>
  </div>

  <div class="block" style="padding:16px 18px">
    <div class="mark-row head">
      <span>Student</span>${COMPONENTS.map(c=>`<span style="text-align:center">${c.label}<br>/${c.max}</span>`).join('')}
      <span style="text-align:center">Total</span><span style="text-align:center">Grade</span>
    </div>
    ${list.map(s=>{
      const rec = db.scores[`${s.id}:${sub.id}`] || {ca1:0,ca2:0,asg:0,exam:0};
      const total = rec.ca1+rec.ca2+rec.asg+rec.exam;
      const g = gradeOf(total);
      return `<div class="mark-row" data-row="${s.id}">
        <div style="min-width:0"><div style="font-weight:500;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.firstName)} ${esc(s.lastName)}</div>
          <div style="font-family:var(--mono);font-size:9.5px;color:var(--muted)">${esc(s.admissionNo.split('/').pop())}</div></div>
        ${COMPONENTS.map(comp=>`<input type="number" min="0" max="${comp.max}" value="${rec[comp.key]}"
           data-score="${s.id}" data-k="${comp.key}" data-max="${comp.max}" ${editable?'':'disabled'}>`).join('')}
        <div class="tot" data-total="${s.id}">${total}</div>
        <div class="tot" data-grade="${s.id}" style="color:${total<40?'var(--clay)':'var(--navy)'}">${g.g}</div>
      </div>`;
    }).join('')}
  </div>

  ${editable?`<div class="toolbar" style="justify-content:flex-end"><button class="btn btn-p" id="save-scores">Save scores</button></div>`:
    '<p class="note">You can view scores but not change them. <code>examinations.score.edit</code> is held by subject teachers and the class teacher for their own arm.</p>'}`;
};

PAGES.exams_wire = () => {
  const cs = $('#ex-class'); if(cs) cs.addEventListener('change',e=>{state.examClass=e.target.value;render();});
  const ss = $('#ex-subject'); if(ss) ss.addEventListener('change',e=>{state.examSubject=e.target.value;render();});

  const recalc = id => {
    let t = 0, bad = false;
    document.querySelectorAll(`[data-score="${id}"]`).forEach(inp=>{
      const max = +inp.dataset.max;
      let v = inp.value === '' ? 0 : Number(inp.value);
      if(Number.isNaN(v) || v < 0 || v > max){ inp.classList.add('bad'); bad = true; }
      else inp.classList.remove('bad');
      t += Math.max(0, Math.min(max, Number.isNaN(v)?0:v));
    });
    const g = gradeOf(t);
    const tn = document.querySelector(`[data-total="${id}"]`);
    const gn = document.querySelector(`[data-grade="${id}"]`);
    if(tn) tn.textContent = t;
    if(gn){ gn.textContent = g.g; gn.style.color = t<40?'var(--clay)':'var(--navy)'; }
    return bad;
  };

  document.querySelectorAll('[data-score]').forEach(inp=>
    inp.addEventListener('input',()=>recalc(inp.dataset.score)));

  const save = $('#save-scores');
  if(save) save.addEventListener('click',()=>{
    let bad = 0;
    const touched = new Set([...document.querySelectorAll('[data-score]')].map(i=>i.dataset.score));
    touched.forEach(id=>{ if(recalc(id)) bad++; });
    if(bad){ toast(`${bad} row${bad===1?'':'s'} out of range. A component cannot exceed its maximum.`, true); return; }

    document.querySelectorAll('[data-score]').forEach(inp=>{
      const id = inp.dataset.score, k = inp.dataset.k, max = +inp.dataset.max;
      const key = `${id}:${state.examSubject}`;
      if(!db.scores[key]) db.scores[key] = {ca1:0,ca2:0,asg:0,exam:0};
      db.scores[key][k] = Math.max(0, Math.min(max, Number(inp.value)||0));
    });
    const subj = SUBJECTS.find(s=>s.id===state.examSubject);
    logAudit('examinations.score', `${subj.name} scores saved for ${touched.size} student${touched.size===1?'':'s'}`);
    persist();
    toast(`Scores saved for ${subj.name}. Positions recomputed.`);
  });

  const bs = $('#broadsheet'); if(bs) bs.addEventListener('click',openBroadsheet);
  const ap = $('#approve'); if(ap) ap.addEventListener('click',()=>{
    const classId = ROLES[state.role].scope==='CLASS'?ROLES[state.role].classId:state.examClass;
    toast(`Results for ${className(CLASSES.find(c=>c.id===classId))} approved and released to parents.`);
  });
};

function openBroadsheet(){
  const classId = ROLES[state.role].scope==='CLASS'?ROLES[state.role].classId:state.examClass;
  const c = CLASSES.find(x=>x.id===classId);
  const subs = subjectsFor(c);
  const ranked = classPositions(classId);

  modal({
    title:`Broadsheet — ${className(c)}`, sub:`${TERM}, ${SESSION} · ${ranked.length} students · ${subs.length} subjects`, wide:true,
    body:`<div class="tw"><table>
      <thead><tr><th>Pos</th><th>Student</th>${subs.map(s=>`<th class="num" title="${esc(s.name)}">${s.code}</th>`).join('')}<th class="num">Avg</th><th>Grd</th></tr></thead>
      <tbody>${ranked.map(r=>{
        const res = studentResult(r.student);
        return `<tr><td class="num" style="font-weight:600">${r.position}</td>
          <td style="white-space:nowrap">${esc(r.student.firstName)} ${esc(r.student.lastName)}</td>
          ${res.rows.map(row=>`<td class="num" style="color:${row.total<40?'var(--clay)':'inherit'}">${row.total}</td>`).join('')}
          <td class="num" style="font-weight:600">${res.avg.toFixed(1)}</td>
          <td><span class="pill ${res.avg>=50?'p-ok':res.avg>=40?'p-warn':'p-bad'}">${gradeOf(res.avg).g}</span></td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="note">Positions use competition ranking: two students on the same average share a position and the next one skips. Dense ranking would quietly tell the following student they came one place higher than they did.</p>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="print-bs">Print</button>`,
    wire(){ $('#print-bs').addEventListener('click',()=>window.print()); },
  });
}

function openReportCard(id){
  const s = db.students.find(x=>x.id===id);
  const c = CLASSES.find(x=>x.id===s.classId);
  const res = studentResult(s);
  const ranked = classPositions(s.classId);
  const pos = ranked.find(p=>p.student.id===s.id);
  const att = attendanceRate(s.id);
  const fee = feeSummary(s);
  const traits = ['Punctuality','Neatness','Politeness','Attentiveness','Co-operation','Handwriting'];

  modal({
    title:'Report card', sub:`${s.firstName} ${s.lastName} · ${className(c)} · ${TERM}, ${SESSION}`, wide:true,
    body:`
    ${fee.balance>0?`<div style="background:var(--amber-soft);border:1px solid #EBDCBB;border-radius:9px;padding:11px 14px;margin-bottom:16px;font-size:12.5px;color:#6F4E11">
      <b>Outstanding balance of ${nairaFull(fee.balance)}.</b> Result withholding is switched off, so this card is still released — the school can turn it on in Settings if it chooses.</div>`:''}
    <div class="rc">
      <div class="rc-head">
        <div style="display:flex;gap:12px;align-items:center">
          <span data-crest="54" style="flex:none"></span>
          <div><div class="n">Fadesrek Academy</div>
            <div style="font-family:var(--word);font-style:italic;font-size:13px;color:var(--blue)">Soaring to Excellence</div>
            <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;margin-top:2px">Kubwa · Abuja FCT</div></div></div>
        <div style="display:flex;gap:12px;align-items:center">
          <div style="text-align:right;font-size:12px">
            <div><b>${esc(s.firstName)} ${esc(s.lastName)}</b></div>
            <div style="font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(s.admissionNo)}</div>
            <div style="margin-top:3px">${className(c)} · ${TERM}</div></div>
          ${avatar(s, 52)}
        </div>
      </div>

      <div class="tw" style="border:0"><table>
        <thead><tr><th>Subject</th>${COMPONENTS.map(c=>`<th class="num">${c.label}</th>`).join('')}<th class="num">Total</th><th>Grade</th><th>Remark</th></tr></thead>
        <tbody>${res.rows.map(r=>`<tr>
          <td>${esc(r.subject.name)}</td>
          ${COMPONENTS.map(c=>`<td class="num">${r[c.key]}</td>`).join('')}
          <td class="num" style="font-weight:600">${r.total}</td>
          <td><span class="pill ${r.total>=50?'p-ok':r.total>=40?'p-warn':'p-bad'}">${r.g}</span></td>
          <td style="font-size:12px;color:var(--muted)">${r.r}</td></tr>`).join('')}</tbody>
      </table></div>

      <div class="fgrid" style="margin-top:16px">
        <dl class="kv">
          <dt>Subjects offered</dt><dd>${res.count}</dd>
          <dt>Subjects passed</dt><dd>${res.passed}</dd>
          <dt>Total score</dt><dd>${res.sum} / ${res.count*100}</dd>
          <dt>Average</dt><dd>${res.avg.toFixed(1)}% · ${gradeOf(res.avg).g}</dd>
        </dl>
        <dl class="kv">
          <dt>Position in class</dt><dd>${pos?ordinal(pos.position)+' of '+ranked.length:'—'}</dd>
          <dt>Class average</dt><dd>${(ranked.reduce((t,r)=>t+r.avg,0)/ranked.length).toFixed(1)}%</dd>
          <dt>Attendance</dt><dd>${att===null?'Not yet marked':att+'%'}</dd>
          <dt>Times school opened</dt><dd>${Object.keys(db.attendance).length}</dd>
        </dl>
      </div>

      <h3 style="font-size:12.5px;margin-top:18px">Affective and psychomotor</h3>
      <div class="traits">${traits.map((t,i)=>`<div class="trait"><span>${t}</span><b>${['A','B','A','B','A','C'][i]}</b></div>`).join('')}</div>

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--rule);font-size:12px">
        <b>Class teacher's remark:</b> ${res.avg>=70?'An excellent term. Keep it up.':res.avg>=55?'A good result. More effort in the weaker subjects will lift the average.':res.avg>=40?'A fair term. Consistent revision is needed next term.':'This result needs attention. Please arrange to meet the class teacher.'}
      </div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="print-rc">Print</button>`,
    wire(){ $('#print-rc').addEventListener('click',()=>window.print()); },
  });
}

// ----------------------------------------------------------------- finance --

/** Seven tabs on one module. "Fees & Invoices" is open to anyone with
    finance.view (including a parent, scoped to their own children by
    visibleStudents()). The other six touch whole-school money — cashbook,
    income/expenses, reconciliation — so they're gated on finance.approve,
    which in practice is exactly the back-office roles (Super Admin,
    Proprietor, Principal, Bursar) and never a parent or student. */
PAGES.finance = () => {
  const backOffice = can('finance.approve');
  const tabs = [
    ['fees','Fees & Invoices'],
    ...(backOffice ? [
      ['plans','Installments'],
      ['scholarships','Scholarships & Discounts'],
      ['incexp','Income & Expenses'],
      ['cashbook','Cashbook'],
      ['recon','Reconciliation'],
      ['reports','Reports'],
    ] : []),
  ];
  if(!tabs.some(t=>t[0]===state.tab)) state.tab = 'fees';

  const bodies = {fees:financeFeesBody, plans:financePlansBody, scholarships:financeScholarshipsBody,
    incexp:financeIncomeExpenseBody, cashbook:financeCashbookBody, recon:financeReconBody, reports:financeReportsBody};

  return `
  <div class="phead">
    <div><h1>Finance</h1><p>Money is held in kobo as integers. Payments are never edited or deleted — a mistake is corrected with a reversal that points back at the original, so every book below still reconciles months later.</p></div>
  </div>

  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-fintab="${id}" aria-selected="${state.tab===id}">${l}</button>`).join('')}</div>

  ${(bodies[state.tab]||financeFeesBody)()}`;
};

PAGES.finance_wire = () => {
  document.querySelectorAll('[data-fintab]').forEach(b=>b.addEventListener('click',()=>{ state.tab=b.dataset.fintab; render(); }));
  const wireFns = {fees:wireFinanceFees, plans:wireFinancePlans, scholarships:wireFinanceScholarships,
    incexp:wireFinanceIncomeExpense, cashbook:wireFinanceCashbook, recon:wireFinanceRecon, reports:wireFinanceReports};
  (wireFns[state.tab]||wireFinanceFees)();
};

// ---- Fees & Invoices --------------------------------------------------

function financeFeesBody(){
  let list = visibleStudents();
  if(state.financeQuery){
    const q = state.financeQuery.toLowerCase();
    list = list.filter(s=>`${s.firstName} ${s.lastName} ${s.admissionNo}`.toLowerCase().includes(q));
  }
  const rows = list.map(s=>({s, fee:feeSummary(s)}));
  const owing = rows.filter(r=>r.fee.balance>0);
  const totals = rows.reduce((a,r)=>{a.b+=r.fee.billed;a.p+=r.fee.paid;return a;},{b:0,p:0});
  const shown = rows.slice(0,50);

  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('income',40)}<div><div class="v">${naira(totals.p)}</div><div class="l">Collected</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(totals.b-totals.p)}</div><div class="l">Outstanding</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${owing.length}</div><div class="l">Students owing</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${totals.b?Math.round(totals.p/totals.b*100):0}%</div><div class="l">Collection rate</div></div></div>
  </div>

  <div class="toolbar">
    <input type="text" class="search" id="fq" placeholder="Search student or admission no." value="${esc(state.financeQuery)}">
    <span class="spacer"></span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${rows.length} invoice${rows.length===1?'':'s'}</span>
  </div>

  <div class="tw"><table>
    <thead><tr><th>Student</th><th>Class</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
    <tbody>${shown.map(({s,fee})=>`<tr>
      <td><div class="who-cell">${avatar(s)}
        <div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
      <td>${className(CLASSES.find(c=>c.id===s.classId))}</td>
      <td class="num">${naira(fee.billed)}</td>
      <td class="num">${naira(fee.paid)}</td>
      <td class="num" style="color:${fee.balance>0?'var(--clay)':'var(--moss)'};font-weight:600">${naira(Math.max(fee.balance,0))}</td>
      <td>${fee.settled?'<span class="pill p-ok">SETTLED</span>':fee.paid>0?'<span class="pill p-warn">PART PAID</span>':'<span class="pill p-bad">UNPAID</span>'}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-q btn-s" data-inv="${s.id}">Invoice</button>
        ${can('finance.create')&&!fee.settled?`<button class="btn btn-p btn-s" data-pay="${s.id}">Record payment</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${rows.length>50?`<p class="note">Showing the first 50 of ${rows.length}.</p>`:''}`;
}

function wireFinanceFees(){
  const q = $('#fq');
  if(q) q.addEventListener('input',e=>{state.financeQuery=e.target.value;const p=e.target.selectionStart;render();const n=$('#fq');if(n){n.focus();n.setSelectionRange(p,p);}});
  document.querySelectorAll('[data-pay]').forEach(b=>b.addEventListener('click',()=>openPayment(b.dataset.pay)));
  document.querySelectorAll('[data-inv]').forEach(b=>b.addEventListener('click',()=>openInvoice(b.dataset.inv)));
}

function openInvoice(id){
  const s = db.students.find(x=>x.id===id);
  const c = CLASSES.find(x=>x.id===s.classId);
  const fee = feeSummary(s);
  const pays = db.payments.filter(p=>p.studentId===id);
  const invNo = `INV/${SESSION.slice(0,4)}/${s.admissionNo.split('/').pop()}`;
  modal({
    title:'Invoice', sub:`${s.firstName} ${s.lastName} · ${TERM}, ${SESSION}`, wide:true,
    body:`
    <div class="rc">
      <div class="rc-head">
        <div style="display:flex;gap:12px;align-items:center">
          <span data-crest="48" style="flex:none"></span>
          <div><div class="n">Fadesrek Academy</div>
            <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;margin-top:2px">Invoice ${invNo}</div></div></div>
        <div style="text-align:right;font-size:12px">
          <div><b>${esc(s.firstName)} ${esc(s.lastName)}</b></div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(s.admissionNo)}</div>
          <div style="margin-top:3px">${className(c)} · ${TERM}</div></div>
      </div>

      <div class="tw" style="border:0"><table>
        <thead><tr><th>Item</th><th class="num">Amount</th></tr></thead>
        <tbody>${fee.items.map(f=>`<tr><td>${esc(f.name)}</td><td class="num">${nairaFull(f.amount)}</td></tr>`).join('')}
          <tr><td>Gross</td><td class="num">${nairaFull(fee.gross)}</td></tr>
          ${fee.scholAmt>0?`<tr><td style="color:var(--moss)">Scholarship (${fee.scholPct}%)</td><td class="num" style="color:var(--moss)">−${nairaFull(fee.scholAmt)}</td></tr>`:''}
          ${fee.discAmt>0?`<tr><td style="color:var(--moss)">Discounts</td><td class="num" style="color:var(--moss)">−${nairaFull(fee.discAmt)}</td></tr>`:''}
          <tr><td style="font-weight:600">Total billed</td><td class="num" style="font-weight:600">${nairaFull(fee.billed)}</td></tr>
          <tr><td style="color:var(--moss)">Paid to date</td><td class="num" style="color:var(--moss)">${nairaFull(fee.paid)}</td></tr>
          <tr><td style="font-weight:600">Balance</td><td class="num" style="font-weight:600;color:${fee.balance>0?'var(--clay)':'var(--moss)'}">${nairaFull(Math.max(fee.balance,0))}</td></tr>
        </tbody></table></div>

      ${pays.length?`<h3 style="font-size:12.5px;margin:18px 0 8px">Payments received</h3>
      <div class="tw" style="border:0"><table><thead><tr><th>Receipt</th><th>Method</th><th>Date</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${pays.map(p=>`<tr><td style="font-family:var(--mono);font-size:11.5px">${esc(p.ref)}</td>
        <td><span class="pill p-info">${p.method}</span></td><td>${fmtDate(p.at)}</td>
        <td class="num" ${p.reversed?'style="text-decoration:line-through;color:var(--muted)"':''}>${nairaFull(p.amount)}</td>
        <td>${!p.reversed?`<button class="btn btn-q btn-s" data-receipt="${p.id}">Receipt</button>`:''}</td></tr>`).join('')}
      </tbody></table></div>`:''}
    </div>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="print-inv">Print</button>`,
    wire(){
      $('#print-inv').addEventListener('click',()=>window.print());
      document.querySelectorAll('[data-receipt]').forEach(b=>b.addEventListener('click',()=>openReceipt(b.dataset.receipt)));
    },
  });
}

function openReceipt(paymentId){
  const p = db.payments.find(x=>x.id===paymentId);
  const s = db.students.find(x=>x.id===p.studentId);
  modal({
    title:'Receipt', sub:esc(p.ref),
    body:`
    <div class="rc">
      <div class="rc-head">
        <div style="display:flex;gap:12px;align-items:center">
          <span data-crest="48" style="flex:none"></span>
          <div><div class="n">Fadesrek Academy</div>
            <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;margin-top:2px">Official receipt</div></div></div>
        <div style="text-align:right;font-size:12px">
          <div style="font-family:var(--mono)">${esc(p.ref)}</div>
          <div style="margin-top:3px">${fmtDate(p.at)}</div></div>
      </div>
      <dl class="kv">
        <dt>Received from</dt><dd>${esc(s.firstName)} ${esc(s.lastName)} · ${esc(s.admissionNo)}</dd>
        <dt>Amount</dt><dd style="font-weight:600;font-size:15px">${nairaFull(p.amount)}</dd>
        <dt>Method</dt><dd><span class="pill p-info">${p.method}</span></dd>
        <dt>Gateway reference</dt><dd style="font-family:var(--mono);font-size:12px">${p.gatewayRef?esc(p.gatewayRef):'—'}</dd>
        <dt>Term</dt><dd>${TERM}, ${SESSION}</dd>
      </dl>
      <p style="margin-top:16px;font-size:11.5px;color:var(--muted)">Generated from the payment record — it can never be issued for an amount that was not actually written to the ledger.</p>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="print-rcpt">Print</button>`,
    wire(){ $('#print-rcpt').addEventListener('click',()=>window.print()); },
  });
}

function openPayment(id){
  const s = db.students.find(x=>x.id===id);
  const fee = feeSummary(s);
  modal({
    title:'Record payment', sub:`${s.firstName} ${s.lastName} · balance ${nairaFull(fee.balance)}`,
    body:`<div class="fgrid">
      <div class="f"><label class="req">Amount (₦)</label><input type="number" id="pay-amt" min="1" max="${fee.balance/100}" value="${fee.balance/100}"><div class="err" id="e-amt"></div></div>
      <div class="f"><label>Method</label><select id="pay-method">
        <option value="BANK_TRANSFER">Bank transfer</option><option value="PAYSTACK">Paystack</option>
        <option value="FLUTTERWAVE">Flutterwave</option><option value="CASH">Cash</option></select></div>
      <div class="f wide"><label>Reference from the bank or gateway</label><input type="text" id="pay-ref" placeholder="Optional — used for reconciliation"></div>
    </div>
    <p class="note">Recording a payment writes a balanced pair of ledger entries in the same transaction. If either fails, neither is written. If the student is on a payment plan, it settles the earliest unpaid installment first.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="pay-save">Record payment</button>`,
    wire(){
      $('#pay-save').addEventListener('click',()=>{
        const amt = Math.round(Number($('#pay-amt').value)*100);
        const err = $('#e-amt'); err.textContent='';
        if(!amt || amt<=0){ err.textContent='Enter an amount greater than zero.'; return; }
        if(amt > fee.balance){ err.textContent=`That is more than the balance of ${nairaFull(fee.balance)}.`; return; }

        const ref = `RCP/2026/${String(db.payments.length+1).padStart(5,'0')}`;
        db.payments.push({id:uid('pay'), studentId:id, amount:amt, method:$('#pay-method').value,
          ref, at:todayISO(), reversed:false, gatewayRef:$('#pay-ref').value.trim()||null});
        db.ledger.push({journalRef:ref, debit:'CASH_AT_BANK', credit:'FEE_RECEIVABLE', amount:amt, at:todayISO()});

        logAudit('finance.payment', `${nairaFull(amt)} received from ${s.firstName} ${s.lastName} — receipt ${ref}`);
        if((ROLES.PARENT.childIds||[]).includes(s.id))
          notify('PARENT', 'Payment received', `${nairaFull(amt)} received for ${s.firstName} ${s.lastName}. Receipt ${ref}.`);
        persist(); closeModal();
        toast(`<b>${nairaFull(amt)}</b> received from ${esc(s.firstName)} ${esc(s.lastName)}. Receipt ${ref}.`);
        render();
      });
    },
  });
}

// ---- Installments -------------------------------------------------------

function financePlansBody(){
  const withPlan = db.installmentPlans.map(p=>{
    const s = db.students.find(x=>x.id===p.studentId);
    const info = studentInstallments(p.studentId);
    const next = info.rows.find(r=>r.status!=='PAID');
    return {p, s, next};
  }).filter(x=>x.s);
  const eligible = db.students.filter(s=>s.status==='ACTIVE' && feeSummary(s).balance>0 && !db.installmentPlans.some(p=>p.studentId===s.id));

  return `
  <div class="toolbar" style="margin-top:14px">
    <span style="font-size:12.5px;color:var(--muted)">${withPlan.length} active plan${withPlan.length===1?'':'s'} · ${eligible.length} owing without one</span>
    <span class="spacer"></span>
    ${can('finance.create')?`<select class="pick" id="plan-student"><option value="">Choose a student…</option>${eligible.map(s=>`<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} — ${esc(s.admissionNo)}</option>`).join('')}</select>
    <button class="btn btn-p btn-s" id="plan-new">Create plan</button>`:''}
  </div>

  <div class="tw"><table>
    <thead><tr><th>Student</th><th>Class</th><th class="num">Installments</th><th>Next due</th><th>Status</th><th></th></tr></thead>
    <tbody>${withPlan.map(({p,s,next})=>`<tr>
      <td><div class="who-cell">${avatar(s)}<div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
      <td>${className(CLASSES.find(c=>c.id===s.classId))}</td>
      <td class="num">${p.items.length}</td>
      <td>${next?fmtDate(next.dueDate):'—'}</td>
      <td>${next?`<span class="pill ${next.status==='OVERDUE'?'p-bad':next.status==='PARTIAL'?'p-warn':'p-info'}">${next.status}</span>`:'<span class="pill p-ok">COMPLETE</span>'}</td>
      <td><button class="btn btn-q btn-s" data-plan="${s.id}">View</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${withPlan.length===0?'<p class="sub" style="margin-top:12px">No payment plans yet.</p>':''}
  <p class="note">An installment is marked paid the moment cumulative payments reach it — recording a payment through the ordinary flow settles the plan on its own, nothing here is kept in sync by hand.</p>`;
}

function wireFinancePlans(){
  const btn = $('#plan-new');
  if(btn) btn.addEventListener('click',()=>{
    const sel = $('#plan-student');
    if(!sel || !sel.value){ toast('Choose a student first.', true); return; }
    openInstallmentForm(sel.value);
  });
  document.querySelectorAll('[data-plan]').forEach(b=>b.addEventListener('click',()=>openInstallmentDetail(b.dataset.plan)));
}

function openInstallmentForm(studentId){
  const s = db.students.find(x=>x.id===studentId);
  const fee = feeSummary(s);
  modal({
    title:'Create payment plan', sub:`${s.firstName} ${s.lastName} · balance ${nairaFull(fee.balance)}`,
    body:`<div class="fgrid">
      <div class="f"><label class="req">Number of installments</label><select id="pl-count">
        <option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select></div>
      <div class="f"><label class="req">First due date</label><input type="date" id="pl-start" value="${todayISO()}"></div>
      <div class="f"><label>Spacing</label><select id="pl-gap">
        <option value="30">Monthly</option><option value="14">Fortnightly</option><option value="7">Weekly</option></select></div>
    </div>
    <p class="note">The balance splits evenly across the installments, with any rounding remainder on the last one.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="pl-save">Create plan</button>`,
    wire(){
      $('#pl-save').addEventListener('click',()=>{
        const count = Number($('#pl-count').value);
        const start = $('#pl-start').value || todayISO();
        const gap = Number($('#pl-gap').value);
        const per = Math.floor(fee.balance/count);
        const items = [];
        let d = new Date(start+'T00:00:00');
        for(let i=0;i<count;i++){
          const amount = i===count-1 ? fee.balance-per*(count-1) : per;
          items.push({seq:i+1, label:`Installment ${i+1} of ${count}`, amount, dueDate:d.toISOString().slice(0,10)});
          d.setDate(d.getDate()+gap);
        }
        db.installmentPlans = db.installmentPlans.filter(p=>p.studentId!==studentId);
        db.installmentPlans.push({id:uid('plan'), studentId, term:TERM, session:SESSION, items, createdOn:todayISO(), createdBy:ROLES[state.role].name});
        logAudit('finance.installmentPlan', `${count}-installment plan created for ${s.firstName} ${s.lastName}`);
        persist(); closeModal();
        toast('Payment plan created.');
        render();
      });
    },
  });
}

function openInstallmentDetail(studentId){
  const s = db.students.find(x=>x.id===studentId);
  const info = studentInstallments(studentId);
  if(!info) return;
  modal({
    title:'Payment plan', sub:`${s.firstName} ${s.lastName} · ${esc(s.admissionNo)}`,
    body:`<div class="tw"><table>
      <thead><tr><th>Installment</th><th>Due</th><th class="num">Amount</th><th class="num">Paid</th><th>Status</th></tr></thead>
      <tbody>${info.rows.map(r=>`<tr>
        <td>${esc(r.label)}</td><td>${fmtDate(r.dueDate)}</td>
        <td class="num">${nairaFull(r.amount)}</td><td class="num">${nairaFull(r.paidForThis)}</td>
        <td><span class="pill ${r.status==='PAID'?'p-ok':r.status==='OVERDUE'?'p-bad':r.status==='PARTIAL'?'p-warn':'p-mute'}">${r.status}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>`,
    foot:`<button class="btn btn-q" data-close>Close</button>
      ${can('finance.create')?`<button class="btn btn-d" id="pl-cancel">Cancel plan</button>`:''}`,
    wire(){
      const c = $('#pl-cancel');
      if(c) c.addEventListener('click',()=>{
        db.installmentPlans = db.installmentPlans.filter(p=>p.studentId!==studentId);
        logAudit('finance.installmentPlan', `Payment plan cancelled for ${s.firstName} ${s.lastName}`);
        persist(); closeModal();
        toast('Plan cancelled.');
        render();
      });
    },
  });
}

// ---- Scholarships & Discounts -------------------------------------------

function financeScholarshipsBody(){
  const schol = db.scholarships.map(x=>({x, s:db.students.find(s=>s.id===x.studentId)})).filter(r=>r.s);
  const disc = db.discounts.map(x=>({x, s:db.students.find(s=>s.id===x.studentId)})).filter(r=>r.s);
  const canAward = can('finance.approve'), canDiscount = can('finance.create');

  return `
  <div class="toolbar" style="margin-top:14px">
    ${canAward?`<button class="btn btn-y btn-s" id="add-schol">Award scholarship</button>`:''}
    ${canDiscount?`<button class="btn btn-q btn-s" id="add-disc">Apply discount</button>`:''}
  </div>

  <div class="block">
    <h2>Scholarships <small>${schol.length}</small></h2>
    ${schol.length?`<div class="tw"><table>
      <thead><tr><th>Student</th><th class="num">Percent</th><th>Reason</th><th>Awarded</th><th></th></tr></thead>
      <tbody>${schol.map(({x,s})=>`<tr>
        <td><div class="who-cell">${avatar(s)}<div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
        <td class="num" style="font-weight:600">${x.percent}%</td>
        <td style="font-size:12px;color:var(--muted)">${esc(x.reason)}</td>
        <td>${fmtDate(x.awardedOn)}</td>
        <td>${canAward?`<button class="btn btn-d btn-s" data-schol-revoke="${x.id}">Revoke</button>`:''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No scholarships awarded.</p>'}
  </div>

  <div class="block">
    <h2>Discounts <small>${disc.length}</small></h2>
    ${disc.length?`<div class="tw"><table>
      <thead><tr><th>Student</th><th class="num">Amount</th><th>Reason</th><th>Applied</th><th></th></tr></thead>
      <tbody>${disc.map(({x,s})=>`<tr>
        <td><div class="who-cell">${avatar(s)}<div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
        <td class="num" style="font-weight:600">${nairaFull(x.amount)}</td>
        <td style="font-size:12px;color:var(--muted)">${esc(x.reason)}</td>
        <td>${fmtDate(x.appliedOn)}</td>
        <td>${canDiscount?`<button class="btn btn-d btn-s" data-disc-revoke="${x.id}">Revoke</button>`:''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No discounts applied.</p>'}
  </div>`;
}

function openScholarshipForm(){
  const list = db.students.filter(s=>s.status==='ACTIVE');
  modal({
    title:'Award scholarship',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Student</label><select id="sc-student">${list.map(s=>`<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} — ${esc(s.admissionNo)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Percent off fees</label><input type="number" id="sc-pct" min="1" max="100" value="25"></div>
      <div class="f wide"><label class="req">Reason</label><input type="text" id="sc-reason" placeholder="Merit — top of JSS 2, First Term"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="sc-save">Award</button>`,
    wire(){
      $('#sc-save').addEventListener('click',()=>{
        const studentId = $('#sc-student').value, pct = Number($('#sc-pct').value), reason = $('#sc-reason').value.trim();
        if(!pct || pct<=0){ toast('Enter a percentage greater than zero.', true); return; }
        if(!reason){ toast('Enter a reason for the award.', true); return; }
        const s = db.students.find(x=>x.id===studentId);
        db.scholarships.push({id:uid('sch'), studentId, percent:pct, reason, awardedOn:todayISO(), awardedBy:ROLES[state.role].name});
        logAudit('finance.scholarship', `${pct}% scholarship awarded to ${s.firstName} ${s.lastName} — ${reason}`);
        persist(); closeModal();
        toast('Scholarship awarded.');
        render();
      });
    },
  });
}

function openDiscountForm(){
  const list = db.students.filter(s=>s.status==='ACTIVE');
  modal({
    title:'Apply discount',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Student</label><select id="dc-student">${list.map(s=>`<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} — ${esc(s.admissionNo)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Amount (₦)</label><input type="number" id="dc-amt" min="1" value="5000"></div>
      <div class="f wide"><label class="req">Reason</label><input type="text" id="dc-reason" placeholder="Sibling discount, early payment, ..."></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="dc-save">Apply</button>`,
    wire(){
      $('#dc-save').addEventListener('click',()=>{
        const studentId = $('#dc-student').value, amt = Math.round(Number($('#dc-amt').value)*100), reason = $('#dc-reason').value.trim();
        if(!amt || amt<=0){ toast('Enter an amount greater than zero.', true); return; }
        if(!reason){ toast('Enter a reason for the discount.', true); return; }
        const s = db.students.find(x=>x.id===studentId);
        db.discounts.push({id:uid('disc'), studentId, amount:amt, reason, appliedOn:todayISO(), appliedBy:ROLES[state.role].name});
        logAudit('finance.discount', `${nairaFull(amt)} discount applied to ${s.firstName} ${s.lastName} — ${reason}`);
        persist(); closeModal();
        toast('Discount applied.');
        render();
      });
    },
  });
}

function wireFinanceScholarships(){
  const a = $('#add-schol'); if(a) a.addEventListener('click',openScholarshipForm);
  const d = $('#add-disc'); if(d) d.addEventListener('click',openDiscountForm);
  document.querySelectorAll('[data-schol-revoke]').forEach(b=>b.addEventListener('click',()=>{
    const x = db.scholarships.find(y=>y.id===b.dataset.scholRevoke);
    db.scholarships = db.scholarships.filter(y=>y.id!==b.dataset.scholRevoke);
    if(x) logAudit('finance.scholarship', `Scholarship revoked (was ${x.percent}%).`);
    persist(); toast('Scholarship revoked.'); render();
  }));
  document.querySelectorAll('[data-disc-revoke]').forEach(b=>b.addEventListener('click',()=>{
    const x = db.discounts.find(y=>y.id===b.dataset.discRevoke);
    db.discounts = db.discounts.filter(y=>y.id!==b.dataset.discRevoke);
    if(x) logAudit('finance.discount', `Discount revoked (was ${nairaFull(x.amount)}).`);
    persist(); toast('Discount revoked.'); render();
  }));
}

// ---- Income & Expenses ---------------------------------------------------

function financeIncomeExpenseBody(){
  const income = [...db.income].sort((a,b)=>b.at.localeCompare(a.at));
  const expenses = [...db.expenses].sort((a,b)=>b.at.localeCompare(a.at));
  const totalIncome = db.income.reduce((t,x)=>t+x.amount,0);
  const totalExpense = db.expenses.filter(x=>x.status==='APPROVED').reduce((t,x)=>t+x.amount,0);
  const pendingExpenses = db.expenses.filter(x=>x.status==='PENDING');

  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('income',40)}<div><div class="v">${naira(totalIncome)}</div><div class="l">Non-fee income</div></div></div>
    <div class="stat">${svg('expense',40)}<div><div class="v">${naira(totalExpense)}</div><div class="l">Expenses</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${pendingExpenses.length}</div><div class="l">Awaiting approval</div></div></div>
  </div>

  <div class="block">
    <div class="toolbar" style="margin-bottom:10px"><h2 style="margin:0">Income</h2><span class="spacer"></span>
      ${can('finance.create')?`<button class="btn btn-y btn-s" id="add-income">Record income</button>`:''}</div>
    ${income.length?`<div class="tw"><table>
      <thead><tr><th>Ref</th><th>Category</th><th>Description</th><th>Date</th><th class="num">Amount</th></tr></thead>
      <tbody>${income.map(x=>`<tr><td style="font-family:var(--mono);font-size:11.5px">${esc(x.ref)}</td>
        <td><span class="pill p-info">${esc(x.category)}</span></td>
        <td style="font-size:12px;color:var(--muted)">${esc(x.description)}</td>
        <td>${fmtDate(x.at)}</td><td class="num">${nairaFull(x.amount)}</td></tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No non-fee income recorded.</p>'}
  </div>

  <div class="block">
    <div class="toolbar" style="margin-bottom:10px"><h2 style="margin:0">Expenses</h2><span class="spacer"></span>
      ${can('finance.create')?`<button class="btn btn-q btn-s" id="add-expense">Record expense</button>`:''}</div>
    ${expenses.length?`<div class="tw"><table>
      <thead><tr><th>Ref</th><th>Category</th><th>Description</th><th>Date</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${expenses.map(x=>`<tr><td style="font-family:var(--mono);font-size:11.5px">${esc(x.ref)}</td>
        <td><span class="pill p-info">${esc(x.category)}</span></td>
        <td style="font-size:12px;color:var(--muted)">${esc(x.description)}</td>
        <td>${fmtDate(x.at)}</td><td class="num">${nairaFull(x.amount)}</td>
        <td><span class="pill ${x.status==='APPROVED'?'p-ok':x.status==='REJECTED'?'p-bad':'p-warn'}">${x.status}</span></td>
        <td>${x.status==='PENDING'&&can('finance.approve')?`
          <button class="btn btn-p btn-s" data-exp-decide="${x.id}" data-d="APPROVED">Approve</button>
          <button class="btn btn-d btn-s" data-exp-decide="${x.id}" data-d="REJECTED">Reject</button>`:''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No expenses recorded.</p>'}
  </div>`;
}

function openIncomeForm(){
  modal({
    title:'Record income',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Category</label><select id="in-cat">${INCOME_CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Amount (₦)</label><input type="number" id="in-amt" min="1"></div>
      <div class="f wide"><label class="req">Description</label><input type="text" id="in-desc" placeholder="Donation from PTA, hall rental for a wedding, ..."></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="in-save">Record</button>`,
    wire(){
      $('#in-save').addEventListener('click',()=>{
        const amt = Math.round(Number($('#in-amt').value)*100), desc = $('#in-desc').value.trim();
        if(!amt||amt<=0){ toast('Enter an amount greater than zero.', true); return; }
        if(!desc){ toast('Enter a description.', true); return; }
        const ref = `INC/2026/${String(db.income.length+1).padStart(5,'0')}`;
        db.income.push({id:uid('inc'), category:$('#in-cat').value, description:desc, amount:amt, at:todayISO(), ref, recordedBy:ROLES[state.role].name});
        db.ledger.push({journalRef:ref, debit:'CASH_AT_BANK', credit:'OTHER_INCOME', amount:amt, at:todayISO()});
        logAudit('finance.income', `${nairaFull(amt)} income recorded — ${desc}`);
        persist(); closeModal();
        toast(`${nairaFull(amt)} income recorded.`);
        render();
      });
    },
  });
}

function openExpenseForm(){
  modal({
    title:'Record expense',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Category</label><select id="ex-cat">${EXPENSE_CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Amount (₦)</label><input type="number" id="ex-amt" min="1"></div>
      <div class="f wide"><label class="req">Description</label><input type="text" id="ex-desc" placeholder="Generator fuel, classroom repairs, ..."></div>
    </div>
    <p class="note">${can('finance.approve')?'You can approve or reject expenses — this one is recorded as approved on entry.':'Submitted for approval — the Bursar or Principal signs off before it counts against the books.'}</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="ex-save">Record</button>`,
    wire(){
      $('#ex-save').addEventListener('click',()=>{
        const amt = Math.round(Number($('#ex-amt').value)*100), desc = $('#ex-desc').value.trim();
        if(!amt||amt<=0){ toast('Enter an amount greater than zero.', true); return; }
        if(!desc){ toast('Enter a description.', true); return; }
        const ref = `EXP/2026/${String(db.expenses.length+1).padStart(5,'0')}`;
        const status = can('finance.approve') ? 'APPROVED' : 'PENDING';
        db.expenses.push({id:uid('exp'), category:$('#ex-cat').value, description:desc, amount:amt, at:todayISO(), ref, status, recordedBy:ROLES[state.role].name});
        if(status==='APPROVED') db.ledger.push({journalRef:ref, debit:'EXPENSE', credit:'CASH_AT_BANK', amount:amt, at:todayISO()});
        logAudit('finance.expense', `${nairaFull(amt)} expense ${status.toLowerCase()} — ${desc}`);
        persist(); closeModal();
        toast(status==='APPROVED'?`${nairaFull(amt)} expense recorded.`:`${nairaFull(amt)} expense submitted for approval.`);
        render();
      });
    },
  });
}

function wireFinanceIncomeExpense(){
  const i = $('#add-income'); if(i) i.addEventListener('click',openIncomeForm);
  const e = $('#add-expense'); if(e) e.addEventListener('click',openExpenseForm);
  document.querySelectorAll('[data-exp-decide]').forEach(b=>b.addEventListener('click',()=>{
    const x = db.expenses.find(y=>y.id===b.dataset.expDecide);
    if(!x) return;
    x.status = b.dataset.d;
    if(x.status==='APPROVED') db.ledger.push({journalRef:x.ref, debit:'EXPENSE', credit:'CASH_AT_BANK', amount:x.amount, at:todayISO()});
    logAudit('finance.expense', `Expense ${x.ref} ${x.status.toLowerCase()} — ${x.description}`);
    persist();
    toast(`Expense ${x.status.toLowerCase()}.`);
    render();
  }));
}

// ---- Cashbook -------------------------------------------------------------

/** Every line is a fee payment, a recorded income, or an approved expense —
    nothing is ever entered into the cashbook directly, so it can't drift
    from the records it's built from. */
function cashbookEntries(){
  const rows = [
    ...db.payments.filter(p=>!p.reversed).map(p=>{
      const s = db.students.find(x=>x.id===p.studentId);
      return {ref:p.ref, at:p.at, desc:`Fee payment — ${s?`${s.firstName} ${s.lastName}`:'—'}`, inAmt:p.amount, outAmt:0};
    }),
    ...db.income.map(x=>({ref:x.ref, at:x.at, desc:`${x.category} — ${x.description}`, inAmt:x.amount, outAmt:0})),
    ...db.expenses.filter(x=>x.status==='APPROVED').map(x=>({ref:x.ref, at:x.at, desc:`${x.category} — ${x.description}`, inAmt:0, outAmt:x.amount})),
  ].sort((a,b)=>a.at.localeCompare(b.at) || a.ref.localeCompare(b.ref));
  let bal = 0;
  return rows.map(r=>{ bal += r.inAmt - r.outAmt; return {...r, balance:bal}; });
}

function financeCashbookBody(){
  const rows = cashbookEntries();
  const totalIn = rows.reduce((t,r)=>t+r.inAmt,0), totalOut = rows.reduce((t,r)=>t+r.outAmt,0);

  return `
  <div class="toolbar" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-q" id="print-cashbook">Print</button></div>
  <div class="grid-stats">
    <div class="stat">${svg('income',40)}<div><div class="v">${naira(totalIn)}</div><div class="l">Total in</div></div></div>
    <div class="stat">${svg('expense',40)}<div><div class="v">${naira(totalOut)}</div><div class="l">Total out</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(totalIn-totalOut)}</div><div class="l">Cash balance</div></div></div>
  </div>
  <div class="tw"><table>
    <thead><tr><th>Ref</th><th>Date</th><th>Description</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td style="font-family:var(--mono);font-size:11px">${esc(r.ref)}</td>
      <td>${fmtDate(r.at)}</td>
      <td style="font-size:12px">${esc(r.desc)}</td>
      <td class="num" style="color:var(--moss)">${r.inAmt?naira(r.inAmt):''}</td>
      <td class="num" style="color:var(--clay)">${r.outAmt?naira(r.outAmt):''}</td>
      <td class="num" style="font-weight:600">${naira(r.balance)}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${rows.length===0?'<p class="sub">No cash movements yet.</p>':''}`;
}

function wireFinanceCashbook(){
  const b = $('#print-cashbook'); if(b) b.addEventListener('click',()=>window.print());
}

// ---- Bank Reconciliation ---------------------------------------------------

function financeReconBody(){
  const rows = cashbookEntries();
  const reconciled = rows.filter(r=>db.reconciledRefs.includes(r.ref));

  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('sPending',40)}<div><div class="v">${reconciled.length}/${rows.length}</div><div class="l">Lines reconciled</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(reconciled.reduce((t,r)=>t+r.inAmt-r.outAmt,0))}</div><div class="l">Reconciled balance</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${rows.length-reconciled.length}</div><div class="l">Awaiting match</div></div></div>
  </div>

  <div class="toolbar">
    <label style="font-size:12.5px;color:var(--muted)">Bank statement closing balance (₦)</label>
    <input type="number" class="pick" id="recon-stmt" style="width:160px" value="${esc(state.reconStatement)}" placeholder="0">
    <span id="recon-variance" style="font-family:var(--mono);font-size:12px"></span>
  </div>

  <div class="tw"><table>
    <thead><tr><th></th><th>Ref</th><th>Date</th><th>Description</th><th class="num">In</th><th class="num">Out</th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td><input type="checkbox" data-recon="${esc(r.ref)}" ${db.reconciledRefs.includes(r.ref)?'checked':''}></td>
      <td style="font-family:var(--mono);font-size:11px">${esc(r.ref)}</td>
      <td>${fmtDate(r.at)}</td>
      <td style="font-size:12px">${esc(r.desc)}</td>
      <td class="num" style="color:var(--moss)">${r.inAmt?naira(r.inAmt):''}</td>
      <td class="num" style="color:var(--clay)">${r.outAmt?naira(r.outAmt):''}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${rows.length===0?'<p class="sub">Nothing to reconcile yet.</p>':''}
  <p class="note">Ticking a line marks it matched against the bank statement — it never changes the amount or the cashbook, only whether it has been checked off.</p>`;
}

function wireFinanceRecon(){
  const calc = () => {
    const reconciled = cashbookEntries().filter(r=>db.reconciledRefs.includes(r.ref));
    const reconciledBalance = reconciled.reduce((t,r)=>t+r.inAmt-r.outAmt,0);
    const stmtInput = $('#recon-stmt');
    const stmt = Math.round(Number(stmtInput?.value||0)*100);
    const variance = stmt - reconciledBalance;
    const v = $('#recon-variance');
    if(v) v.innerHTML = stmtInput?.value ? (variance===0
      ? `<span style="color:var(--moss)">Matches — no variance.</span>`
      : `<span style="color:var(--clay)">Variance ${nairaFull(Math.abs(variance))} ${variance>0?'unaccounted for':'over-reconciled'}.</span>`) : '';
  };
  const stmtInput = $('#recon-stmt');
  if(stmtInput) stmtInput.addEventListener('input',()=>{ state.reconStatement=stmtInput.value; calc(); });
  document.querySelectorAll('[data-recon]').forEach(cb=>cb.addEventListener('change',()=>{
    const ref = cb.dataset.recon;
    if(cb.checked) db.reconciledRefs.push(ref); else db.reconciledRefs = db.reconciledRefs.filter(r=>r!==ref);
    persist();
    calc();
  }));
  calc();
}

// ---- Financial Reports (+ Budgeting) --------------------------------------

function financeReportsBody(){
  const totals = db.students.reduce((a,s)=>{
    const f = feeSummary(s); a.b+=f.billed; a.p+=f.paid; a.gross+=f.gross; a.schol+=f.scholAmt; a.disc+=f.discAmt; return a;
  },{b:0,p:0,gross:0,schol:0,disc:0});
  const totalIncome = db.income.reduce((t,x)=>t+x.amount,0);
  const totalExpense = db.expenses.filter(x=>x.status==='APPROVED').reduce((t,x)=>t+x.amount,0);
  const netCash = totals.p + totalIncome - totalExpense;

  const debtors = db.students.filter(s=>s.status==='ACTIVE').map(s=>({s, fee:feeSummary(s)}))
    .filter(r=>r.fee.balance>0).sort((a,b)=>b.fee.balance-a.fee.balance).slice(0,10);

  const expenseByCat = EXPENSE_CATEGORIES.map(cat=>({
    cat, actual: db.expenses.filter(x=>x.category===cat&&x.status==='APPROVED').reduce((t,x)=>t+x.amount,0),
    budget: db.budgets.find(b=>b.category===cat),
  }));

  return `
  <div class="toolbar" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-q" id="print-finrep">Print</button></div>

  <div class="grid-stats">
    <div class="stat">${svg('income',40)}<div><div class="v">${naira(totals.p+totalIncome)}</div><div class="l">Total income</div></div></div>
    <div class="stat">${svg('expense',40)}<div><div class="v">${naira(totalExpense)}</div><div class="l">Total expenses</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(netCash)}</div><div class="l">Net position</div></div></div>
    <div class="stat">${svg('scholarship',40)}<div><div class="v">${naira(totals.schol+totals.disc)}</div><div class="l">Waived (scholarships + discounts)</div></div></div>
  </div>

  <div class="block">
    <h2>Fee collection <small>${TERM}, ${SESSION}</small></h2>
    <div class="tw"><table>
      <thead><tr><th></th><th class="num">Amount</th></tr></thead>
      <tbody>
        <tr><td>Gross billed</td><td class="num">${nairaFull(totals.gross)}</td></tr>
        <tr><td style="color:var(--moss)">Scholarships</td><td class="num" style="color:var(--moss)">−${nairaFull(totals.schol)}</td></tr>
        <tr><td style="color:var(--moss)">Discounts</td><td class="num" style="color:var(--moss)">−${nairaFull(totals.disc)}</td></tr>
        <tr><td style="font-weight:600">Net billed</td><td class="num" style="font-weight:600">${nairaFull(totals.b)}</td></tr>
        <tr><td>Collected</td><td class="num">${nairaFull(totals.p)}</td></tr>
        <tr><td style="font-weight:600">Outstanding</td><td class="num" style="font-weight:600;color:var(--clay)">${nairaFull(Math.max(totals.b-totals.p,0))}</td></tr>
      </tbody>
    </table></div>
  </div>

  <div class="block">
    <h2>Top debtors</h2>
    ${debtors.length?`<div class="tw"><table>
      <thead><tr><th>Student</th><th>Class</th><th class="num">Balance</th></tr></thead>
      <tbody>${debtors.map(({s,fee})=>`<tr>
        <td><div class="who-cell">${avatar(s)}<div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
        <td>${className(CLASSES.find(c=>c.id===s.classId))}</td>
        <td class="num" style="color:var(--clay);font-weight:600">${nairaFull(fee.balance)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">Nobody carries a balance.</p>'}
  </div>

  <div class="block">
    <h2>Budget vs actual <small>expenses, ${TERM}</small></h2>
    <div class="tw"><table>
      <thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th></tr></thead>
      <tbody>${expenseByCat.map(r=>{
        const budgetAmt = r.budget?r.budget.allocated:0;
        const variance = budgetAmt - r.actual;
        return `<tr><td>${esc(r.cat)}</td>
          <td class="num">${r.budget?nairaFull(budgetAmt):'<span style="color:var(--muted)">Not budgeted</span>'}</td>
          <td class="num">${nairaFull(r.actual)}</td>
          <td class="num" style="color:${!r.budget?'var(--muted)':variance<0?'var(--clay)':'var(--moss)'}">${r.budget?nairaFull(variance):'—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    ${can('finance.create')?`<div class="toolbar" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-q btn-s" id="add-budget">Set budget line</button></div>`:''}
  </div>`;
}

function openBudgetForm(){
  modal({
    title:'Set budget line',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Category</label><select id="bg-cat">${EXPENSE_CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Allocated (₦)</label><input type="number" id="bg-amt" min="0"></div>
    </div>
    <p class="note">One allocation per category per term — setting it again replaces the previous figure.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="bg-save">Save</button>`,
    wire(){
      $('#bg-save').addEventListener('click',()=>{
        const cat = $('#bg-cat').value, amt = Math.round(Number($('#bg-amt').value)*100);
        if(!amt || amt<0){ toast('Enter an amount.', true); return; }
        db.budgets = db.budgets.filter(b=>b.category!==cat);
        db.budgets.push({id:uid('bud'), category:cat, allocated:amt, term:TERM, session:SESSION});
        logAudit('finance.budget', `Budget for ${cat} set to ${nairaFull(amt)}`);
        persist(); closeModal();
        toast('Budget line saved.');
        render();
      });
    },
  });
}

function wireFinanceReports(){
  const b = $('#print-finrep'); if(b) b.addEventListener('click',()=>window.print());
  const bb = $('#add-budget'); if(bb) bb.addEventListener('click',openBudgetForm);
}

// -------------------------------------------------------------- admissions --

const STAGES = ['SUBMITTED','PAYMENT_CONFIRMED','UNDER_REVIEW','SHORTLISTED','EXAM_TAKEN','INTERVIEWED','OFFERED','ENROLLED'];

// Real backend data — same fetch-then-cache-then-render shape as Students
// above. Each row already carries everything the review modal needs, so
// opening an application reads straight from the cached list rather than
// firing its own per-row fetch.
const admissionsCache = { data:null, meta:null, loading:false, error:false, errorReason:null, offline:false };
function invalidateAdmissionsCache(){ admissionsCache.data = null; admissionsCache.error = false; }

/** Backend-shaped view of the seeded `db.applications`. Used as a fallback
    when the API can't be reached (no `npm run dev:server`): field names and
    enum values are normalised to match what GET /api/admissions returns, so
    PAGES.admissions and openApplication() render either source unchanged. */
function admissionsFromSeed(){
  const stage = state.admissionStage;
  return db.applications
    .filter(a => !stage || a.stage === stage)
    .map(a => ({
      id: a.id, ref: a.ref, firstName: a.firstName, lastName: a.lastName,
      gender: a.gender === 'F' ? 'FEMALE' : 'MALE',
      dob: a.dob, applyingFor: a.applyingFor, previousSchool: a.previousSchool,
      guardianName: a.guardian, guardianPhone: a.guardianPhone,
      feePaid: a.feePaid, examScore: a.examScore, stage: a.stage, submittedOn: a.submittedOn,
    }));
}

async function loadAdmissionsData(){
  if(admissionsCache.loading) return;
  admissionsCache.loading = true; admissionsCache.error = false; admissionsCache.errorReason = null;
  try{
    const params = new URLSearchParams({ pageSize:'100' });
    if(state.admissionStage) params.set('stage', state.admissionStage);
    const res = await apiGet(`/api/admissions?${params}`);
    admissionsCache.data = res.data; admissionsCache.meta = res.meta; admissionsCache.offline = false;
  } catch(e){
    const reason = apiErrorReason(e);
    // Only fall back for an unreachable backend — a 403/429/5xx is a real
    // answer from the server and should still surface as an error state.
    if(reason === 'network'){
      admissionsCache.data = admissionsFromSeed();
      admissionsCache.meta = { total: admissionsCache.data.length };
      admissionsCache.offline = true;
    } else {
      admissionsCache.error = true; admissionsCache.errorReason = reason;
    }
  }
  finally{ admissionsCache.loading = false; if(state.route==='admissions') render(); }
}

PAGES.admissions = () => {
  if(admissionsCache.error){
    return `<div class="empty"><b>Couldn't load applications</b>${apiErrorMessage(admissionsCache.errorReason)} <a href="#" id="ad-retry">try again</a>.</div>`;
  }
  if(!admissionsCache.data){
    loadAdmissionsData();
    return `<div class="empty"><b>Loading applications…</b>Fetching from the school's database.</div>`;
  }
  const list = admissionsCache.data;

  return `
  <div class="phead">
    <div><h1>Admissions</h1><p>Applications on file. Approving an offer creates the student record and this session's enrolment in one transaction — no re-keying, and no paper form.</p></div>
  </div>

  <div class="toolbar">
    <select class="pick" id="ad-stage">
      <option value="">All stages</option>
      ${STAGES.map(s=>`<option value="${s}" ${state.admissionStage===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}
    </select>
    <span class="spacer"></span>
    ${admissionsCache.offline?'<span class="pill p-warn" title="Backend offline — run npm run dev:server for live data">DEMO DATA</span>':''}
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${list.length} application${list.length===1?'':'s'}</span>
  </div>

  ${list.length===0?'<div class="tw"><div class="empty"><b>Nothing at this stage</b>Choose another stage to see applications.</div></div>':`
  <div class="tw"><table>
    <thead><tr><th>Reference</th><th>Applicant</th><th>Applying for</th><th>Previous school</th><th class="num">Exam</th><th>Stage</th><th></th></tr></thead>
    <tbody>${list.map(a=>`<tr>
      <td style="font-family:var(--mono);font-size:11.5px">${esc(a.ref)}</td>
      <td><div class="who-cell">${realAvatar(a)}
        <div><div class="nm">${esc(a.firstName)} ${esc(a.lastName)}</div><div class="sm">${fmtDate(a.dob)}</div></div></div></td>
      <td>${esc(a.applyingFor)}</td>
      <td style="font-size:12px;color:var(--muted);max-width:200px">${a.previousSchool?esc(a.previousSchool):'—'}</td>
      <td class="num">${a.examScore===null?'—':`<span style="color:${a.examScore<50?'var(--clay)':'inherit'}">${a.examScore}</span>`}</td>
      <td><span class="pill ${a.stage==='OFFERED'?'p-ok':a.stage==='ENROLLED'?'p-ok':a.stage==='SUBMITTED'?'p-mute':'p-info'}">${a.stage.replace(/_/g,' ')}</span></td>
      <td><button class="btn btn-q btn-s" data-app="${a.id}">Review</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`}`;
};

PAGES.admissions_wire = () => {
  const retry = $('#ad-retry'); if(retry) retry.addEventListener('click', e=>{ e.preventDefault(); invalidateAdmissionsCache(); render(); });
  const s = $('#ad-stage'); if(s) s.addEventListener('change', e=>{ state.admissionStage=e.target.value; invalidateAdmissionsCache(); render(); });
  document.querySelectorAll('[data-app]').forEach(b=>b.addEventListener('click',()=>openApplication(b.dataset.app)));
};

function openApplication(id){
  const a = admissionsCache.data.find(x=>x.id===id);
  const idx = STAGES.indexOf(a.stage);
  const next = STAGES[idx+1];

  modal({
    title:`${a.firstName} ${a.lastName}`, sub:`${a.ref} · applying for ${a.applyingFor}`, wide:true,
    body:`
      <div class="stepline">${STAGES.slice(0,7).map((s,i)=>
        `<div class="step ${i<idx?'done':i===idx?'now':''}">${s.replace(/_/g,' ')}</div>`).join('')}</div>
      <div class="fgrid" style="align-items:start">
        <dl class="kv">
          <dt>Date of birth</dt><dd>${fmtDate(a.dob)}</dd>
          <dt>Gender</dt><dd>${a.gender==='FEMALE'?'Female':'Male'}</dd>
          <dt>Previous school</dt><dd>${a.previousSchool?esc(a.previousSchool):'—'}</dd>
          <dt>Submitted</dt><dd>${fmtDate(a.submittedOn)}</dd>
        </dl>
        <dl class="kv">
          <dt>Guardian</dt><dd>${esc(a.guardianName)}</dd>
          <dt>Phone</dt><dd style="font-family:var(--mono);font-size:12px">${esc(a.guardianPhone)}</dd>
          <dt>Application fee</dt><dd>${a.feePaid?'<span class="pill p-ok">PAID</span>':'<span class="pill p-bad">UNPAID</span>'}</dd>
          <dt>Entrance exam</dt><dd>${a.examScore===null?'Not sat':`${a.examScore}%  ${a.examScore>=50?'<span class="pill p-ok">PASS</span>':'<span class="pill p-bad">BELOW MARK</span>'}`}</dd>
        </dl>
      </div>
      ${a.stage==='OFFERED'?`<p class="note"><b>An offer has been made.</b> Accepting it creates the student record and this session's enrolment — in one transaction, so a half-created student is impossible.</p>`:''}`,
    foot:`<button class="btn btn-q" data-close>Close</button>
      ${a.stage==='OFFERED'&&can('admissions.approve')?`<button class="btn btn-y" id="enrol">Accept offer and enrol</button>`:
        next&&a.stage!=='ENROLLED'&&can(next==='REJECTED'?'admissions.reject':'admissions.approve')?`<button class="btn btn-p" id="advance">Advance to ${next.replace(/_/g,' ').toLowerCase()}</button>`:''}`,
    wire(){
      const adv = $('#advance');
      if(adv) adv.addEventListener('click', async ()=>{
        if(admissionsCache.offline){
          const row = db.applications.find(x=>x.id===a.id);
          if(row){ row.stage = next; persist(); }
          toast(`${esc(a.firstName)} ${esc(a.lastName)} moved to ${next.replace(/_/g,' ').toLowerCase()}.`);
          invalidateAdmissionsCache(); closeModal(); render();
          return;
        }
        try{
          await apiPatch(`/api/admissions/${a.id}/stage`, { stage: next });
          toast(`${esc(a.firstName)} ${esc(a.lastName)} moved to ${next.replace(/_/g,' ').toLowerCase()}.`);
          invalidateAdmissionsCache();
          closeModal(); render();
        } catch(e){ toast('Could not advance this application.', true); }
      });
      const enr = $('#enrol');
      if(enr) enr.addEventListener('click', async ()=>{
        if(admissionsCache.offline){
          toast('Enrolling an applicant writes to the database — start the backend (npm run dev:server) first.', true);
          return;
        }
        try{
          const classes = await loadClasses();
          const target = classes.find(c=>c.level===a.applyingFor) || classes[0];
          if(!target){ toast('No classes are set up yet.', true); return; }
          const term = await apiGet('/api/settings/current-term').catch(()=>null);
          if(!term || !term.academicSessionId){ toast('No current academic session is set.', true); return; }
          const result = await apiPatch(`/api/admissions/${a.id}/stage`, { stage:'ENROLLED', classId:target.id, academicSessionId:term.academicSessionId });
          toast(`<b>${esc(result.student.firstName)} ${esc(result.student.lastName)}</b> enrolled in ${className(target)} as ${esc(result.student.admissionNo)}.`);
          invalidateAdmissionsCache(); invalidateStudentsCache();
          closeModal(); render();
        } catch(e){ toast('Could not enrol this applicant.', true); }
      });
    },
  });
}

// ------------------------------------------------------------------- staff --

PAGES.staff = () => `
  <div class="phead">
    <div><h1>Staff</h1><p>${db.staff.length} employees. Teaching staff carry a TRCN licence number, which the Nigerian regulator requires on record.</p></div>
    ${can('staff.create')?'<button class="btn btn-y" id="add-staff">Add staff</button>':''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Name</th><th>Position</th><th>Department</th><th>TRCN</th><th>Phone</th><th>Status</th><th></th></tr></thead>
    <tbody>${db.staff.map(m=>`<tr>
      <td><div class="who-cell">${avatar(m)}
        <div><div class="nm">${esc(m.firstName)} ${esc(m.lastName)}</div><div class="sm">${esc(m.staffNo)}</div></div></div></td>
      <td>${esc(m.position)}</td><td>${esc(m.department)}</td>
      <td style="font-family:var(--mono);font-size:11.5px;color:${m.trcn?'inherit':'var(--muted)'}">${m.trcn?esc(m.trcn):'—'}</td>
      <td style="font-family:var(--mono);font-size:11.5px">${esc(m.phone)}</td>
      <td><span class="pill p-ok">${m.status}</span></td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-q btn-s" data-staff="${m.id}">Profile</button>
        ${can('staff.edit')?`<button class="btn btn-q btn-s" data-staff-edit="${m.id}">Edit</button>`:''}
      </td></tr>`).join('')}</tbody>
  </table></div>`;

PAGES.staff_wire = () => {
  const b=$('#add-staff'); if(b) b.addEventListener('click',()=>openStaffForm());
  document.querySelectorAll('[data-staff]').forEach(x=>x.addEventListener('click',()=>openStaffProfile(x.dataset.staff)));
  document.querySelectorAll('[data-staff-edit]').forEach(x=>x.addEventListener('click',()=>openStaffForm(x.dataset.staffEdit)));
};

function openStaffProfile(id){
  const m = db.staff.find(x=>x.id===id);
  const ps = computePayslip(m);
  const teaching = Object.entries(db.timetable).filter(([,v])=>v.staffId===id).length;
  const leave = db.leave.filter(l=>l.staffId===id);
  const att = staffAttendanceRate(id);
  const bio = db.biometrics.filter(b=>b.staffId===id);

  modal({
    title:`${m.firstName} ${m.lastName}`, sub:`${m.staffNo} · ${m.position}`, wide:true,
    body:`
      <div style="padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid var(--rule)">
        ${photoPicker(m, 88)}
      </div>
      <div class="fgrid" style="align-items:start">
        <dl class="kv">
          <dt>Staff number</dt><dd style="font-family:var(--mono);font-size:12px">${esc(m.staffNo)}</dd>
          <dt>Position</dt><dd>${esc(m.position)}</dd>
          <dt>Department</dt><dd>${esc(m.department)}</dd>
          <dt>TRCN licence</dt><dd>${m.trcn?esc(m.trcn):'<span style="color:var(--muted)">Not a teaching post</span>'}</dd>
          <dt>Phone</dt><dd style="font-family:var(--mono);font-size:12px">${esc(m.phone)}</dd>
          <dt>Biometric</dt><dd>${bio.length?bio.map(b=>`<span class="pill p-info">${b.type}</span>`).join(' '):'<span style="color:var(--muted)">Not enrolled</span>'}</dd>
        </dl>
        <dl class="kv">
          <dt>Grade</dt><dd>${esc(ps.grade.name)}</dd>
          <dt>Periods a week</dt><dd>${teaching}</dd>
          <dt>Attendance</dt><dd>${att===null?'Not yet marked':att+'%'}</dd>
          <dt>Leave taken</dt><dd>${leave.filter(l=>l.status==='APPROVED').reduce((t,l)=>t+l.days,0)} days</dd>
          <dt>Bank</dt><dd>${esc(m.bank)}</dd>
          <dt>PFA</dt><dd>${esc(m.pfa)}</dd>
        </dl>
      </div>
      ${bio.length===0 && can('staff.edit')?`<div class="toolbar" style="margin-top:10px"><button class="btn btn-q btn-s" id="act-sbiometric">Enrol biometric</button></div>`:''}`,
    foot: `<button class="btn btn-q" data-close>Close</button>
      ${can('staff.edit')?'<button class="btn btn-q" id="sp-edit">Edit</button>':''}
      ${can('payroll.view')?'<button class="btn btn-p" id="sp-slip">Payslip</button>':''}`,
    wire(){
      const s=$('#sp-slip'); if(s) s.addEventListener('click',()=>{ closeModal(); openPayslip(id); });
      const e=$('#sp-edit'); if(e) e.addEventListener('click',()=>{ closeModal(); openStaffForm(id); });
      const b=$('#act-sbiometric'); if(b) b.addEventListener('click',()=>openBiometricForm(m,'staff'));
    },
  });
}

/** With an id, edits the existing record in place — same id and staff number,
    every field re-validated exactly as at onboarding. Without one, creates a
    new employee. staff.employee.edit gates the button that reaches this in
    edit mode; the form itself doesn't re-check, same as the rest of the app. */
function openStaffForm(editId){
  const existing = editId ? db.staff.find(x=>x.id===editId) : null;

  modal({
    title: existing ? 'Edit staff' : 'Add staff',
    sub: existing ? `Updates ${esc(existing.firstName)} ${esc(existing.lastName)}'s record — changes apply immediately, including to their next payslip.`
                  : 'Creates the employee record with everything the profile and first payslip need — nothing left to fill in later.',
    wide:true,
    body:`
      <h3 style="font-size:12.5px;margin-bottom:9px">Personal</h3>
      <div class="fgrid">
        <div class="f"><label class="req">First name</label><input type="text" id="sf-first" value="${existing?esc(existing.firstName):''}"><div class="err" id="e-sfirst"></div></div>
        <div class="f"><label class="req">Surname</label><input type="text" id="sf-last" value="${existing?esc(existing.lastName):''}"><div class="err" id="e-slast"></div></div>
        <div class="f"><label>Gender</label><select id="sf-gender"><option value="M" ${existing?.gender==='M'?'selected':''}>Male</option><option value="F" ${existing?.gender==='F'?'selected':''}>Female</option></select></div>
        <div class="f"><label class="req">Phone</label><input type="text" id="sf-phone" placeholder="08012345678" value="${existing?esc(existing.phone):''}"><div class="err" id="e-sphone"></div></div>
      </div>
      <h3 style="font-size:12.5px;margin:18px 0 9px">Employment</h3>
      <div class="fgrid">
        <div class="f"><label class="req">Position</label><input type="text" id="sf-pos" placeholder="Subject Teacher" value="${existing?esc(existing.position):''}"><div class="err" id="e-spos"></div></div>
        <div class="f"><label>Department</label><select id="sf-dept">${['Academic','Finance','Administration','Operations'].map(d=>`<option ${existing?.department===d?'selected':''}>${d}</option>`).join('')}</select></div>
        <div class="f"><label class="req">Salary grade</label><select id="sf-grade">${SALARY_GRADES.map(g=>`<option value="${g.id}" ${existing?.gradeId===g.id?'selected':''}>${esc(g.name)} — ${naira(g.gross)}/yr</option>`).join('')}</select></div>
        <div class="f"><label>TRCN licence number</label><input type="text" id="sf-trcn" placeholder="Required for teaching staff" value="${existing?.trcn?esc(existing.trcn):''}"></div>
      </div>
      <h3 style="font-size:12.5px;margin:18px 0 9px">Payroll & banking</h3>
      <div class="fgrid">
        <div class="f"><label class="req">Bank</label><select id="sf-bank">${BANKS.map(b=>`<option ${existing?.bank===b?'selected':''}>${esc(b)}</option>`).join('')}</select></div>
        <div class="f"><label class="req">Account number</label><input type="text" id="sf-acct" placeholder="0123456789" value="${existing?esc(existing.accountNo):''}"><div class="err" id="e-sacct"></div></div>
        <div class="f"><label class="req">Pension fund administrator</label><select id="sf-pfa">${PFAS.map(p=>`<option ${existing?.pfa===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
        <div class="f"><label>Annual rent declared</label><input type="number" id="sf-rent" placeholder="0" min="0" value="${existing?.annualRent?Math.round(existing.annualRent/100):''}"><div class="err" id="e-srent"></div></div>
      </div>
      <p class="note" style="margin-top:14px">Rent relief on PAYE is 20% of declared annual rent, capped at ₦500,000 — leave blank if no evidence has been provided.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="sf-save">${existing?'Save changes':'Save staff'}</button>`,
    wire(){
      $('#sf-save').addEventListener('click',()=>{
        const v = id => ($('#'+id)?.value||'').trim();
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const errs = {};
        if(!v('sf-first')) errs['e-sfirst']='Enter the first name.';
        if(!v('sf-last')) errs['e-slast']='Enter the surname.';
        if(!v('sf-pos')) errs['e-spos']='Enter the position.';
        const phone = v('sf-phone');
        if(!phone) errs['e-sphone']='Enter a phone number.';
        else if(!/^0[789][01]\d{8}$/.test(phone)) errs['e-sphone']='Use an 11-digit Nigerian number.';
        const acct = v('sf-acct');
        if(!acct) errs['e-sacct']='Enter the account number.';
        else if(!/^\d{10}$/.test(acct)) errs['e-sacct']='NUBAN account numbers are 10 digits.';
        const rent = v('sf-rent');
        if(rent && Number(rent)<0) errs['e-srent']='Rent cannot be negative.';
        if(Object.keys(errs).length){ for(const [k,m] of Object.entries(errs)){const n=$('#'+k);if(n)n.textContent=m;} return; }

        const fields = {
          firstName:v('sf-first'), lastName:v('sf-last'), gender:v('sf-gender'),
          position:v('sf-pos'), department:v('sf-dept'), phone, trcn:v('sf-trcn')||null,
          gradeId:v('sf-grade'), bank:v('sf-bank'), accountNo:acct, pfa:v('sf-pfa'),
          annualRent: rent ? Math.round(Number(rent)*100) : 0,
        };
        if(existing){
          Object.assign(existing, fields);
          logAudit('staff.update', `${fields.firstName} ${fields.lastName} (${existing.staffNo}) record updated`);
        } else {
          const staffNo = `FA/STF/${String(db.staff.length+1).padStart(3,'0')}`;
          db.staff.push({id:uid('sf'), staffNo, status:'ACTIVE', ...fields});
          logAudit('staff.create', `${fields.firstName} ${fields.lastName} onboarded as ${staffNo}`);
          notify('PRINCIPAL', 'New staff onboarded', `${fields.firstName} ${fields.lastName} (${fields.position}) was added to staff.`);
        }
        persist(); closeModal();
        toast(`<b>${esc(v('sf-first'))} ${esc(v('sf-last'))}</b> ${existing?'updated':'added to staff'}.`);
        render();
      });
    },
  });
}

// ----------------------------------------------------------------- notices --

function openNoticeForm(){
  modal({
    title:'Post a notice', sub:'Appears on the notice board and, once published, notifies parents.',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Title</label><input type="text" id="nt-title"><div class="err" id="e-ntitle"></div></div>
      <div class="f wide"><label class="req">Details</label><textarea id="nt-body" rows="3"></textarea><div class="err" id="e-nbody"></div></div>
      <div class="f"><label>When</label><input type="text" id="nt-when" placeholder="Saturday 15 August"></div>
      <div class="f"><label>Colour</label><select id="nt-cls"><option value="n-yellow">Yellow</option><option value="n-lilac">Lilac</option><option value="n-peach">Peach</option></select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="nt-save">Publish notice</button>`,
    wire(){
      $('#nt-save').addEventListener('click',()=>{
        const t = $('#nt-title').value.trim(), b = $('#nt-body').value.trim();
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        if(!t){ $('#e-ntitle').textContent='Enter a title.'; return; }
        if(!b){ $('#e-nbody').textContent='Enter the details.'; return; }
        db.notices.unshift({id:uid('n'), cls:$('#nt-cls').value, art:'aExam', title:t, body:b,
          when:$('#nt-when').value.trim()||fmtDate(todayISO()), at:todayISO()});
        logAudit('communication.notice', `Notice published: ${t}`);
        notify('PARENT', t, b);
        notify('STUDENT', t, b);
        persist(); closeModal();
        toast('Notice published to the board.');
        state.route='dashboard'; render();
      });
    },
  });
}

// ----------------------------------------------------------------- portals --
/*  Modules 14, 15 and 16. One route, three genuinely different homes.

    A portal is not the admin console with buttons removed. A parent opening
    this at 6am wants three answers — is my child in school, what do I owe, how
    are they doing — and should not have to learn a navigation tree to get
    them. So the portal leads with the answers and puts the detail behind them. */

/*  Shown when a role that holds `portal.view` for oversight (most admin
    seats do) opens My Portal. The portal itself only has a Parent, a Student
    and a Teacher home — there is nothing to render for a Bursar or a
    Principal — so this explains that rather than dead-ending on a one-liner. */
function portalRoleGate(){
  const r = ROLES[state.role] || { title: state.role };
  const audiences = [
    ['Parent',  'PARENT',  'Fees, attendance and results for every child at the school — plus a direct line to their teachers.'],
    ['Student', 'STUDENT', 'Timetable, assignments and the termly report card, with homework that can be handed in online.'],
    ['Teacher', 'TEACHER', 'Classes and rosters — take the register, set and mark assignments, and write termly remarks.'],
  ];
  return `
  <div class="phead">
    <div><h1>My Portal</h1><p>A focused home for families and teaching staff, kept separate from the admin console.</p></div>
    <span class="pill p-mute">${esc(r.title)}</span>
  </div>

  <div class="block" style="text-align:center;padding:32px 24px">
    <div style="display:flex;justify-content:center">${logoIMG(44)}</div>
    <h2 style="display:block;font-size:17px;margin:12px 0 6px">Not available for your role</h2>
    <p style="color:var(--muted);font-size:13px;max-width:54ch;margin:0 auto">
      You're signed in as <b>${esc(r.title)}</b>. The portal is built for Parent, Student and
      Teacher-family logins — every other role works from the main console on the left.</p>
  </div>

  <div class="fgrid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px">
    ${audiences.map(([label,key,desc])=>`
      <div class="block" style="margin:0">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
          <span class="pill p-info">${key}</span><b style="font-size:13.5px">${label}</b>
        </div>
        <p style="color:var(--muted);font-size:12.5px;line-height:1.55;margin:0">${desc}</p>
      </div>`).join('')}
  </div>

  <div class="note" style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
    <span>Reviewing the portal? Sign in with a Parent, Student or Teacher demo account — the password is <b>fadesrek2026</b>.</span>
    <button class="btn btn-q btn-s" id="portal-switch">Switch account</button>
  </div>`;
}

PAGES.portal = () => {
  if(!REAL_PORTAL_ROLES.includes(state.role)){
    return portalRoleGate();
  }
  if(portalCache.error){
    return `<div class="empty"><b>Couldn't load your portal</b>Check that the backend (npm run dev:server) is running, then <a href="#" id="portal-retry">try again</a>.</div>`;
  }
  if(!portalCache.data){
    loadPortalData();
    return `<div class="empty"><b>Loading your portal…</b>Fetching your data from the school's records.</div>`;
  }
  const r = ROLES[state.role];
  if(r.scope==='OWN_RECORDS') return parentPortalReal(portalCache.data);
  if(r.scope==='SELF')        return studentPortalReal(portalCache.data);
  return teacherPortalReal(portalCache.data);
};

/** Maps a real Student's gender ('MALE'/'FEMALE') onto the avatar()
    helper's mock-era 'M'/'F' convention — everything else about a real
    Student/Staff row (id, firstName, lastName) already matches what
    avatar() expects. */
function realAvatar(p, size){
  return avatar({ id:p.id, firstName:p.firstName, lastName:p.lastName, gender:p.gender==='FEMALE'?'F':'M' }, size);
}
function subjectName(subjects, id){ const s=(subjects||[]).find(x=>x.id===id); return s?s.name:'—'; }
function periodLabel(periods, id){ const p=(periods||[]).find(x=>x.id===id); return p?p.from:''; }

function realStudentResult(scores, studentId){
  const mine = (scores||[]).filter(s=>s.studentId===studentId);
  const bySubject = new Map();
  for(const s of mine) bySubject.set(s.subjectId, (bySubject.get(s.subjectId)||0) + s.value);
  const rows = [...bySubject.entries()].map(([subjectId,total])=>({subjectId, total, ...gradeOf(total)}));
  const avg = rows.length ? rows.reduce((t,r)=>t+r.total,0)/rows.length : 0;
  return { rows, avg };
}
function realAttendanceRate(records){
  if(!records || !records.length) return null;
  return Math.round(records.filter(r=>r.mark!=='ABSENT').length/records.length*100);
}
function realFeeBalanceKobo(invoices, studentId){
  const mine = (invoices||[]).filter(i=>i.studentId===studentId);
  const invoiced = mine.reduce((t,i)=>t+(i.lines||[]).reduce((s,l)=>s+Number(l.amountKobo),0),0);
  const paid = mine.reduce((t,i)=>t+(i.payments||[]).reduce((s,p)=>s+Number(p.amountKobo),0),0);
  return invoiced - paid;
}
function todayMarkFor(records){
  const todayStr = new Date().toISOString().slice(0,10);
  const rec = (records||[]).find(r=>r.register && r.register.date && r.register.date.slice(0,10)===todayStr);
  return rec ? rec.mark : null;
}

/* ------------------------------------------------------------ parent home -- */

function parentPortalReal(data){
  const totalOwedKobo = data.kids.reduce((t,k)=>t+Math.max(0,realFeeBalanceKobo(data.invoices,k.student.id)),0);
  const myThreads = data.threads.filter(t=>data.kids.some(k=>k.student.id===t.studentId));

  return `
  <div class="phead">
    <div><h1>Good morning</h1>
      <p>${data.kids.length} ${data.kids.length===1?'child':'children'} at Fadesrek. Everything the school has recorded about them is here.</p></div>
    ${totalOwedKobo>0?`<button class="btn btn-y" id="pay-all">Pay ${naira(totalOwedKobo)}</button>`:
      '<span class="pill p-ok">FEES SETTLED</span>'}
  </div>

  ${data.kids.map(k=>{
    const s = k.student;
    const res = realStudentResult(data.scores, s.id);
    const att = realAttendanceRate(k.attendance);
    const mark = todayMarkFor(k.attendance);
    const missing = k.assignments.filter(a=>!k.submissions.some(x=>x.assignmentId===a.id));
    const balanceKobo = realFeeBalanceKobo(data.invoices, s.id);
    const className_ = s.enrollments?.[0]?.class ? `${s.enrollments[0].class.level} ${s.enrollments[0].class.arm}` : '—';

    return `<div class="block">
      <h2 style="align-items:center">
        <span style="display:flex;gap:11px;align-items:center">
          ${realAvatar(s,38)}
          <span>${esc(s.firstName)} ${esc(s.lastName)}
            <span style="display:block;font-weight:400;font-size:11.5px;color:var(--muted)">${esc(className_)} · ${esc(s.admissionNo)}</span></span>
        </span>
        ${mark?`<span class="pill ${mark==='ABSENT'?'p-bad':mark==='LATE'?'p-warn':'p-ok'}">${mark} TODAY</span>`
             :'<span class="pill p-mute">REGISTER NOT YET MARKED</span>'}
      </h2>

      <div class="grid-stats" style="margin:14px 0">
        <div class="stat"><div style="flex:1"><div class="v">${res.avg.toFixed(1)}%</div><div class="l">Term average · ${gradeOf(res.avg).g}</div></div></div>
        <div class="stat"><div style="flex:1"><div class="v">${att===null?'—':att+'%'}</div><div class="l">Attendance</div></div></div>
        <div class="stat"><div style="flex:1"><div class="v" style="color:${balanceKobo>0?'var(--clay)':'var(--moss)'}">${naira(Math.max(balanceKobo,0))}</div><div class="l">Outstanding</div></div></div>
      </div>

      ${missing.length?`<div style="background:var(--amber-soft);border:1px solid #EBDCBB;border-radius:9px;padding:11px 14px;margin-bottom:12px;font-size:12.5px;color:#6F4E11">
        <b>${missing.length} assignment${missing.length===1?'':'s'} not handed in.</b>
        ${missing.map(a=>esc(a.title)).join('; ')}.</div>`:''}

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-p btn-s" data-p-report="${s.id}">Report card</button>
        ${balanceKobo>0?`<button class="btn btn-y btn-s" data-p-pay="${s.id}" data-p-pay-balance="${balanceKobo}">Pay ${naira(balanceKobo)}</button>`:''}
      </div>
    </div>`;
  }).join('')}

  <div class="block">
    <h2>From the school <small>${data.notices.length} notices</small></h2>
    ${data.notices.length?data.notices.map(n=>`<article class="notice n-${(n.color||'lilac').toLowerCase()}">
      <div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><span class="when">${esc(n.happensOn||fmtDate(n.publishedOn))}</span></div>
    </article>`).join(''):'<p class="sub">No notices posted yet.</p>'}
  </div>

  <div class="block">
    <h2>Messages from the school <small>${myThreads.length}</small></h2>
    ${myThreads.length?`<div class="tw"><table><thead><tr><th>Regarding</th><th>Subject</th><th>Last activity</th><th></th></tr></thead>
      <tbody>${myThreads.map(t=>`<tr>
        <td>${esc(t.student.firstName)} ${esc(t.student.lastName)}</td><td>${esc(t.subject)}</td><td>${fmtDateTime(t.updatedAt)}</td>
        <td><button class="btn btn-q btn-s" data-thread-open="${t.id}">Open</button></td></tr>`).join('')}</tbody></table></div>`
      :'<p class="sub">No conversations yet — messages the school starts with you will appear here, and you can reply from either place.</p>'}
  </div>

  <p class="note">A parent sees their own children and nothing else. <code>OWN_RECORDS</code> is a filter the API applies itself — guessing another family's record id returns a 404, because the row was never in scope.</p>`;
}

/* ----------------------------------------------------------- student home -- */

function studentPortalReal(data){
  if(data.noStudent) return '<div class="empty"><b>No enrolment linked</b>This sign-in is not attached to a student record.</div>';
  const me = data.student;
  const res = realStudentResult(data.scores, me.id);
  const att = realAttendanceRate(data.attendance);
  const className_ = me.enrollments?.[0]?.class ? `${me.enrollments[0].class.level} ${me.enrollments[0].class.arm}` : '—';

  const dayName = DAYS[(new Date().getDay()+6)%7] || 'Monday';
  const today = data.slots.filter(sl=>sl.day===dayName.toUpperCase()).sort((a,b)=>periodLabel(data.periods,a.periodId).localeCompare(periodLabel(data.periods,b.periodId)));

  const outstanding = data.assignments.filter(a=>!data.submissions.some(x=>x.assignmentId===a.id));

  return `
  <div class="phead">
    <div style="display:flex;gap:14px;align-items:center">
      ${realAvatar(me, 56)}
      <div><h1>Hello, ${esc(me.firstName)}</h1>
        <p>${esc(className_)} · ${esc(me.admissionNo)} · ${dayName}, ${fmtDate(new Date())}</p></div>
    </div>
  </div>

  <div class="grid-stats">
    <div class="stat">${svg('scores',40)}<div><div class="v">${res.avg.toFixed(1)}%</div><div class="l">Term average</div></div></div>
    <div class="stat">${svg('attendance',40)}<div><div class="v">${att===null?'—':att+'%'}</div><div class="l">Attendance</div></div></div>
    <div class="stat">${svg('notice',40)}<div><div class="v" style="color:${outstanding.length?'var(--clay)':'var(--moss)'}">${outstanding.length}</div><div class="l">Homework due</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${data.materials.length}</div><div class="l">Learning materials</div></div></div>
  </div>

  <div class="grid-bottom">
    <section class="block">
      <h2>Today <small>${dayName}</small></h2>
      ${today.length? today.map(slot=>`<div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--rule)">
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted);width:52px;flex:none">${esc(periodLabel(data.periods,slot.periodId))}</div>
          <div style="min-width:0"><div style="font-weight:500;font-size:13px">${esc(subjectName(data.subjects,slot.subjectId))}</div></div>
        </div>`).join('') : '<p class="sub">No lessons scheduled today.</p>'}
    </section>

    <section class="block">
      <h2>Homework <small>${outstanding.length} outstanding</small></h2>
      ${data.assignments.length? data.assignments.map(a=>{
        const mine = data.submissions.find(x=>x.assignmentId===a.id);
        const overdueNow = !mine && a.dueOn && new Date(a.dueOn) < new Date();
        return `<div style="border:1px solid ${overdueNow?'#EBCECC':'var(--rule)'};border-radius:9px;padding:11px 13px;margin-bottom:8px;
                     background:${overdueNow?'var(--clay-soft)':'var(--paper)'}">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div style="min-width:0">
              <div style="font-weight:500;font-size:13px">${esc(a.title)}</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${esc(subjectName(data.subjects,a.subjectId))}${a.dueOn?` · due ${fmtDate(a.dueOn)}`:''}</div>
            </div>
            ${mine? (mine.grade!==null&&mine.grade!==undefined
                ? `<span class="pill p-ok">${mine.grade}</span>`
                : '<span class="pill p-info">HANDED IN</span>')
              : overdueNow ? '<span class="pill p-bad">OVERDUE</span>' : '<span class="pill p-warn">TO DO</span>'}
          </div>
          ${!mine?`<button class="btn btn-p btn-s" data-s-submit="${a.id}" style="margin-top:9px">Hand in</button>`:''}
        </div>`;
      }).join('') : '<p class="sub">Nothing set yet.</p>'}
    </section>
  </div>

  <div class="block">
    <h2>My results</h2>
    <div class="tw"><table>
      <thead><tr><th>Subject</th><th class="num">Total</th><th>Grade</th></tr></thead>
      <tbody>${res.rows.map(row=>`<tr>
        <td>${esc(subjectName(data.subjects,row.subjectId))}</td>
        <td class="num" style="font-weight:600">${row.total}</td>
        <td><span class="pill ${row.total>=50?'p-ok':row.total>=40?'p-warn':'p-bad'}">${row.g}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${!res.rows.length?'<p class="sub">No scores recorded yet this term.</p>':''}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-p btn-s" data-s-report="${me.id}">Full report card</button>
    </div>
  </div>

  <div class="block">
    <h2>Learning materials <small>${data.materials.length}</small></h2>
    ${data.materials.length?`<div class="tw"><table><thead><tr><th>Name</th><th>Subject</th><th></th></tr></thead>
      <tbody>${data.materials.map(m=>`<tr><td style="font-weight:500">${esc(m.name)}</td>
        <td>${esc(subjectName(data.subjects,m.subjectId))}</td>
        <td><a class="btn btn-q btn-s" href="${esc(m.storageKey)}" target="_blank" rel="noopener">Open</a></td></tr>`).join('')}</tbody></table></div>`
      :'<p class="sub">Nothing posted for your class yet.</p>'}
  </div>

  <div class="block">
    <h2>Notifications <small>${data.notifications.length}</small></h2>
    ${data.notifications.length?data.notifications.map(n=>`<div style="padding:9px 0;border-bottom:1px solid var(--rule)">
        <div style="font-weight:500;font-size:12.5px">${esc(n.title)}</div>
        <div style="font-size:11.5px;color:var(--muted)">${esc(n.body)} · ${fmtDateTime(n.createdAt)}</div>
      </div>`).join(''):'<p class="sub">Nothing new.</p>'}
  </div>

  <p class="note">A student sees only themselves. <code>SELF</code> is the narrowest scope in the catalogue — narrower than a parent's, because a parent has more than one child and a student has only their own record.</p>`;
}

/* ----------------------------------------------------------- teacher home -- */

function teacherPortalReal(data){
  if(data.noClass) return '<div class="empty"><b>No homeroom class</b>This role isn\'t a class teacher for any class, so there\'s no register to take here.</div>';

  const roll = data.roster;
  const dayName = DAYS[(new Date().getDay()+6)%7] || 'Monday';
  const myLessons = data.slots.filter(sl=>sl.day===dayName.toUpperCase())
    .sort((a,b)=>periodLabel(data.periods,a.periodId).localeCompare(periodLabel(data.periods,b.periodId)));

  const marked = data.register && !data.register.isDraft;
  const presentCount = data.register ? (data.register.records||[]).filter(r=>r.mark!=='ABSENT').length : null;

  const toMark = data.submissions.filter(s=>s.grade===null||s.grade===undefined).length;

  const rollIds = roll.map(s=>s.id);
  const subjectsWithScores = new Set(data.scores.map(s=>s.subjectId));
  const classSubjectIds = [...new Set(data.assignments.map(a=>a.subjectId))];
  const unentered = classSubjectIds.filter(id=>!subjectsWithScores.has(id));

  const atRisk = roll.map(s=>({s, avg: realStudentResult(data.scores, s.id).avg}))
    .filter(x => x.avg > 0 && x.avg < 40);

  return `
  <div class="phead">
    <div><h1>Good morning</h1>
      <p>${roll.length} students · ${dayName}, ${fmtDate(new Date())}</p></div>
    ${!marked?`<button class="btn btn-y" id="t-register">Take the register</button>`:'<span class="pill p-ok">REGISTER TAKEN</span>'}
  </div>

  <div class="grid-stats">
    <div class="stat">${svg('attendance',40)}<div><div class="v">${marked?presentCount+'/'+roll.length:'—'}</div><div class="l">Present today</div></div></div>
    <div class="stat">${svg('scores',40)}<div><div class="v" style="color:${unentered.length?'var(--clay)':'var(--moss)'}">${unentered.length}</div><div class="l">Subjects to mark</div></div></div>
    <div class="stat">${svg('notice',40)}<div><div class="v" style="color:${toMark?'var(--amber)':'inherit'}">${toMark}</div><div class="l">Scripts awaiting marking</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v" style="color:${atRisk.length?'var(--clay)':'inherit'}">${atRisk.length}</div><div class="l">Students needing attention</div></div></div>
  </div>

  <div class="grid-bottom">
    <section class="block">
      <h2>My day <small>${dayName}</small></h2>
      ${myLessons.length? myLessons.map(slot=>`<div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--rule)">
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted);width:52px;flex:none">${esc(periodLabel(data.periods,slot.periodId))}</div>
          <div><div style="font-weight:500;font-size:13px">${esc(subjectName(data.subjects,slot.subjectId))}</div></div>
        </div>`).join('') : '<p class="sub">No lessons scheduled.</p>'}
    </section>

    <section class="block">
      <h2>Needs attention <small>${atRisk.length} student${atRisk.length===1?'':'s'}</small></h2>
      ${atRisk.length? atRisk.slice(0,8).map(x=>`
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--rule)">
          <div style="display:flex;gap:9px;align-items:center;min-width:0">
            ${realAvatar(x.s)}
            <div style="min-width:0"><div style="font-weight:500;font-size:12.5px">${esc(x.s.firstName)} ${esc(x.s.lastName)}</div>
              <div style="font-size:11px;color:var(--muted)">${x.avg.toFixed(1)}% average</div></div>
          </div>
          <span class="pill p-bad">BELOW PASS</span>
          <button class="btn btn-q btn-s" data-t-remark="${x.s.id}" data-t-remark-label="${esc(x.s.firstName)} ${esc(x.s.lastName)}">Comment</button>
        </div>`).join('')
      : '<p class="sub">Nobody is below the pass mark on scores entered so far.</p>'}
    </section>
  </div>

  <div class="block">
    <h2>My assignments <small>${data.assignments.length} set</small></h2>
    ${data.assignments.length? `<div class="tw"><table>
      <thead><tr><th>Assignment</th><th class="num">In</th><th class="num">To mark</th><th></th></tr></thead>
      <tbody>${data.assignments.map(a=>{
        const subs = data.submissions.filter(s=>s.assignmentId===a.id);
        const unmarked = subs.filter(s=>s.grade===null||s.grade===undefined).length;
        return `<tr>
          <td style="font-weight:500">${esc(a.title)}</td>
          <td class="num">${subs.length}</td>
          <td class="num" style="color:${unmarked?'var(--amber)':'inherit'}">${unmarked}</td>
          <td><button class="btn btn-q btn-s" data-t-mark="${a.id}">Mark</button></td>
        </tr>`;}).join('')}</tbody>
    </table></div>` : '<p class="sub">Nothing set for this class yet.</p>'}
  </div>

  <div class="block">
    <h2>Roster <small>${roll.length} students</small></h2>
    <div class="tw"><table><thead><tr><th>Student</th><th></th></tr></thead>
      <tbody>${roll.map(s=>`<tr><td style="display:flex;gap:9px;align-items:center">${realAvatar(s)}
        <span>${esc(s.firstName)} ${esc(s.lastName)}</span></td>
        <td><button class="btn btn-q btn-s" data-t-remark="${s.id}" data-t-remark-label="${esc(s.firstName)} ${esc(s.lastName)}">Comment</button></td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

PAGES.portal_wire = () => {
  if(!portalCache.data) {
    const retry = $('#portal-retry');
    if(retry) retry.addEventListener('click', e=>{ e.preventDefault(); invalidatePortalCache(); render(); });
    const sw = $('#portal-switch');
    if(sw) sw.addEventListener('click', ()=>{ const so = $('#sign-out'); if(so) so.click(); });
    return;
  }

  document.querySelectorAll('[data-p-report],[data-s-report]').forEach(b=>
    b.addEventListener('click',()=>openRealReportCard(b.dataset.pReport||b.dataset.sReport)));
  document.querySelectorAll('[data-p-pay]').forEach(b=>
    b.addEventListener('click',()=>openRealPayment(b.dataset.pPay, Number(b.dataset.pPayBalance||0))));
  document.querySelectorAll('[data-thread-open]').forEach(b=>b.addEventListener('click',()=>openRealThreadView(b.dataset.threadOpen)));

  const payAll = $('#pay-all');
  if(payAll) payAll.addEventListener('click',()=>{
    const kids = portalCache.data.kids||[];
    const first = kids.find(k=>realFeeBalanceKobo(portalCache.data.invoices,k.student.id)>0);
    if(first) openRealPayment(first.student.id, realFeeBalanceKobo(portalCache.data.invoices,first.student.id));
  });

  document.querySelectorAll('[data-s-submit]').forEach(b=>b.addEventListener('click', async ()=>{
    try{
      await apiPost(`/api/academics/assignments/${b.dataset.sSubmit}/submissions`, { studentId: portalCache.data.student.id });
      toast('Handed in.');
      invalidatePortalCache(); await loadPortalData();
    } catch(e){ toast('Could not hand this in.', true); }
  }));

  const reg = $('#t-register');
  if(reg) reg.addEventListener('click',()=>openRealRegisterMark(portalCache.data.classId, portalCache.data.register, portalCache.data.roster));

  document.querySelectorAll('[data-t-mark]').forEach(b=>b.addEventListener('click',()=>{
    const a = portalCache.data.assignments.find(x=>x.id===b.dataset.tMark);
    if(a) openRealSubmissions(a, portalCache.data.submissions, portalCache.data.roster);
  }));

  document.querySelectorAll('[data-t-remark]').forEach(b=>b.addEventListener('click',()=>
    openRealRemarkForm(b.dataset.tRemark, b.dataset.tRemarkLabel)));
};

/* ------------------------------------------------------- real portal modals -- */

async function openRealReportCard(studentId){
  let term, rc;
  try{
    term = await apiGet('/api/settings/current-term');
    rc = await apiGet(`/api/examinations/report-card?studentId=${studentId}&termId=${term.id}`);
  } catch(e){ toast('Could not load the report card.', true); return; }

  const bySubject = new Map();
  for(const s of rc.scores){
    const cur = bySubject.get(s.subjectId) || { name: s.subject?.name || '—', total:0 };
    cur.total += s.value; bySubject.set(s.subjectId, cur);
  }
  const rows = [...bySubject.values()];
  const avg = rows.length ? rows.reduce((t,r)=>t+r.total,0)/rows.length : 0;

  modal({
    title:'Report card',
    sub:`${esc(rc.student.firstName)} ${esc(rc.student.lastName)} · ${rc.class?esc(rc.class.level+' '+rc.class.arm):'—'} · ${esc(rc.term.name)}`,
    wide:true,
    body:`<div class="rc">
      <div class="tw" style="border:0"><table>
        <thead><tr><th>Subject</th><th class="num">Total</th><th>Grade</th></tr></thead>
        <tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td class="num" style="font-weight:600">${r.total}</td>
          <td><span class="pill ${r.total>=50?'p-ok':r.total>=40?'p-warn':'p-bad'}">${gradeOf(r.total).g}</span></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="fgrid" style="margin-top:16px">
        <dl class="kv">
          <dt>Average</dt><dd>${avg.toFixed(1)}% · ${gradeOf(avg).g}</dd>
          <dt>Position in class</dt><dd>${rc.classPosition?ordinal(rc.classPosition)+' of '+rc.classSize:'—'}</dd>
          <dt>Attendance</dt><dd>${rc.attendanceRate===null?'Not yet recorded':rc.attendanceRate+'%'}</dd>
          <dt>Fee balance</dt><dd>${rc.feeBalanceKobo===null?'—':naira(Number(rc.feeBalanceKobo))}</dd>
        </dl>
      </div>
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--rule);font-size:12px">
        ${rc.remarks.length?rc.remarks.map(r=>`<div style="margin-bottom:8px"><b>${esc(r.staff.position)} (${esc(r.staff.firstName)} ${esc(r.staff.lastName)}):</b> ${esc(r.body)}</div>`).join('')
          :'<i style="color:var(--muted)">No remark on file yet for this term.</i>'}
      </div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="print-rc">Print</button>`,
    wire(){ $('#print-rc').addEventListener('click',()=>window.print()); },
  });
}

function openRealPayment(studentId, balanceKobo){
  modal({
    title:'Record a payment',
    sub:'Records a payment already made (e.g. a bank transfer) — there is no live payment gateway configured, so this is not a card charge.',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Amount (₦)</label><input type="number" id="pay-amount" value="${(Math.max(balanceKobo,0)/100).toFixed(2)}" min="0" step="0.01"><div class="err" id="e-payamount"></div></div>
      <div class="f"><label class="req">Method</label><select id="pay-method">
        <option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option>
        <option value="PAYSTACK">Paystack</option><option value="FLUTTERWAVE">Flutterwave</option></select></div>
      <div class="f wide"><label>Reference (optional)</label><input type="text" id="pay-ref" placeholder="e.g. bank teller number"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="pay-save">Record payment</button>`,
    wire(){
      $('#pay-save').addEventListener('click', async ()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const amountNaira = Number($('#pay-amount').value);
        if(!amountNaira || amountNaira<=0){ $('#e-payamount').textContent='Enter an amount.'; return; }
        try{
          await apiPost('/api/finance/payments', {
            studentId, amountKobo: Math.round(amountNaira*100), method: $('#pay-method').value,
            gatewayRef: $('#pay-ref').value.trim() || undefined, paidOn: new Date().toISOString(),
          });
          toast('Payment recorded.');
          closeModal(); invalidatePortalCache(); await loadPortalData();
        } catch(e){ toast('Could not record the payment.', true); }
      });
    },
  });
}

async function openRealThreadView(threadId){
  let thread;
  try{ thread = await apiGet(`/api/communication/threads/${threadId}`); }
  catch(e){ toast('Could not open this conversation.', true); return; }
  apiPatch(`/api/communication/threads/${threadId}/read`, {}).catch(()=>{});

  modal({
    title: thread.subject,
    sub: thread.student?`${esc(thread.student.firstName)} ${esc(thread.student.lastName)}`:undefined,
    wide:true,
    body:`<div style="display:flex;flex-direction:column;gap:12px;max-height:340px;overflow-y:auto">
      ${thread.messages.map(m=>`<div style="background:var(--tint);border-radius:9px;padding:10px 12px">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:11.5px;color:var(--muted)">
          <b style="color:var(--ink)">${esc(m.sender?.displayName||'—')}</b><span>${fmtDateTime(m.createdAt)}</span></div>
        <div style="font-size:12.5px;margin-top:4px">${esc(m.body)}</div>
      </div>`).join('')}
    </div>
    <div class="fgrid" style="margin-top:14px"><div class="f wide"><label>Reply</label><textarea id="th-reply" rows="3"></textarea></div></div>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="th-reply-save">Reply</button>`,
    wire(){
      $('#th-reply-save').addEventListener('click', async ()=>{
        const body = $('#th-reply').value.trim();
        if(!body){ toast('Write a reply first.', true); return; }
        try{
          await apiPost(`/api/communication/threads/${threadId}/messages`, {body});
          toast('Reply sent.');
          closeModal(); invalidatePortalCache(); await loadPortalData();
        } catch(e){ toast('Could not send the reply.', true); }
      });
    },
  });
}

/** Shared by the Teacher Portal's "Take the register" button and the
    standalone Attendance module's Student register tab — same modal either
    way, just invalidates+reloads whichever page opened it afterward. */
function openRealRegisterMark(classId, register, roster){
  const existing = new Map((register?.records||[]).map(r=>[r.studentId, r.mark]));
  modal({
    title:'Take the register', sub: register?fmtDate(register.date):fmtDate(new Date()), wide:true,
    body:`<div class="tw"><table><thead><tr><th>Student</th><th>Mark</th></tr></thead>
      <tbody>${roster.map(s=>`<tr><td>${esc(s.firstName)} ${esc(s.lastName)}</td>
        <td><select class="pick" data-mark-for="${s.id}">
          ${['PRESENT','ABSENT','LATE'].map(m=>`<option value="${m}" ${(existing.get(s.id)||'PRESENT')===m?'selected':''}>${m}</option>`).join('')}
        </select></td></tr>`).join('')}</tbody></table></div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="reg-save">Save register</button>`,
    wire(){
      $('#reg-save').addEventListener('click', async ()=>{
        const records = roster.map(s=>({studentId:s.id, mark: document.querySelector(`[data-mark-for="${s.id}"]`).value}));
        try{
          let reg = register;
          if(!reg) reg = await apiPost('/api/attendance/registers', { classId, date: new Date().toISOString().slice(0,10) });
          await apiPost(`/api/attendance/registers/${reg.id}/mark`, { records });
          toast('Register saved.');
          closeModal();
          invalidatePortalCache(); invalidateAttendanceCache();
          if(state.route==='portal') await loadPortalData(); else render();
        } catch(e){ toast('Could not save the register.', true); }
      });
    },
  });
}

function openRealSubmissions(assignment, allSubmissions, roster){
  const subs = allSubmissions.filter(s=>s.assignmentId===assignment.id);
  modal({
    title: assignment.title, sub:`${subs.length} submission${subs.length===1?'':'s'}`, wide:true,
    body:`<div class="tw"><table><thead><tr><th>Student</th><th>Submitted</th><th class="num">Grade</th><th></th></tr></thead>
      <tbody>${roster.map(s=>{
        const sub = subs.find(x=>x.studentId===s.id);
        return `<tr>
          <td>${esc(s.firstName)} ${esc(s.lastName)}</td>
          <td>${sub?fmtDateTime(sub.submittedAt):'<span class="pill p-mute">NOT IN</span>'}</td>
          <td class="num">${sub&&sub.grade!==null&&sub.grade!==undefined?sub.grade:'—'}</td>
          <td>${sub?`<input type="number" class="pick" style="width:70px" data-grade-for="${sub.id}" placeholder="grade">
            <button class="btn btn-p btn-s" data-grade-save="${sub.id}">Save</button>`:''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`,
    foot:`<button class="btn btn-q" data-close>Close</button>`,
    wire(){
      document.querySelectorAll('[data-grade-save]').forEach(b=>b.addEventListener('click', async ()=>{
        const id = b.dataset.gradeSave;
        const input = document.querySelector(`[data-grade-for="${id}"]`);
        const grade = Number(input.value);
        if(!input.value || Number.isNaN(grade)){ toast('Enter a grade first.', true); return; }
        try{
          await apiPatch(`/api/academics/submissions/${id}/grade`, {grade});
          toast('Grade saved.');
          invalidatePortalCache(); invalidateReportsCache(); closeModal(); await loadPortalData();
        } catch(e){ toast('Could not save the grade.', true); }
      }));
    },
  });
}

async function openRealRemarkForm(studentId, label){
  let term, existing = null;
  try{
    term = await apiGet('/api/settings/current-term');
    const r = await apiGet(`/api/academics/remarks?studentId=${studentId}&termId=${term.id}`);
    existing = (r.data||[])[0] || null;
  } catch(e){ toast('Could not load the current term.', true); return; }

  modal({
    title:'Write a comment', sub: label,
    body:`<div class="fgrid"><div class="f wide"><label class="req">Comment</label>
      <textarea id="rk-body" rows="4" placeholder="End-of-term remark...">${existing?esc(existing.body):''}</textarea></div></div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="rk-save">Save</button>`,
    wire(){
      $('#rk-save').addEventListener('click', async ()=>{
        const body = $('#rk-body').value.trim();
        if(!body){ toast('Write something first.', true); return; }
        try{
          await apiPut('/api/academics/remarks', {studentId, termId: term.id, body});
          toast('Comment saved.');
          closeModal();
        } catch(e){ toast('Could not save the comment.', true); }
      });
    },
  });
}

// --------------------------------------------------------------- academics --

PAGES.academics = () => {
  const tabs = [['lessons','Lesson plans'],['assignments','Assignments'],['cbt','Computer-based tests']];
  if(!tabs.some(t=>t[0]===state.acTab)) state.acTab='lessons';
  const r = ROLES[state.role];
  const classId = r.scope==='CLASS' ? r.classId : state.acClass;

  return `
  <div class="phead">
    <div><h1>Academics</h1><p>Lesson planning, homework and online testing. Everything here is keyed to a class and a subject, so a teacher only ever sees their own work.</p></div>
  </div>
  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-actab="${id}" aria-selected="${state.acTab===id}">${l}</button>`).join('')}</div>
  ${({lessons:acLessons, assignments:acAssignments, cbt:acCbt})[state.acTab](classId)}`;
};

function acLessons(classId){
  const r = ROLES[state.role];
  let list = db.lessonPlans;
  if(r.scope==='CLASS') list = list.filter(l=>l.classId===r.classId);
  else if(classId) list = list.filter(l=>l.classId===classId);

  const pending = list.filter(l=>l.status==='SUBMITTED').length;

  return `
  <div class="toolbar">
    ${r.scope==='CLASS'?`<span class="pill p-info">${className(CLASSES.find(c=>c.id===r.classId))} — your class</span>`:
      `<select class="pick" id="ac-class"><option value="">All classes</option>
        ${CLASSES.map(c=>`<option value="${c.id}" ${c.id===classId?'selected':''}>${className(c)}</option>`).join('')}</select>`}
    <span class="spacer"></span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${list.length} plan${list.length===1?'':'s'}${pending?` · ${pending} awaiting review`:''}</span>
  </div>

  ${list.length===0?'<div class="tw"><div class="empty"><b>No lesson plans</b>Choose another class, or ask the subject teacher to submit one.</div></div>':`
  <div class="tw"><table>
    <thead><tr><th class="num">Wk</th><th>Class</th><th>Subject</th><th>Topic</th><th>Teacher</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.slice(0,60).map(l=>{
      const sub = SUBJECTS.find(x=>x.id===l.subjectId);
      const t = db.staff.find(x=>x.id===l.staffId);
      return `<tr>
        <td class="num">${l.week}</td>
        <td>${className(CLASSES.find(c=>c.id===l.classId))}</td>
        <td>${esc(sub?sub.name:'—')}</td>
        <td style="font-weight:500">${esc(l.topic)}</td>
        <td style="font-size:12.5px">${t?esc(t.firstName[0]+'. '+t.lastName):'—'}</td>
        <td><span class="pill ${l.status==='APPROVED'?'p-ok':l.status==='SUBMITTED'?'p-warn':'p-mute'}">${l.status}</span></td>
        <td>${l.status==='SUBMITTED'&&can('academics.approve')?
          `<button class="btn btn-p btn-s" data-lp="${l.id}">Approve</button>`:''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`}

  <p class="note">A plan moves draft → submitted → approved. The coordinator reviews before the week starts, which is the only point at which reviewing it is any use.</p>`;
}

function acAssignments(classId){
  const r = ROLES[state.role];
  let list = db.assignments;
  if(r.scope==='CLASS') list = list.filter(a=>a.classId===r.classId);
  else if(classId) list = list.filter(a=>a.classId===classId);

  return `
  <div class="toolbar">
    ${r.scope==='CLASS'?`<span class="pill p-info">${className(CLASSES.find(c=>c.id===r.classId))} — your class</span>`:
      `<select class="pick" id="ac-class2"><option value="">All classes</option>
        ${CLASSES.map(c=>`<option value="${c.id}" ${c.id===classId?'selected':''}>${className(c)}</option>`).join('')}</select>`}
    <span class="spacer"></span>
    ${can('academics.create')?'<button class="btn btn-y" id="new-assignment">Set an assignment</button>':''}
  </div>

  ${list.length===0?'<div class="tw"><div class="empty"><b>No assignments set</b>Nothing has been given to this class yet.</div></div>':
  list.map(a=>{
    const st = assignmentStats(a);
    const sub = SUBJECTS.find(x=>x.id===a.subjectId);
    const overdueNow = a.dueAt < todayISO();
    return `<div class="block">
      <h2>${esc(a.title)} <small>${esc(sub?sub.name:'')} · ${className(CLASSES.find(c=>c.id===a.classId))}</small></h2>
      <p class="sub">${esc(a.instructions)}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:9px;margin-bottom:12px">
        <div class="tile" style="padding:11px 8px"><div style="font-size:19px;font-weight:700">${st.submitted}</div><div class="lb">Submitted</div></div>
        <div class="tile" style="padding:11px 8px"><div style="font-size:19px;font-weight:700;color:${st.missing?'var(--clay)':'inherit'}">${st.missing}</div><div class="lb">Not handed in</div></div>
        <div class="tile" style="padding:11px 8px"><div style="font-size:19px;font-weight:700;color:${st.unmarked?'var(--amber)':'inherit'}">${st.unmarked}</div><div class="lb">Awaiting marking</div></div>
        <div class="tile" style="padding:11px 8px"><div style="font-size:19px;font-weight:700">${st.avg===null?'—':st.avg.toFixed(1)}</div><div class="lb">Average / ${a.maxScore}</div></div>
        <div class="tile" style="padding:11px 8px"><div style="font-size:19px;font-weight:700">${st.late}</div><div class="lb">Handed in late</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="pill ${overdueNow?'p-bad':'p-info'}">DUE ${fmtDate(a.dueAt)}</span>
        <span class="spacer"></span>
        <button class="btn btn-q btn-s" data-marklist="${a.id}">Open submissions</button>
      </div>
    </div>`;
  }).join('')}`;
}

function acCbt(){
  return `
  <div class="toolbar">
    <span class="spacer"></span>
    ${can('academics.create')?'<button class="btn btn-y" id="new-cbt">Create a test</button>':''}
  </div>

  ${db.cbtExams.map(e=>{
    const qs = db.cbtQuestions.filter(q=>q.examId===e.id).length;
    const st = examStats(e.id);
    const sub = e.subjectId ? SUBJECTS.find(x=>x.id===e.subjectId) : null;
    return `<div class="block">
      <h2>${esc(e.title)} <small>${e.forApplicants?'Entrance — applicants':`${sub?sub.name:''} · ${className(CLASSES.find(c=>c.id===e.classId))}`}</small></h2>
      <div class="fgrid" style="margin-bottom:12px">
        <dl class="kv">
          <dt>Duration</dt><dd>${e.durationMins} minutes</dd>
          <dt>Questions served</dt><dd>${e.questionCount} drawn from ${qs}</dd>
          <dt>Randomised</dt><dd>${e.shuffle?'Yes — frozen at start':'No'}</dd>
        </dl>
        <dl class="kv">
          <dt>Opens</dt><dd>${esc(e.opensAt.replace('T',' at '))}</dd>
          <dt>Attempts</dt><dd>${st.taken}</dd>
          <dt>Average</dt><dd>${st.taken?st.avg.toFixed(1)+'% · '+st.passRate.toFixed(0)+'% at or above 50':'None yet'}</dd>
        </dl>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-p btn-s" data-sit="${e.id}">Sit this test</button>
        <button class="btn btn-q btn-s" data-questions="${e.id}">View question bank</button>
        ${st.taken?`<button class="btn btn-q btn-s" data-results="${e.id}">Results</button>`:''}
      </div>
    </div>`;
  }).join('')}

  <p class="note"><b>Two rules make an online test defensible.</b> The question set is chosen and frozen the moment an attempt starts, so nobody can reload until they get an easier paper. And the deadline is an absolute timestamp stored at start, not a countdown held in the browser — closing the laptop and changing the system clock finds the same expiry waiting.</p>`;
}

PAGES.academics_wire = () => {
  document.querySelectorAll('[data-actab]').forEach(b=>b.addEventListener('click',()=>{state.acTab=b.dataset.actab;render();}));
  ['#ac-class','#ac-class2'].forEach(sel=>{
    const n=$(sel); if(n) n.addEventListener('change',e=>{state.acClass=e.target.value;render();});
  });

  document.querySelectorAll('[data-lp]').forEach(b=>b.addEventListener('click',()=>{
    const lp = db.lessonPlans.find(x=>x.id===b.dataset.lp);
    lp.status='APPROVED'; persist();
    toast(`Week ${lp.week} plan approved: ${esc(lp.topic)}.`);
    render();
  }));

  document.querySelectorAll('[data-marklist]').forEach(b=>b.addEventListener('click',()=>openSubmissions(b.dataset.marklist)));
  document.querySelectorAll('[data-sit]').forEach(b=>b.addEventListener('click',()=>openSitPicker(b.dataset.sit)));
  document.querySelectorAll('[data-questions]').forEach(b=>b.addEventListener('click',()=>openQuestionBank(b.dataset.questions)));
  document.querySelectorAll('[data-results]').forEach(b=>b.addEventListener('click',()=>openExamResults(b.dataset.results)));

  const na = $('#new-assignment');
  if(na) na.addEventListener('click',()=>toast('Assignment creation uses the same form as the seeded set — the marking screen is the interesting part.'));
  const nc = $('#new-cbt');
  if(nc) nc.addEventListener('click',()=>toast('New tests draw from the question bank. Open one to see how it is served.'));
};

function openSubmissions(assignmentId){
  const a = db.assignments.find(x=>x.id===assignmentId);
  const roll = db.students.filter(s=>s.classId===a.classId && s.status==='ACTIVE');

  modal({
    title:'Submissions', sub:`${a.title} · ${className(CLASSES.find(c=>c.id===a.classId))} · out of ${a.maxScore}`, wide:true,
    body:`<div class="tw"><table>
      <thead><tr><th>Student</th><th>Handed in</th><th style="width:110px">Score</th><th>Feedback</th></tr></thead>
      <tbody>${roll.map(s=>{
        const sub = db.submissions.find(x=>x.assignmentId===assignmentId && x.studentId===s.id);
        return `<tr>
          <td><div class="who-cell">${avatar(s)}
            <div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div></div></div></td>
          <td>${!sub?'<span class="pill p-bad">NOT HANDED IN</span>':
                sub.late?'<span class="pill p-warn">LATE</span>':'<span class="pill p-ok">ON TIME</span>'}</td>
          <td>${sub?`<input type="number" min="0" max="${a.maxScore}" value="${sub.score??''}"
                 data-mark-sub="${sub.id}" data-max="${a.maxScore}" style="padding:5px;text-align:center;font-family:var(--mono)">`:'—'}</td>
          <td style="font-size:12px;color:var(--muted)">${sub?esc(sub.feedback||'Not yet marked'):''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <p class="note">A missing submission is shown, not hidden. The teacher needs the gap more than the list of who did the work.</p>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="save-marks">Save marks</button>`,
    wire(){
      $('#save-marks').addEventListener('click',()=>{
        let bad = 0, saved = 0;
        document.querySelectorAll('[data-mark-sub]').forEach(inp=>{
          const max = +inp.dataset.max;
          if(inp.value === '') return;
          const v = Number(inp.value);
          if(Number.isNaN(v) || v < 0 || v > max){ inp.style.borderColor='var(--clay)'; bad++; return; }
          inp.style.borderColor='';
          const sub = db.submissions.find(x=>x.id===inp.dataset.markSub);
          if(sub){ sub.score = v; sub.feedback = v>=max*0.8?'Well done.':v>=max*0.6?'Fair attempt — check your working.':'See me after class.'; saved++; }
        });
        if(bad){ toast(`${bad} mark${bad===1?' is':'s are'} outside 0–${a.maxScore}.`, true); return; }
        persist(); closeModal();
        toast(`${saved} mark${saved===1?'':'s'} saved for ${esc(a.title)}.`);
        render();
      });
    },
  });
}

function openQuestionBank(examId){
  const e = db.cbtExams.find(x=>x.id===examId);
  const qs = db.cbtQuestions.filter(q=>q.examId===examId);
  const sections = [...new Set(qs.map(q=>q.section))];

  modal({
    title:'Question bank', sub:`${e.title} · ${qs.length} questions · ${e.questionCount} served per candidate`, wide:true,
    body:`${sections.map(sec=>{
      const inSec = qs.filter(q=>q.section===sec);
      return `<h3 style="font-size:13px;margin:16px 0 8px">${esc(sec)} <span style="color:var(--muted);font-weight:400">— ${inSec.length} questions</span></h3>
      ${inSec.map((q,i)=>`<div style="border:1px solid var(--rule);border-radius:9px;padding:12px 14px;margin-bottom:8px">
        <div style="font-weight:500;font-size:13px;margin-bottom:8px">${i+1}. ${esc(q.stem)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px">
          ${q.options.map((o,oi)=>`<div style="font-size:12px;padding:5px 9px;border-radius:6px;
            background:${oi===q.answer?'var(--moss-soft)':'#F8FAFD'};
            color:${oi===q.answer?'var(--moss)':'var(--ink)'};font-weight:${oi===q.answer?'600':'400'}">
            ${String.fromCharCode(65+oi)}. ${esc(o)}</div>`).join('')}
        </div>
      </div>`).join('')}`;
    }).join('')}
    <p class="note">The correct answer is stored as the option's index, not its text. An option can be reworded without silently invalidating every attempt already marked against it.</p>`,
    foot:`<button class="btn btn-q" data-close>Close</button>`,
  });
}

function openSitPicker(examId){
  const e = db.cbtExams.find(x=>x.id===examId);
  const candidates = e.forApplicants
    ? db.applications.filter(a=>['SHORTLISTED','EXAM_SCHEDULED','EXAM_TAKEN'].includes(a.stage)).slice(0,12)
    : db.students.filter(s=>s.classId===e.classId && s.status==='ACTIVE').slice(0,12);

  modal({
    title:'Sit the test', sub:`${e.title} · ${e.durationMins} minutes · ${e.questionCount} questions`,
    body:`<p style="font-size:13px;color:var(--muted);margin:0 0 14px">
      Choose whose attempt this is. The timer starts the moment you begin and cannot be paused.</p>
      <div style="display:grid;gap:6px;max-height:340px;overflow-y:auto">
        ${candidates.map(c=>`<button class="roster-btn" data-cand="${c.id}" style="display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:10px 13px;background:var(--paper);border:1px solid var(--rule);border-radius:9px">
          ${avatar(c)}
          <div><div style="font-weight:600;font-size:13px">${esc(c.firstName)} ${esc(c.lastName)}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted)">${esc(c.admissionNo||c.ref||'')}</div></div>
        </button>`).join('')}
      </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button>`,
    wire(){
      document.querySelectorAll('[data-cand]').forEach(b=>b.addEventListener('click',()=>{
        closeModal();
        const att = startAttempt(examId, b.dataset.cand, e.forApplicants?'APPLICANT':'STUDENT');
        openSitting(att.id);
      }));
    },
  });
}

let cbtTimer = null;

function openSitting(attemptId){
  const att = db.cbtAttempts.find(a=>a.id===attemptId);
  const e = db.cbtExams.find(x=>x.id===att.examId);

  const render_ = () => {
    const qs = att.servedQuestionIds.map(id=>db.cbtQuestions.find(q=>q.id===id));
    const answered = Object.keys(att.answers).length;

    modal({
      title:e.title, sub:`${e.questionCount} questions · answer every one, an unanswered question scores nothing`, wide:true,
      body:`
      <div style="position:sticky;top:0;background:var(--paper);z-index:3;padding-bottom:12px;margin-bottom:6px;border-bottom:1px solid var(--rule);
                  display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div style="background:var(--navy);color:#fff;border-radius:9px;padding:9px 16px">
          <div style="font-family:var(--mono);font-size:8.5px;letter-spacing:.16em;opacity:.65">TIME REMAINING</div>
          <div id="cbt-clock" style="font-family:var(--mono);font-size:22px;font-weight:700;letter-spacing:.04em">--:--</div>
        </div>
        <div><div style="font-size:12px;color:var(--muted)">Answered</div>
          <div id="cbt-count" style="font-weight:700;font-size:18px">${answered} / ${qs.length}</div></div>
        <span class="spacer"></span>
        <button class="btn btn-y" id="cbt-submit">Submit answers</button>
      </div>

      ${qs.map((q,i)=>`<div style="border:1px solid var(--rule);border-radius:11px;padding:14px 16px;margin-bottom:9px" data-q="${q.id}">
        <div style="font-weight:500;font-size:13.5px;margin-bottom:10px">
          <span style="font-family:var(--mono);color:var(--muted);font-size:11px">${String(i+1).padStart(2,'0')}</span>
          &nbsp;${esc(q.stem)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:7px">
          ${q.options.map((o,oi)=>`<button data-ans="${q.id}" data-oi="${oi}"
            style="text-align:left;font-size:12.5px;padding:9px 12px;border-radius:8px;cursor:pointer;
                   border:1.5px solid ${att.answers[q.id]===oi?'var(--navy)':'var(--rule)'};
                   background:${att.answers[q.id]===oi?'var(--lilac)':'var(--paper)'};
                   font-weight:${att.answers[q.id]===oi?'600':'400'}">
            <b style="font-family:var(--mono);margin-right:6px">${String.fromCharCode(65+oi)}</b>${esc(o)}</button>`).join('')}
        </div>
      </div>`).join('')}`,
      foot:'',
      wire(){
        document.querySelectorAll('[data-ans]').forEach(b=>b.addEventListener('click',()=>{
          att.answers[b.dataset.ans] = +b.dataset.oi;
          const group = b.parentElement;
          group.querySelectorAll('[data-ans]').forEach(x=>{
            const on = +x.dataset.oi === att.answers[b.dataset.ans];
            x.style.borderColor = on ? 'var(--navy)' : 'var(--rule)';
            x.style.background  = on ? 'var(--lilac)' : 'var(--paper)';
            x.style.fontWeight  = on ? '600' : '400';
          });
          $('#cbt-count').textContent = `${Object.keys(att.answers).length} / ${qs.length}`;
        }));

        $('#cbt-submit').addEventListener('click',()=>finish('SUBMITTED'));

        clearInterval(cbtTimer);
        const tick = () => {
          const ms = attemptRemaining(att);
          const clock = $('#cbt-clock');
          if(!clock){ clearInterval(cbtTimer); return; }
          const m = Math.floor(ms/60000), sec = Math.floor(ms%60000/1000);
          clock.textContent = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
          // Last two minutes turn red. Not decoration — it changes behaviour.
          clock.parentElement.style.background = ms < 120000 ? 'var(--clay)' : 'var(--navy)';
          if(ms === 0){ clearInterval(cbtTimer); finish('TIME_EXPIRED'); }
        };
        tick();
        cbtTimer = setInterval(tick, 1000);
      },
    });
  };

  const finish = reason => {
    clearInterval(cbtTimer);
    markAttempt(att, reason);

    // An applicant's entrance score flows straight onto the application, so
    // nobody re-keys a mark from a printout.
    if(att.candidateKind==='APPLICANT'){
      const app = db.applications.find(a=>a.id===att.candidateId);
      if(app){ app.examScore = att.percent; if(app.stage!=='OFFERED') app.stage='EXAM_TAKEN'; }
    }
    persist();
    closeModal();
    openAttemptResult(att.id, reason);
  };

  render_();
}

function openAttemptResult(attemptId, reason){
  const att = db.cbtAttempts.find(a=>a.id===attemptId);
  const e = db.cbtExams.find(x=>x.id===att.examId);
  const who = att.candidateKind==='APPLICANT'
    ? db.applications.find(a=>a.id===att.candidateId)
    : db.students.find(s=>s.id===att.candidateId);
  const unanswered = att.detail.filter(d=>d.given===undefined).length;

  modal({
    title:'Result', sub:`${who?who.firstName+' '+who.lastName:''} · ${e.title}`, wide:true,
    body:`
    ${reason==='TIME_EXPIRED'?`<div class="alert" style="background:var(--clay-soft);border-left:3px solid var(--clay);padding:12px 14px;border-radius:6px;margin-bottom:16px;font-size:13px;color:#7A2420">
      <b>Time ran out.</b> The paper was submitted automatically with whatever had been answered. This is recorded on the attempt, so a disputed result can be checked.</div>`:''}

    <div class="grid-stats" style="margin-bottom:18px">
      <div class="stat">${svg('scores',40)}<div><div class="v">${att.score} / ${att.total}</div><div class="l">Score</div></div></div>
      <div class="stat">${svg('sPending',40)}<div><div class="v">${att.percent}%</div><div class="l">Percentage</div></div></div>
      <div class="stat">${svg('attendance',40)}<div><div class="v">${gradeOf(att.percent).g}</div><div class="l">Grade</div></div></div>
      <div class="stat">${svg('notice',40)}<div><div class="v">${unanswered}</div><div class="l">Left unanswered</div></div></div>
    </div>

    ${att.candidateKind==='APPLICANT'?`<p class="note" style="margin-top:0;margin-bottom:16px"><b>Written back to application ${esc(who?who.ref:'')}.</b>
      The score is now on the admissions record — nobody re-keys a mark from a printout, which is where transcription errors come from.</p>`:''}

    <h3 style="font-size:13px;margin-bottom:10px">Answer paper</h3>
    ${att.detail.map((d,i)=>`<div style="border:1px solid ${d.right?'#C9E3D6':'#EBCECC'};border-radius:9px;padding:11px 14px;margin-bottom:7px;
        background:${d.right?'var(--moss-soft)':'var(--clay-soft)'}">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span class="pill ${d.right?'p-ok':'p-bad'}" style="margin-top:2px">${d.right?'✓':'✗'}</span>
        <div style="min-width:0;flex:1">
          <div style="font-weight:500;font-size:13px">${i+1}. ${esc(d.q.stem)}</div>
          <div style="font-size:12px;margin-top:5px">
            ${d.given===undefined?'<span style="color:var(--clay)">Not answered</span>':
              `Chose <b>${String.fromCharCode(65+d.given)}. ${esc(d.q.options[d.given])}</b>`}
            ${d.right?'':` · correct answer <b>${String.fromCharCode(65+d.q.answer)}. ${esc(d.q.options[d.q.answer])}</b>`}
          </div>
        </div>
      </div>
    </div>`).join('')}`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="print-att">Print</button>`,
    wire(){ $('#print-att').addEventListener('click',()=>window.print()); },
  });
}

function openExamResults(examId){
  const e = db.cbtExams.find(x=>x.id===examId);
  const done = db.cbtAttempts.filter(a=>a.examId===examId && a.submittedAt)
    .sort((a,b)=>b.percent-a.percent);
  const st = examStats(examId);

  modal({
    title:'Results', sub:`${e.title} · ${done.length} attempt${done.length===1?'':'s'}`, wide:true,
    body:`<div class="grid-stats" style="margin-bottom:16px">
      <div class="stat">${svg('sStudents',40)}<div><div class="v">${st.taken}</div><div class="l">Sat the paper</div></div></div>
      <div class="stat">${svg('scores',40)}<div><div class="v">${st.avg.toFixed(1)}%</div><div class="l">Average</div></div></div>
      <div class="stat">${svg('sPending',40)}<div><div class="v">${st.passRate.toFixed(0)}%</div><div class="l">At or above 50</div></div></div>
      <div class="stat">${svg('attendance',40)}<div><div class="v">${done.filter(a=>a.reason==='TIME_EXPIRED').length}</div><div class="l">Ran out of time</div></div></div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>Candidate</th><th class="num">Score</th><th class="num">%</th><th>Grade</th><th>Finished</th></tr></thead>
      <tbody>${done.map(a=>{
        const who = a.candidateKind==='APPLICANT'
          ? db.applications.find(x=>x.id===a.candidateId) : db.students.find(x=>x.id===a.candidateId);
        return `<tr>
          <td>${who?esc(who.firstName+' '+who.lastName):'—'}</td>
          <td class="num">${a.score} / ${a.total}</td>
          <td class="num" style="font-weight:600">${a.percent}%</td>
          <td><span class="pill ${a.percent>=50?'p-ok':'p-bad'}">${gradeOf(a.percent).g}</span></td>
          <td>${a.reason==='TIME_EXPIRED'?'<span class="pill p-warn">TIME EXPIRED</span>':'<span class="pill p-mute">SUBMITTED</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`,
    foot:`<button class="btn btn-q" data-close>Close</button>`,
  });
}

// --------------------------------------------------------------- timetable --

PAGES.timetable = () => {
  const r = ROLES[state.role];
  const classId = r.scope==='CLASS' ? r.classId : state.ttClass;
  const c = CLASSES.find(x=>x.id===classId);

  return `
  <div class="phead">
    <div><h1>Timetable</h1><p>Slots are written only when the teacher is free, so a clash cannot be saved and then reported afterwards. Free periods show as gaps.</p></div>
    <button class="btn btn-q" id="print-tt">Print</button>
  </div>

  <div class="toolbar">
    ${r.scope==='CLASS'?`<span class="pill p-info">${className(c)} — your class</span>`:
      `<select class="pick" id="tt-class">${CLASSES.map(x=>`<option value="${x.id}" ${x.id===classId?'selected':''}>${className(x)}</option>`).join('')}</select>`}
    <span class="spacer"></span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${subjectsFor(c).length} subjects offered</span>
  </div>

  <div class="tw"><table>
    <thead><tr><th style="width:88px">Period</th>${DAYS.map(d=>`<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${PERIODS.map(per=>{
      if(per.isBreak) return `<tr style="background:var(--blue-tint)"><td style="font-family:var(--mono);font-size:11px">${per.from}</td>
        <td colspan="5" style="text-align:center;font-weight:600;font-size:12px;color:var(--amber)">BREAK</td></tr>`;
      return `<tr>
        <td><div style="font-weight:600;font-size:12px">${per.label}</div>
          <div style="font-family:var(--mono);font-size:9.5px;color:var(--muted)">${per.from}–${per.to}</div></td>
        ${DAYS.map(d=>{
          const slot = db.timetable[`${classId}:${d}:${per.id}`];
          if(!slot) return '<td style="color:var(--muted);font-size:11.5px">—</td>';
          const sub = SUBJECTS.find(x=>x.id===slot.subjectId);
          const t = db.staff.find(x=>x.id===slot.staffId);
          return `<td><div style="font-weight:500;font-size:12px">${esc(sub?sub.name:'—')}</div>
            <div style="font-size:10.5px;color:var(--muted)">${t?esc(t.lastName):''} · ${esc(slot.room)}</div></td>`;
        }).join('')}
      </tr>`;
    }).join('')}</tbody>
  </table></div>

  <p class="note">The database carries an exclusion constraint on <code>(staff, day, period)</code>. Two people publishing timetables at the same moment cannot double-book a teacher, because the second write is rejected by the database rather than by a check the application might skip.</p>`;
};

PAGES.timetable_wire = () => {
  const sel = $('#tt-class'); if(sel) sel.addEventListener('change',e=>{state.ttClass=e.target.value;render();});
  const pr = $('#print-tt'); if(pr) pr.addEventListener('click',()=>window.print());
};

// ----------------------------------------------------------------- payroll --

PAGES.payroll = () => {
  const totals = payrollTotals();
  const pending = db.leave.filter(l=>l.status==='PENDING');

  return `
  <div class="phead">
    <div><h1>Payroll &amp; HR</h1>
      <p>PAYE under the Nigeria Tax Act 2025, in force since January 2026. The Act abolished the Consolidated Relief Allowance and replaced it with an ₦800,000 tax-free band plus rent relief.</p></div>
    ${can('payroll.create')?'<button class="btn btn-y" id="run-payroll">Prepare August run</button>':''}
  </div>

  <div class="tabs">
    ${[['overview','Payroll'],['leave','Leave requests'],['bands','Tax bands']].map(([id,l])=>
      `<button class="tab" data-ptab="${id}" aria-selected="${state.tab===id||(state.tab==='overview'&&id==='overview')}">${l}</button>`).join('')}
  </div>

  ${state.tab==='leave' ? `
    <div class="tw"><table>
      <thead><tr><th>Staff</th><th>Type</th><th>From</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${db.leave.map(l=>{
        const m = db.staff.find(x=>x.id===l.staffId);
        return `<tr>
          <td><div class="who-cell">${avatar(m)}
            <div><div class="nm">${esc(m.firstName)} ${esc(m.lastName)}</div><div class="sm">${esc(m.position)}</div></div></div></td>
          <td>${esc(l.type)}</td><td>${fmtDate(l.from)}</td><td class="num">${l.days}</td>
          <td style="font-size:12px;color:var(--muted)">${esc(l.reason)}</td>
          <td><span class="pill ${l.status==='APPROVED'?'p-ok':l.status==='DECLINED'?'p-bad':'p-warn'}">${l.status}</span></td>
          <td>${l.status==='PENDING'?`${can('hr.approve')?`<button class="btn btn-p btn-s" data-leave="${l.id}" data-d="APPROVED">Approve</button>`:''}
             ${can('hr.reject')?`<button class="btn btn-d btn-s" data-leave="${l.id}" data-d="DECLINED">Decline</button>`:''}`:''}</td>
        </tr>`;}).join('')}</tbody>
    </table></div>
    ${pending.length?`<p class="note">${pending.length} request${pending.length===1?'':'s'} awaiting a decision. Approving one writes the days against the employee's balance for the year.</p>`:''}`
  : state.tab==='bands' ? `
    <div class="block">
      <h2>PAYE bands <small>Nigeria Tax Act 2025 · from 1 Jan 2026</small></h2>
      <p class="sub">Held as data, not code. A Finance Act change is a settings edit, not a release.</p>
      <div class="tw"><table>
        <thead><tr><th>Band</th><th class="num">Rate</th></tr></thead>
        <tbody>${PAYE_BANDS.map(b=>`<tr><td>${b.label}</td><td class="num">${(b.rate*100).toFixed(0)}%</td></tr>`).join('')}</tbody>
      </table></div>
      <h3 style="font-size:13px;margin:20px 0 8px">Statutory deductions</h3>
      <div class="tw"><table>
        <thead><tr><th>Deduction</th><th>Basis</th><th class="num">Rate</th></tr></thead>
        <tbody>
          <tr><td>Pension — employee</td><td>Basic + Housing + Transport</td><td class="num">8%</td></tr>
          <tr><td>Pension — employer</td><td>Basic + Housing + Transport</td><td class="num">10%</td></tr>
          <tr><td>National Housing Fund</td><td>Basic salary</td><td class="num">2.5%</td></tr>
          <tr><td>Rent relief</td><td>20% of rent paid, capped</td><td class="num">₦500,000</td></tr>
        </tbody>
      </table></div>
      <p class="note"><b>Pensionable pay is Basic + Housing + Transport, not gross.</b> Computing pension on gross is the most common Nigerian payroll error and over-deducts from every member of staff. The Consolidated Relief Allowance no longer exists — any payroll still applying it is under-deducting PAYE, and the shortfall plus penalties fall on the school.</p>
    </div>`
  : `
    <div class="grid-stats">
      <div class="stat">${svg('income',40)}<div><div class="v">${naira(totals.gross)}</div><div class="l">Gross monthly</div></div></div>
      <div class="stat">${svg('expense',40)}<div><div class="v">${naira(totals.paye)}</div><div class="l">PAYE to FCT-IRS</div></div></div>
      <div class="stat">${svg('scholarship',40)}<div><div class="v">${naira(totals.pension+totals.employerPension)}</div><div class="l">Pension remittance</div></div></div>
      <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(totals.net)}</div><div class="l">Net payable</div></div></div>
    </div>

    <div class="tw"><table>
      <thead><tr><th>Staff</th><th>Grade</th><th class="num">Gross</th><th class="num">PAYE</th><th class="num">Pension</th><th class="num">NHF</th><th class="num">Net</th><th></th></tr></thead>
      <tbody>${db.staff.filter(m=>m.status==='ACTIVE').map(m=>{
        const ps = computePayslip(m);
        return `<tr>
          <td><div class="who-cell">${avatar(m)}
            <div><div class="nm">${esc(m.firstName)} ${esc(m.lastName)}</div><div class="sm">${esc(m.staffNo)}</div></div></div></td>
          <td style="font-size:12px">${esc(ps.grade.name)}</td>
          <td class="num">${naira(ps.monthlyGross)}</td>
          <td class="num">${naira(ps.monthlyPaye)}</td>
          <td class="num">${naira(ps.monthlyPen)}</td>
          <td class="num">${naira(ps.monthlyNhf)}</td>
          <td class="num" style="font-weight:600">${naira(ps.net)}</td>
          <td><button class="btn btn-q btn-s" data-slip="${m.id}">Payslip</button></td>
        </tr>`;}).join('')}</tbody>
    </table></div>

    <p class="note">The Bursar prepares this run but cannot approve it — <code>payroll.run.approve</code> is denied at role level, and the permission seeder refuses to start if that ever stops being true. Whoever prepares a payment must not also release it.</p>`}`;
};

PAGES.payroll_wire = () => {
  document.querySelectorAll('[data-ptab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.ptab;render();}));
  document.querySelectorAll('[data-slip]').forEach(b=>b.addEventListener('click',()=>openPayslip(b.dataset.slip)));
  document.querySelectorAll('[data-leave]').forEach(b=>b.addEventListener('click',()=>{
    const l = db.leave.find(x=>x.id===b.dataset.leave);
    l.status = b.dataset.d;
    const m = db.staff.find(x=>x.id===l.staffId);
    logAudit('hr.leave', `${m.firstName} ${m.lastName}'s ${l.type.toLowerCase()} leave ${b.dataset.d.toLowerCase()}`);
    if(`${m.firstName} ${m.lastName}`===ROLES.CLASS_TEACHER.name)
      notify('CLASS_TEACHER', `Leave ${b.dataset.d.toLowerCase()}`, `Your ${l.type.toLowerCase()} leave request was ${b.dataset.d.toLowerCase()}.`);
    persist();
    toast(`${esc(m.firstName)} ${esc(m.lastName)}'s ${l.type.toLowerCase()} leave ${b.dataset.d.toLowerCase()}.`);
    render();
  }));
  const run = $('#run-payroll');
  if(run) run.addEventListener('click',()=>{
    const t = payrollTotals();
    db.payrollRuns.push({id:uid('pr'), month:'2026-08', status:'AWAITING_APPROVAL', ...t});
    logAudit('payroll.run', `August run prepared — ${t.count} staff, ${naira(t.net)} net`);
    notify('PRINCIPAL', 'Payroll run awaiting approval', `August run: ${t.count} staff, ${naira(t.net)} net. Ready for your approval.`);
    persist();
    toast(`August run prepared: ${t.count} staff, ${naira(t.net)} net. Sent to the Principal for approval.`);
  });
};

function openPayslip(id){
  const m = db.staff.find(x=>x.id===id);
  const ps = computePayslip(m);

  modal({
    title:'Payslip', sub:`${m.firstName} ${m.lastName} · ${m.staffNo} · August 2026`, wide:true,
    body:`
    <div class="rc">
      <div class="rc-head">
        <div style="display:flex;gap:12px;align-items:center">
          <span data-crest="48" style="flex:none"></span>
          <div><div class="n">Fadesrek Academy</div>
            <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;margin-top:3px">Payslip · August 2026</div></div></div>
        <div style="text-align:right;font-size:12px">
          <div><b>${esc(m.firstName)} ${esc(m.lastName)}</b></div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(m.staffNo)}</div>
          <div style="margin-top:3px">${esc(ps.grade.name)}</div></div>
      </div>

      <div class="fgrid">
        <div>
          <h3 style="font-size:12.5px;margin-bottom:9px">Earnings, monthly</h3>
          <div class="tw" style="border:0"><table>
            <tbody>
              <tr><td>Basic</td><td class="num">${nairaFull(Math.round(ps.basic/12))}</td></tr>
              <tr><td>Housing</td><td class="num">${nairaFull(Math.round(ps.housing/12))}</td></tr>
              <tr><td>Transport</td><td class="num">${nairaFull(Math.round(ps.transport/12))}</td></tr>
              <tr><td>Other allowances</td><td class="num">${nairaFull(Math.round(ps.other/12))}</td></tr>
              <tr><td style="font-weight:600">Gross</td><td class="num" style="font-weight:600">${nairaFull(ps.monthlyGross)}</td></tr>
            </tbody></table></div>
        </div>
        <div>
          <h3 style="font-size:12.5px;margin-bottom:9px">Deductions, monthly</h3>
          <div class="tw" style="border:0"><table>
            <tbody>
              <tr><td>PAYE</td><td class="num">${nairaFull(ps.monthlyPaye)}</td></tr>
              <tr><td>Pension, 8%</td><td class="num">${nairaFull(ps.monthlyPen)}</td></tr>
              <tr><td>NHF, 2.5% of basic</td><td class="num">${nairaFull(ps.monthlyNhf)}</td></tr>
              <tr><td style="font-weight:600">Total</td><td class="num" style="font-weight:600">${nairaFull(ps.monthlyPaye+ps.monthlyPen+ps.monthlyNhf)}</td></tr>
              <tr><td style="font-weight:600;color:var(--moss)">Net pay</td><td class="num" style="font-weight:700;color:var(--moss)">${nairaFull(ps.net)}</td></tr>
            </tbody></table></div>
        </div>
      </div>

      <h3 style="font-size:12.5px;margin:18px 0 9px">How the PAYE was reached, annually</h3>
      <div class="tw"><table>
        <thead><tr><th>Step</th><th class="num">Amount</th></tr></thead>
        <tbody>
          <tr><td>Gross annual</td><td class="num">${nairaFull(ps.gross)}</td></tr>
          <tr><td>Less pension, 8% of ${nairaFull(ps.pensionable)}</td><td class="num">− ${nairaFull(ps.pensionEmp)}</td></tr>
          <tr><td>Less NHF</td><td class="num">− ${nairaFull(ps.nhf)}</td></tr>
          <tr><td>Less rent relief${m.annualRent?` (20% of ${nairaFull(m.annualRent)}, capped at ₦500,000)`:' — no rent declared'}</td><td class="num">− ${nairaFull(ps.rentRelief)}</td></tr>
          <tr><td style="font-weight:600">Taxable income</td><td class="num" style="font-weight:600">${nairaFull(ps.taxable)}</td></tr>
        </tbody></table></div>

      <div class="tw" style="margin-top:10px"><table>
        <thead><tr><th>Band</th><th class="num">Rate</th><th class="num">Income taxed</th><th class="num">Tax</th></tr></thead>
        <tbody>${ps.bandRows.filter(b=>b.amount>0).map(b=>`<tr>
          <td>${b.label}</td><td class="num">${(b.rate*100).toFixed(0)}%</td>
          <td class="num">${nairaFull(b.amount)}</td><td class="num">${nairaFull(b.tax)}</td></tr>`).join('')}
          <tr><td colspan="3" style="font-weight:600">Annual PAYE</td><td class="num" style="font-weight:600">${nairaFull(ps.annualTax)}</td></tr>
          <tr><td colspan="3">Effective rate on gross</td><td class="num">${ps.effectiveRate.toFixed(2)}%</td></tr>
        </tbody></table></div>

      <div class="fgrid" style="margin-top:16px">
        <dl class="kv">
          <dt>Bank</dt><dd>${esc(m.bank)}</dd>
          <dt>Account</dt><dd style="font-family:var(--mono);font-size:12px">${esc(m.accountNo)}</dd>
        </dl>
        <dl class="kv">
          <dt>PFA</dt><dd>${esc(m.pfa)}</dd>
          <dt>Employer pension</dt><dd>${nairaFull(Math.round(ps.pensionEmployer/12))} monthly</dd>
        </dl>
      </div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="print-slip">Print</button>`,
    wire(){ $('#print-slip').addEventListener('click',()=>window.print()); },
  });
}

// -------------------------------------------------------------- operations --

PAGES.operations = () => {
  // Four independent modules sharing one page. A Librarian holding only
  // library.view never sees the other three tabs exist, same as if
  // Transport, Hostel and Inventory were separate routes with separate
  // permissions — which, as far as access control is concerned, they are.
  const tabs = [['library','Library'],['transport','Transport'],['hostel','Hostel'],['inventory','Inventory']]
    .filter(([id])=>can(`${id}.view`));
  if(!tabs.length) return `<div class="denied"><h2>Not available at this role</h2>
    <p>${ROLES[state.role].title} doesn't hold view on library, transport, hostel or inventory.</p></div>`;
  if(!tabs.some(t=>t[0]===state.opsTab)) state.opsTab=tabs[0][0];

  return `
  <div class="phead">
    <div><h1>Operations</h1><p>Library, transport, hostel and stores. Grouped because they share the same shape — an asset, who holds it, and when it comes back.</p></div>
  </div>
  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-otab="${id}" aria-selected="${state.opsTab===id}">${l}</button>`).join('')}</div>
  ${({library:opsLibrary, transport:opsTransport, hostel:opsHostel, inventory:opsInventory})[state.opsTab]()}`;
};

/** Four tabs sharing one overview strip. Catalog owns the title records
    (ISBN, barcode, category); Loans & Returns is the only place a book's
    available count ever changes by hand; Reservations queues a hold when
    every copy is out; Fines is what "the fine vanished the moment the book
    stopped being overdue" used to mean — now the amount is frozen onto the
    borrowing record the moment it's returned, so it survives to be paid
    or waived afterwards. */
function opsLibrary(){
  const overdue = overdueBorrowings();
  const onLoan = db.borrowings.filter(b=>!b.returnedOn);
  const finesAccruing = overdue.reduce((t,b)=>t+fineFor(b),0);
  const tabs = [['catalog','Catalog'],['loans','Loans & Returns'],['reservations','Reservations'],['fines','Fines']];
  if(!tabs.some(t=>t[0]===state.libTab)) state.libTab = 'catalog';
  const bodies = {catalog:libCatalogBody, loans:libLoansBody, reservations:libReservationsBody, fines:libFinesBody};

  return `
  <div class="grid-stats">
    <div class="stat">${svg('scores',40)}<div><div class="v">${db.books.reduce((t,b)=>t+b.copies,0)}</div><div class="l">Copies held</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${onLoan.length}</div><div class="l">On loan</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${overdue.length}</div><div class="l">Overdue</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(finesAccruing)}</div><div class="l">Fines accruing</div></div></div>
  </div>

  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-libtab="${id}" aria-selected="${state.libTab===id}">${l}</button>`).join('')}</div>

  ${(bodies[state.libTab]||libCatalogBody)()}`;
}

// ---- Catalog ---------------------------------------------------------

function libCatalogBody(){
  let list = db.books;
  if(state.libQuery){
    const q = state.libQuery.toLowerCase();
    list = list.filter(b=>`${b.title} ${b.author} ${b.isbn} ${b.barcode}`.toLowerCase().includes(q));
  }
  if(state.libCat) list = list.filter(b=>b.cat===state.libCat);

  return `
  <div class="toolbar" style="margin-top:14px">
    <input type="text" class="search" id="lib-q" placeholder="Search title, author, ISBN or barcode" value="${esc(state.libQuery)}">
    <select class="pick" id="lib-cat"><option value="">All categories</option>${LIBRARY_CATEGORIES.map(c=>`<option ${state.libCat===c?'selected':''}>${c}</option>`).join('')}</select>
    <input type="text" class="pick" id="lib-scan" placeholder="Scan barcode, then Enter…" style="width:180px">
    <span class="spacer"></span>
    ${can('library.create')?`<button class="btn btn-y btn-s" id="add-book">Add book</button>`:''}
  </div>

  <div class="tw"><table>
    <thead><tr><th>Title</th><th>Author</th><th>Category</th><th class="num">Copies</th><th class="num">Available</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.map(b=>`<tr>
      <td><div style="font-weight:500">${esc(b.title)}</div>
        <div class="sm" style="font-family:var(--mono);font-size:10px;color:var(--muted)">ISBN ${esc(b.isbn)} · ${esc(b.barcode)}</div></td>
      <td style="font-size:12.5px">${esc(b.author)}</td><td>${esc(b.cat)}</td>
      <td class="num">${b.copies}</td><td class="num">${b.available}</td>
      <td><span class="pill ${b.available===0?'p-bad':b.available<b.copies*0.3?'p-warn':'p-ok'}">${b.available===0?'ALL OUT':b.available<b.copies*0.3?'LOW':'AVAILABLE'}</span></td>
      <td style="display:flex;gap:6px">
        ${b.available>0&&can('library.create')?`<button class="btn btn-p btn-s" data-borrow="${b.id}">Borrow</button>`:''}
        ${b.available===0&&can('library.create')?`<button class="btn btn-q btn-s" data-reserve="${b.id}">Reserve</button>`:''}
        ${can('library.edit')?`<button class="btn btn-q btn-s" data-book-edit="${b.id}">Edit</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${list.length===0?'<p class="sub" style="margin-top:12px">No books match.</p>':''}`;
}

function wireLibCatalog(){
  const q = $('#lib-q');
  if(q) q.addEventListener('input',e=>{state.libQuery=e.target.value;const p=e.target.selectionStart;render();const n=$('#lib-q');if(n){n.focus();n.setSelectionRange(p,p);}});
  const cat = $('#lib-cat');
  if(cat) cat.addEventListener('change',e=>{state.libCat=e.target.value;render();});
  const scan = $('#lib-scan');
  if(scan) scan.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    const code = e.target.value.trim();
    const bk = db.books.find(b=>b.barcode===code || b.isbn===code);
    if(!bk){ toast('No book with that barcode.', true); return; }
    state.libQuery = bk.title; state.libCat=''; render();
    toast(`Found: ${bk.title}.`);
  });
  const add = $('#add-book'); if(add) add.addEventListener('click',()=>openBookForm());
  document.querySelectorAll('[data-book-edit]').forEach(b=>b.addEventListener('click',()=>openBookForm(b.dataset.bookEdit)));
  document.querySelectorAll('[data-borrow]').forEach(b=>b.addEventListener('click',()=>openBorrowForm(b.dataset.borrow)));
  document.querySelectorAll('[data-reserve]').forEach(b=>b.addEventListener('click',()=>openReserveForm(b.dataset.reserve)));
}

/** Barcode defaults to the next sequential library tag but stays editable —
    a real scanner assigning its own code should be able to overwrite it. */
function openBookForm(editId){
  const existing = editId ? db.books.find(x=>x.id===editId) : null;
  modal({
    title: existing?'Edit book':'Add book',
    sub: existing?`${esc(existing.title)} — ${existing.available} of ${existing.copies} available`:undefined,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Title</label><input type="text" id="bk-title" value="${existing?esc(existing.title):''}"><div class="err" id="e-bktitle"></div></div>
      <div class="f"><label class="req">Author</label><input type="text" id="bk-author" value="${existing?esc(existing.author):''}"><div class="err" id="e-bkauthor"></div></div>
      <div class="f"><label class="req">Category</label><select id="bk-cat">${LIBRARY_CATEGORIES.map(c=>`<option ${existing?.cat===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="f"><label>ISBN</label><input type="text" id="bk-isbn" value="${existing?esc(existing.isbn):''}" placeholder="978-..."></div>
      <div class="f"><label>Barcode</label><input type="text" id="bk-barcode" value="${existing?esc(existing.barcode):`FA-LIB-${String(db.books.length+1).padStart(6,'0')}`}"></div>
      <div class="f"><label class="req">Copies</label><input type="number" id="bk-copies" min="${existing?existing.copies-existing.available:1}" value="${existing?existing.copies:1}"><div class="err" id="e-bkcopies"></div></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button>
      ${existing&&can('library.delete')?`<button class="btn btn-d" id="bk-delete">Delete</button>`:''}
      <button class="btn btn-p" id="bk-save">${existing?'Save changes':'Add book'}</button>`,
    wire(){
      $('#bk-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const title = $('#bk-title').value.trim(), author = $('#bk-author').value.trim();
        const copies = Number($('#bk-copies').value);
        const onLoan = existing ? existing.copies-existing.available : 0;
        let bad=false;
        if(!title){ $('#e-bktitle').textContent='Enter a title.'; bad=true; }
        if(!author){ $('#e-bkauthor').textContent='Enter an author.'; bad=true; }
        if(!copies || copies<1){ $('#e-bkcopies').textContent='Enter at least one copy.'; bad=true; }
        else if(copies<onLoan){ $('#e-bkcopies').textContent=`${onLoan} ${onLoan===1?'copy is':'copies are'} on loan — can't drop below that.`; bad=true; }
        if(bad) return;

        if(existing){
          existing.title=title; existing.author=author; existing.cat=$('#bk-cat').value;
          existing.isbn=$('#bk-isbn').value.trim()||existing.isbn;
          existing.barcode=$('#bk-barcode').value.trim()||existing.barcode;
          existing.available += copies-existing.copies; existing.copies=copies;
          logAudit('library.book', `${title} updated`);
        } else {
          db.books.push({id:uid('bk'), title, author, cat:$('#bk-cat').value,
            isbn:$('#bk-isbn').value.trim()||'—', barcode:$('#bk-barcode').value.trim()||`FA-LIB-${String(db.books.length+1).padStart(6,'0')}`,
            copies, available:copies});
          logAudit('library.book', `${title} added to the catalogue`);
        }
        persist(); closeModal();
        toast(existing?'Book updated.':'Book added.');
        render();
      });
      const del = $('#bk-delete');
      if(del) del.addEventListener('click',()=>{
        if(existing.available<existing.copies){ toast('Copies are still on loan — return them before deleting the title.', true); return; }
        if(db.reservations.some(r=>r.bookId===existing.id && ['WAITING','READY'].includes(r.status))){ toast('There are open reservations on this title.', true); return; }
        db.books = db.books.filter(x=>x.id!==existing.id);
        logAudit('library.book', `${existing.title} removed from the catalogue`);
        persist(); closeModal();
        toast('Book removed.');
        render();
      });
    },
  });
}

// ---- Borrowing & Reservations -----------------------------------------

function openBorrowForm(bookId){
  const bk = db.books.find(x=>x.id===bookId);
  const list = db.students.filter(s=>s.status==='ACTIVE');
  modal({
    title:'Borrow book', sub:`${esc(bk.title)} · ${bk.available} of ${bk.copies} available`,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Student</label><select id="bw-student">${list.map(s=>`<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} — ${esc(s.admissionNo)}</option>`).join('')}</select></div>
      <div class="f"><label>Due date</label><input type="date" id="bw-due" value="${new Date(Date.now()+14*86400000).toISOString().slice(0,10)}"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="bw-save">Check out</button>`,
    wire(){
      $('#bw-save').addEventListener('click',()=>{
        if(bk.available<=0){ toast('No copies available.', true); return; }
        const studentId = $('#bw-student').value;
        const due = $('#bw-due').value || new Date(Date.now()+14*86400000).toISOString().slice(0,10);
        db.borrowings.push({id:uid('bw'), bookId, studentId, out:todayISO(), due, returnedOn:null, fineAmount:0, fineStatus:'NONE'});
        bk.available--;
        const s = db.students.find(x=>x.id===studentId);
        logAudit('library.borrow', `${bk.title} checked out to ${s.firstName} ${s.lastName}`);
        persist(); closeModal();
        toast(`${esc(bk.title)} checked out to ${esc(s.firstName)} ${esc(s.lastName)}.`);
        render();
      });
    },
  });
}

function openReserveForm(bookId){
  const bk = db.books.find(x=>x.id===bookId);
  const list = db.students.filter(s=>s.status==='ACTIVE'
    && !db.borrowings.some(b=>b.bookId===bookId&&b.studentId===s.id&&!b.returnedOn)
    && !db.reservations.some(r=>r.bookId===bookId&&r.studentId===s.id&&['WAITING','READY'].includes(r.status)));
  modal({
    title:'Reserve book', sub:`${esc(bk.title)} · all ${bk.copies} copies out`,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Student</label><select id="rs-student">${list.map(s=>`<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} — ${esc(s.admissionNo)}</option>`).join('')}</select></div>
    </div>
    <p class="note">Holds a place in the queue — nothing is checked out yet. The next person in line is notified once a copy comes back.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="rs-save">Reserve</button>`,
    wire(){
      $('#rs-save').addEventListener('click',()=>{
        const studentId = $('#rs-student').value;
        if(!studentId){ toast('Choose a student.', true); return; }
        db.reservations.push({id:uid('res'), bookId, studentId, reservedOn:todayISO(), status:'WAITING'});
        const s = db.students.find(x=>x.id===studentId);
        logAudit('library.reserve', `${bk.title} reserved for ${s.firstName} ${s.lastName}`);
        persist(); closeModal();
        toast('Reservation placed.');
        render();
      });
    },
  });
}

// ---- Loans & Returns -----------------------------------------------------

function libLoansBody(){
  const onLoan = db.borrowings.filter(b=>!b.returnedOn)
    .map(b=>({b, bk:db.books.find(x=>x.id===b.bookId), st:db.students.find(x=>x.id===b.studentId)}))
    .sort((a,c)=>a.b.due.localeCompare(c.b.due));

  return `
  <div class="tw" style="margin-top:14px"><table>
    <thead><tr><th>Book</th><th>Borrower</th><th>Out</th><th>Due</th><th class="num">Fine</th><th></th></tr></thead>
    <tbody>${onLoan.map(({b,bk,st})=>{
      const late = b.due<todayISO();
      const fine = fineFor(b);
      return `<tr ${late?'style="background:var(--clay-soft)"':''}>
        <td>${bk?esc(bk.title):'—'}</td>
        <td>${st?esc(st.firstName+' '+st.lastName):'—'}</td>
        <td>${fmtDate(b.out)}</td>
        <td>${late?`<b style="color:var(--clay)">${fmtDate(b.due)}</b>`:fmtDate(b.due)}</td>
        <td class="num" style="color:${fine?'var(--clay)':'inherit'};font-weight:${fine?600:400}">${fine?naira(fine):'—'}</td>
        <td>${can('library.edit')?`<button class="btn btn-p btn-s" data-return="${b.id}">Return</button>`:''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${onLoan.length===0?'<p class="sub" style="margin-top:12px">Nothing out on loan.</p>':''}
  <p class="note">₦50 a day, capped at the replacement cost. A forgotten book should never cost a parent more than simply buying another one.</p>`;
}

function wireLibLoans(){
  document.querySelectorAll('[data-return]').forEach(b=>b.addEventListener('click',()=>{
    const bw = db.borrowings.find(x=>x.id===b.dataset.return);
    const bk = db.books.find(x=>x.id===bw.bookId);
    const fine = fineFor(bw);
    bw.returnedOn = todayISO();
    bw.fineAmount = fine;
    bw.fineStatus = fine>0 ? 'OWED' : 'NONE';
    if(bk) bk.available++;

    // The earliest waiting reservation on this title is told a copy is
    // ready — the copy stays counted as available until someone actually
    // checks it out against the hold, from the Reservations tab.
    const next = db.reservations.filter(r=>r.bookId===bw.bookId && r.status==='WAITING')
      .sort((a,c)=>a.reservedOn.localeCompare(c.reservedOn))[0];
    if(next){
      next.status = 'READY';
      if((ROLES.PARENT.childIds||[]).includes(next.studentId))
        notify('PARENT', 'Reserved book is ready', `${bk?bk.title:'A book'} is ready for pickup at the library.`);
    }

    logAudit('library.return', `${bk?bk.title:'A book'} returned${fine?` — fine of ${naira(fine)}`:''}`);
    persist();
    toast(fine ? `Returned. Fine of ${naira(fine)} recorded.` : 'Returned.');
    render();
  }));
}

// ---- Reservations ----------------------------------------------------

function libReservationsBody(){
  const rows = db.reservations.map(r=>({r, bk:db.books.find(x=>x.id===r.bookId), st:db.students.find(x=>x.id===r.studentId)}))
    .filter(x=>x.bk&&x.st).sort((a,c)=>c.r.reservedOn.localeCompare(a.r.reservedOn));
  const active = rows.filter(x=>['WAITING','READY'].includes(x.r.status));

  return `
  <div class="toolbar" style="margin-top:14px">
    <span style="font-size:12.5px;color:var(--muted)">${active.length} active reservation${active.length===1?'':'s'}</span>
  </div>
  <div class="tw"><table>
    <thead><tr><th>Book</th><th>Student</th><th>Reserved</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(({r,bk,st})=>`<tr>
      <td>${esc(bk.title)}</td>
      <td>${esc(st.firstName)} ${esc(st.lastName)}</td>
      <td>${fmtDate(r.reservedOn)}</td>
      <td><span class="pill ${r.status==='READY'?'p-ok':r.status==='WAITING'?'p-warn':r.status==='FULFILLED'?'p-info':'p-mute'}">${r.status}</span></td>
      <td style="display:flex;gap:6px">
        ${r.status==='READY'&&can('library.create')?`<button class="btn btn-p btn-s" data-fulfil="${r.id}">Check out</button>`:''}
        ${['WAITING','READY'].includes(r.status)&&can('library.edit')?`<button class="btn btn-d btn-s" data-cancel-res="${r.id}">Cancel</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${rows.length===0?'<p class="sub" style="margin-top:12px">No reservations yet — a "Reserve" button appears on a book once every copy is checked out.</p>':''}`;
}

function wireLibReservations(){
  document.querySelectorAll('[data-fulfil]').forEach(b=>b.addEventListener('click',()=>{
    const r = db.reservations.find(x=>x.id===b.dataset.fulfil);
    const bk = db.books.find(x=>x.id===r.bookId);
    if(bk.available<=0){ toast('No copy is actually free yet.', true); return; }
    bk.available--;
    db.borrowings.push({id:uid('bw'), bookId:r.bookId, studentId:r.studentId, out:todayISO(),
      due:new Date(Date.now()+14*86400000).toISOString().slice(0,10), returnedOn:null, fineAmount:0, fineStatus:'NONE'});
    r.status = 'FULFILLED';
    const s = db.students.find(x=>x.id===r.studentId);
    logAudit('library.reserve', `${bk.title} reservation fulfilled for ${s.firstName} ${s.lastName}`);
    persist();
    toast('Checked out from the hold shelf.');
    render();
  }));
  document.querySelectorAll('[data-cancel-res]').forEach(b=>b.addEventListener('click',()=>{
    const r = db.reservations.find(x=>x.id===b.dataset.cancelRes);
    r.status = 'CANCELLED';
    persist();
    toast('Reservation cancelled.');
    render();
  }));
}

// ---- Fines --------------------------------------------------------------

function libFinesBody(){
  const owed = db.borrowings.filter(b=>b.fineStatus==='OWED')
    .map(b=>({b, bk:db.books.find(x=>x.id===b.bookId), st:db.students.find(x=>x.id===b.studentId)}));
  const settled = db.borrowings.filter(b=>b.fineStatus==='PAID'||b.fineStatus==='WAIVED')
    .map(b=>({b, bk:db.books.find(x=>x.id===b.bookId), st:db.students.find(x=>x.id===b.studentId)}));
  const totalOwed = owed.reduce((t,x)=>t+x.b.fineAmount,0);

  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(totalOwed)}</div><div class="l">Outstanding fines</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${owed.length}</div><div class="l">Students owing</div></div></div>
  </div>

  <div class="block">
    <h2>Outstanding <small>${owed.length}</small></h2>
    ${owed.length?`<div class="tw"><table>
      <thead><tr><th>Book</th><th>Student</th><th>Returned</th><th class="num">Fine</th><th></th></tr></thead>
      <tbody>${owed.map(({b,bk,st})=>`<tr>
        <td>${bk?esc(bk.title):'—'}</td><td>${st?esc(st.firstName+' '+st.lastName):'—'}</td>
        <td>${fmtDate(b.returnedOn)}</td>
        <td class="num" style="color:var(--clay);font-weight:600">${naira(b.fineAmount)}</td>
        <td style="display:flex;gap:6px">
          ${can('library.edit')?`<button class="btn btn-p btn-s" data-fine-pay="${b.id}">Record payment</button>`:''}
          ${can('library.approve')?`<button class="btn btn-q btn-s" data-fine-waive="${b.id}">Waive</button>`:''}
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">Nothing outstanding.</p>'}
  </div>

  <div class="block">
    <h2>Settled <small>${settled.length}</small></h2>
    ${settled.length?`<div class="tw"><table>
      <thead><tr><th>Book</th><th>Student</th><th class="num">Fine</th><th>Outcome</th></tr></thead>
      <tbody>${settled.map(({b,bk,st})=>`<tr>
        <td>${bk?esc(bk.title):'—'}</td><td>${st?esc(st.firstName+' '+st.lastName):'—'}</td>
        <td class="num">${naira(b.fineAmount)}</td>
        <td><span class="pill ${b.fineStatus==='PAID'?'p-ok':'p-info'}">${b.fineStatus}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">Nothing settled yet.</p>'}
  </div>`;
}

function wireLibFines(){
  document.querySelectorAll('[data-fine-pay]').forEach(b=>b.addEventListener('click',()=>{
    const bw = db.borrowings.find(x=>x.id===b.dataset.finePay);
    const bk = db.books.find(x=>x.id===bw.bookId);
    const st = db.students.find(x=>x.id===bw.studentId);
    bw.fineStatus = 'PAID';
    const ref = `INC/2026/${String(db.income.length+1).padStart(5,'0')}`;
    db.income.push({id:uid('inc'), category:'Library fines', description:`Fine — ${bk?bk.title:'library book'}${st?` (${st.firstName} ${st.lastName})`:''}`,
      amount:bw.fineAmount, at:todayISO(), ref, recordedBy:ROLES[state.role].name});
    logAudit('library.fine', `${naira(bw.fineAmount)} fine paid — ${bk?bk.title:'—'}`);
    persist();
    toast('Fine recorded as paid.');
    render();
  }));
  document.querySelectorAll('[data-fine-waive]').forEach(b=>b.addEventListener('click',()=>{
    const bw = db.borrowings.find(x=>x.id===b.dataset.fineWaive);
    const bk = db.books.find(x=>x.id===bw.bookId);
    bw.fineStatus = 'WAIVED';
    logAudit('library.fine', `${naira(bw.fineAmount)} fine waived — ${bk?bk.title:'—'}`);
    persist();
    toast('Fine waived.');
    render();
  }));
}

const VEHICLE_MAINT_TYPES = ['Service','Repair','Tyres','Inspection','Other'];

/** Six tabs on one module. Vehicles and drivers are their own records now
    (a route just points at whichever of each is on duty), stops are edited
    as part of the route rather than fixed at seed time, and a student's
    transport fee follows their actual route's fare through feeItemsFor —
    nothing here is a second number kept in step by hand. */
function opsTransport(){
  const tabs = [['routes','Routes'],['vehicles','Vehicles'],['drivers','Drivers'],
    ['allocation','Allocation'],['maintenance','Maintenance'],['fuel','Fuel']];
  if(!tabs.some(t=>t[0]===state.transTab)) state.transTab = 'routes';
  const bodies = {routes:transRoutesBody, vehicles:transVehiclesBody, drivers:transDriversBody,
    allocation:transAllocationBody, maintenance:transMaintenanceBody, fuel:transFuelBody};

  return `
  <div class="grid-stats">
    <div class="stat">${svg('transport',40)}<div><div class="v">${db.routes.length}</div><div class="l">Routes running</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${db.transportAlloc.length}</div><div class="l">Students carried</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(db.transportAlloc.reduce((t,a)=>t+(db.routes.find(r=>r.id===a.routeId)?.fare||0),0))}</div><div class="l">Termly fare billed</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${db.vehicles.filter(v=>v.vioExpiry<'2027-01-01').length}</div><div class="l">VIO renewals due</div></div></div>
  </div>

  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-transtab="${id}" aria-selected="${state.transTab===id}">${l}</button>`).join('')}</div>

  ${(bodies[state.transTab]||transRoutesBody)()}`;
}

// ---- Routes ------------------------------------------------------------

function transRoutesBody(){
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('transport.create')?`<button class="btn btn-y btn-s" id="add-route">Add route</button>`:''}
  </div>
  ${db.routes.map(r=>{
    const v = db.vehicles.find(x=>x.id===r.vehicleId), d = db.drivers.find(x=>x.id===r.driverId);
    const riders = db.transportAlloc.filter(a=>a.routeId===r.id);
    const full = v ? riders.length/v.capacity : 0;
    return `<div class="block">
      <div class="toolbar" style="margin-bottom:0"><h2 style="margin:0">${esc(r.name)}</h2><span class="spacer"></span>
        ${can('transport.edit')?`<button class="btn btn-q btn-s" data-route-edit="${r.id}">Edit</button>`:''}</div>
      <p class="sub">${r.stops.map(esc).join(' → ')}</p>
      <div class="fgrid">
        <dl class="kv">
          <dt>Vehicle</dt><dd>${v?`${esc(v.plate)} — ${esc(v.model)}`:'<span style="color:var(--muted)">Unassigned</span>'}</dd>
          <dt>Driver</dt><dd>${d?`${esc(d.name)} · <span style="font-family:var(--mono);font-size:12px">${esc(d.phone)}</span>`:'<span style="color:var(--muted)">Unassigned</span>'}</dd>
          <dt>Termly fare</dt><dd>${nairaFull(r.fare)}</dd>
        </dl>
        <dl class="kv">
          <dt>Riders</dt><dd>${riders.length}${v?` of ${v.capacity}`:''}
            ${v?`<div class="bar" style="margin-top:5px;max-width:150px"><i class="${full>0.95?'low':full>0.8?'mid':''}" style="width:${Math.min(100,full*100)}%"></i></div>`:''}</dd>
          <dt>VIO certificate</dt><dd>${v?`${fmtDate(v.vioExpiry)} ${v.vioExpiry<'2027-01-01'?'<span class="pill p-warn">RENEW SOON</span>':'<span class="pill p-ok">VALID</span>'}`:'—'}</dd>
        </dl>
      </div>
    </div>`;
  }).join('')}
  ${db.routes.length===0?'<p class="sub">No routes yet.</p>':''}
  <p class="note">A vehicle whose VIO roadworthiness certificate has lapsed is flagged rather than blocked — the school decides whether to run it, but nobody can say they were not told.</p>`;
}

function wireTransRoutes(){
  const add = $('#add-route'); if(add) add.addEventListener('click',()=>openRouteForm());
  document.querySelectorAll('[data-route-edit]').forEach(b=>b.addEventListener('click',()=>openRouteForm(b.dataset.routeEdit)));
}

function openRouteForm(editId){
  const existing = editId ? db.routes.find(x=>x.id===editId) : null;
  const vehicles = db.vehicles.filter(v=>v.condition!=='RETIRED' && (v.id===existing?.vehicleId || !db.routes.some(r=>r.vehicleId===v.id)));
  const drivers = db.drivers.filter(d=>d.status==='ACTIVE' && (d.id===existing?.driverId || !db.routes.some(r=>r.driverId===d.id)));
  modal({
    title: existing?'Edit route':'Add route', wide:true,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Route name</label><input type="text" id="rt-name" value="${existing?esc(existing.name):''}"><div class="err" id="e-rtname"></div></div>
      <div class="f"><label>Vehicle</label><select id="rt-vehicle"><option value="">Unassigned</option>${vehicles.map(v=>`<option value="${v.id}" ${existing?.vehicleId===v.id?'selected':''}>${esc(v.plate)} — ${esc(v.model)}</option>`).join('')}</select></div>
      <div class="f"><label>Driver</label><select id="rt-driver"><option value="">Unassigned</option>${drivers.map(d=>`<option value="${d.id}" ${existing?.driverId===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Termly fare (₦)</label><input type="number" id="rt-fare" min="0" value="${existing?Math.round(existing.fare/100):''}"><div class="err" id="e-rtfare"></div></div>
      <div class="f wide"><label>Stops <small style="color:var(--muted)">one per line, in order — last is usually the school</small></label>
        <textarea id="rt-stops" rows="5">${existing?existing.stops.join('\n'):''}</textarea></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button>
      ${existing&&can('transport.delete')?`<button class="btn btn-d" id="rt-delete">Delete</button>`:''}
      <button class="btn btn-p" id="rt-save">${existing?'Save changes':'Add route'}</button>`,
    wire(){
      $('#rt-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const name = $('#rt-name').value.trim();
        const fare = Math.round(Number($('#rt-fare').value)*100);
        const stops = $('#rt-stops').value.split('\n').map(s=>s.trim()).filter(Boolean);
        let bad=false;
        if(!name){ $('#e-rtname').textContent='Enter a route name.'; bad=true; }
        if(!fare||fare<=0){ $('#e-rtfare').textContent='Enter a fare.'; bad=true; }
        if(bad) return;
        const vehicleId = $('#rt-vehicle').value||null, driverId = $('#rt-driver').value||null;
        if(existing){
          Object.assign(existing, {name, fare, stops, vehicleId, driverId});
          logAudit('transport.route', `${name} updated`);
        } else {
          db.routes.push({id:uid('rt'), name, fare, stops, vehicleId, driverId});
          logAudit('transport.route', `${name} added`);
        }
        persist(); closeModal();
        toast(existing?'Route updated.':'Route added.');
        render();
      });
      const del = $('#rt-delete');
      if(del) del.addEventListener('click',()=>{
        if(db.transportAlloc.some(a=>a.routeId===existing.id)){ toast('Students are still allocated to this route.', true); return; }
        db.routes = db.routes.filter(r=>r.id!==existing.id);
        logAudit('transport.route', `${existing.name} removed`);
        persist(); closeModal();
        toast('Route removed.');
        render();
      });
    },
  });
}

// ---- Vehicles ------------------------------------------------------------

function transVehiclesBody(){
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('transport.create')?`<button class="btn btn-y btn-s" id="add-vehicle">Add vehicle</button>`:''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Plate</th><th>Model</th><th class="num">Capacity</th><th>VIO expiry</th><th>Condition</th><th>Route</th><th></th></tr></thead>
    <tbody>${db.vehicles.map(v=>{
      const route = db.routes.find(r=>r.vehicleId===v.id);
      const vioSoon = v.vioExpiry<'2027-01-01';
      return `<tr>
        <td style="font-family:var(--mono);font-weight:600">${esc(v.plate)}</td>
        <td>${esc(v.model)}</td><td class="num">${v.capacity}</td>
        <td>${vioSoon?`<span style="color:var(--clay)">${fmtDate(v.vioExpiry)}</span>`:fmtDate(v.vioExpiry)}</td>
        <td><span class="pill ${v.condition==='ACTIVE'?'p-ok':v.condition==='MAINTENANCE'?'p-warn':'p-bad'}">${v.condition}</span></td>
        <td style="font-size:12px;color:var(--muted)">${route?esc(route.name):'Unassigned'}</td>
        <td>${can('transport.edit')?`<button class="btn btn-q btn-s" data-vehicle-edit="${v.id}">Edit</button>`:''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${db.vehicles.length===0?'<p class="sub" style="margin-top:12px">No vehicles yet.</p>':''}`;
}

function wireTransVehicles(){
  const add = $('#add-vehicle'); if(add) add.addEventListener('click',()=>openVehicleForm());
  document.querySelectorAll('[data-vehicle-edit]').forEach(b=>b.addEventListener('click',()=>openVehicleForm(b.dataset.vehicleEdit)));
}

function openVehicleForm(editId){
  const existing = editId ? db.vehicles.find(x=>x.id===editId) : null;
  modal({
    title: existing?'Edit vehicle':'Add vehicle',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Plate number</label><input type="text" id="vh-plate" value="${existing?esc(existing.plate):''}"><div class="err" id="e-vhplate"></div></div>
      <div class="f"><label class="req">Model</label><input type="text" id="vh-model" value="${existing?esc(existing.model):''}" placeholder="Toyota Hiace"><div class="err" id="e-vhmodel"></div></div>
      <div class="f"><label class="req">Capacity</label><input type="number" id="vh-cap" min="1" value="${existing?existing.capacity:18}"><div class="err" id="e-vhcap"></div></div>
      <div class="f"><label>Condition</label><select id="vh-cond">
        <option value="ACTIVE" ${existing?.condition==='ACTIVE'?'selected':''}>Active</option>
        <option value="MAINTENANCE" ${existing?.condition==='MAINTENANCE'?'selected':''}>In maintenance</option>
        <option value="RETIRED" ${existing?.condition==='RETIRED'?'selected':''}>Retired</option></select></div>
      <div class="f wide"><label class="req">VIO certificate expiry</label><input type="date" id="vh-vio" value="${existing?existing.vioExpiry:''}"><div class="err" id="e-vhvio"></div></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button>
      ${existing&&can('transport.delete')?`<button class="btn btn-d" id="vh-delete">Delete</button>`:''}
      <button class="btn btn-p" id="vh-save">${existing?'Save changes':'Add vehicle'}</button>`,
    wire(){
      $('#vh-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const plate = $('#vh-plate').value.trim(), model = $('#vh-model').value.trim();
        const capacity = Number($('#vh-cap').value), vioExpiry = $('#vh-vio').value;
        let bad=false;
        if(!plate){ $('#e-vhplate').textContent='Enter a plate number.'; bad=true; }
        if(!model){ $('#e-vhmodel').textContent='Enter a model.'; bad=true; }
        if(!capacity||capacity<1){ $('#e-vhcap').textContent='Enter a capacity.'; bad=true; }
        if(!vioExpiry){ $('#e-vhvio').textContent='Enter the VIO expiry date.'; bad=true; }
        if(bad) return;
        const condition = $('#vh-cond').value;
        if(existing){
          Object.assign(existing, {plate, model, capacity, condition, vioExpiry});
          logAudit('transport.vehicle', `${plate} updated`);
        } else {
          db.vehicles.push({id:uid('veh'), plate, model, capacity, condition, vioExpiry});
          logAudit('transport.vehicle', `${plate} added to the fleet`);
        }
        persist(); closeModal();
        toast(existing?'Vehicle updated.':'Vehicle added.');
        render();
      });
      const del = $('#vh-delete');
      if(del) del.addEventListener('click',()=>{
        if(db.routes.some(r=>r.vehicleId===existing.id)){ toast('This vehicle is still assigned to a route.', true); return; }
        db.vehicles = db.vehicles.filter(x=>x.id!==existing.id);
        logAudit('transport.vehicle', `${existing.plate} removed from the fleet`);
        persist(); closeModal();
        toast('Vehicle removed.');
        render();
      });
    },
  });
}

// ---- Drivers ------------------------------------------------------------

function transDriversBody(){
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('transport.create')?`<button class="btn btn-y btn-s" id="add-driver">Add driver</button>`:''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Name</th><th>Phone</th><th>Licence no.</th><th>Licence expiry</th><th>Status</th><th>Route</th><th></th></tr></thead>
    <tbody>${db.drivers.map(d=>{
      const route = db.routes.find(r=>r.driverId===d.id);
      return `<tr>
        <td style="font-weight:500">${esc(d.name)}</td>
        <td style="font-family:var(--mono);font-size:12px">${esc(d.phone)}</td>
        <td style="font-family:var(--mono);font-size:11.5px">${esc(d.licenseNo)}</td>
        <td>${fmtDate(d.licenseExpiry)}</td>
        <td><span class="pill ${d.status==='ACTIVE'?'p-ok':'p-mute'}">${d.status}</span></td>
        <td style="font-size:12px;color:var(--muted)">${route?esc(route.name):'Unassigned'}</td>
        <td>${can('transport.edit')?`<button class="btn btn-q btn-s" data-driver-edit="${d.id}">Edit</button>`:''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${db.drivers.length===0?'<p class="sub" style="margin-top:12px">No drivers yet.</p>':''}`;
}

function wireTransDrivers(){
  const add = $('#add-driver'); if(add) add.addEventListener('click',()=>openDriverForm());
  document.querySelectorAll('[data-driver-edit]').forEach(b=>b.addEventListener('click',()=>openDriverForm(b.dataset.driverEdit)));
}

function openDriverForm(editId){
  const existing = editId ? db.drivers.find(x=>x.id===editId) : null;
  modal({
    title: existing?'Edit driver':'Add driver',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Name</label><input type="text" id="dv-name" value="${existing?esc(existing.name):''}"><div class="err" id="e-dvname"></div></div>
      <div class="f"><label class="req">Phone</label><input type="text" id="dv-phone" value="${existing?esc(existing.phone):''}" placeholder="08012345678"><div class="err" id="e-dvphone"></div></div>
      <div class="f"><label class="req">Licence number</label><input type="text" id="dv-lic" value="${existing?esc(existing.licenseNo):''}"><div class="err" id="e-dvlic"></div></div>
      <div class="f"><label class="req">Licence expiry</label><input type="date" id="dv-licexp" value="${existing?existing.licenseExpiry:''}"><div class="err" id="e-dvlicexp"></div></div>
      <div class="f"><label>Status</label><select id="dv-status">
        <option value="ACTIVE" ${existing?.status==='ACTIVE'?'selected':''}>Active</option>
        <option value="INACTIVE" ${existing?.status==='INACTIVE'?'selected':''}>Inactive</option></select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button>
      ${existing&&can('transport.delete')?`<button class="btn btn-d" id="dv-delete">Delete</button>`:''}
      <button class="btn btn-p" id="dv-save">${existing?'Save changes':'Add driver'}</button>`,
    wire(){
      $('#dv-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const name = $('#dv-name').value.trim(), phone = $('#dv-phone').value.trim();
        const licenseNo = $('#dv-lic').value.trim(), licenseExpiry = $('#dv-licexp').value;
        let bad=false;
        if(!name){ $('#e-dvname').textContent='Enter a name.'; bad=true; }
        if(!phone){ $('#e-dvphone').textContent='Enter a phone number.'; bad=true; }
        if(!licenseNo){ $('#e-dvlic').textContent='Enter the licence number.'; bad=true; }
        if(!licenseExpiry){ $('#e-dvlicexp').textContent='Enter the licence expiry date.'; bad=true; }
        if(bad) return;
        const status = $('#dv-status').value;
        if(existing){
          Object.assign(existing, {name, phone, licenseNo, licenseExpiry, status});
          logAudit('transport.driver', `${name} updated`);
        } else {
          db.drivers.push({id:uid('drv'), name, phone, licenseNo, licenseExpiry, status});
          logAudit('transport.driver', `${name} added`);
        }
        persist(); closeModal();
        toast(existing?'Driver updated.':'Driver added.');
        render();
      });
      const del = $('#dv-delete');
      if(del) del.addEventListener('click',()=>{
        if(db.routes.some(r=>r.driverId===existing.id)){ toast('This driver is still assigned to a route.', true); return; }
        db.drivers = db.drivers.filter(x=>x.id!==existing.id);
        logAudit('transport.driver', `${existing.name} removed`);
        persist(); closeModal();
        toast('Driver removed.');
        render();
      });
    },
  });
}

// ---- Allocation ------------------------------------------------------

function transAllocationBody(){
  const allocated = db.transportAlloc.map(a=>({a, s:db.students.find(x=>x.id===a.studentId), r:db.routes.find(x=>x.id===a.routeId)})).filter(x=>x.s);
  const notOnTransport = db.students.filter(s=>s.status==='ACTIVE' && !s.transport);

  return `
  <div class="toolbar" style="margin-top:14px">
    <span style="font-size:12.5px;color:var(--muted)">${allocated.length} allocated</span>
    <span class="spacer"></span>
    ${can('transport.create')&&db.routes.length?`<select class="pick" id="alloc-student"><option value="">Add a student to transport…</option>${notOnTransport.map(s=>`<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} — ${esc(s.admissionNo)}</option>`).join('')}</select>
    <button class="btn btn-p btn-s" id="alloc-new">Allocate</button>`:''}
  </div>
  ${!db.routes.length?'<p class="sub">Add a route before allocating students to transport.</p>':''}

  <div class="tw"><table>
    <thead><tr><th>Student</th><th>Class</th><th>Route</th><th>Stop</th><th></th></tr></thead>
    <tbody>${allocated.map(({a,s,r})=>`<tr>
      <td><div class="who-cell">${avatar(s)}<div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
      <td>${className(CLASSES.find(c=>c.id===s.classId))}</td>
      <td>${r?esc(r.name):'—'}</td>
      <td>${esc(a.stop)}</td>
      <td style="display:flex;gap:6px">
        ${can('transport.edit')?`<button class="btn btn-q btn-s" data-alloc-edit="${s.id}">Reassign</button>
        <button class="btn btn-d btn-s" data-alloc-remove="${s.id}">Remove</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${allocated.length===0?'<p class="sub" style="margin-top:12px">No one is allocated to a route yet.</p>':''}`;
}

function wireTransAllocation(){
  const btn = $('#alloc-new');
  if(btn) btn.addEventListener('click',()=>{
    const sel = $('#alloc-student');
    if(!sel || !sel.value){ toast('Choose a student first.', true); return; }
    openAllocateForm(sel.value);
  });
  document.querySelectorAll('[data-alloc-edit]').forEach(b=>b.addEventListener('click',()=>openAllocateForm(b.dataset.allocEdit)));
  document.querySelectorAll('[data-alloc-remove]').forEach(b=>b.addEventListener('click',()=>{
    const s = db.students.find(x=>x.id===b.dataset.allocRemove);
    db.transportAlloc = db.transportAlloc.filter(a=>a.studentId!==s.id);
    s.transport = false;
    logAudit('transport.allocation', `${s.firstName} ${s.lastName} removed from transport`);
    persist();
    toast('Removed from transport.');
    render();
  }));
}

function openAllocateForm(studentId){
  const s = db.students.find(x=>x.id===studentId);
  const existing = db.transportAlloc.find(a=>a.studentId===studentId);
  const stopsFor = routeId => db.routes.find(r=>r.id===routeId)?.stops || [];
  const startRoute = existing?.routeId || db.routes[0]?.id;
  modal({
    title: existing?'Reassign transport':'Allocate transport', sub:`${s.firstName} ${s.lastName}`,
    body:`<div class="fgrid">
      <div class="f"><label class="req">Route</label><select id="al-route">${db.routes.map(r=>`<option value="${r.id}" ${startRoute===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Stop</label><select id="al-stop">${stopsFor(startRoute).map(st=>`<option ${existing?.stop===st?'selected':''}>${esc(st)}</option>`).join('')}</select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="al-save">${existing?'Save':'Allocate'}</button>`,
    wire(){
      $('#al-route').addEventListener('change',e=>{
        $('#al-stop').innerHTML = stopsFor(e.target.value).map(st=>`<option>${esc(st)}</option>`).join('');
      });
      $('#al-save').addEventListener('click',()=>{
        const routeId = $('#al-route').value, stop = $('#al-stop').value;
        if(!routeId||!stop){ toast('Choose a route and a stop.', true); return; }
        s.transport = true;
        if(existing){ existing.routeId=routeId; existing.stop=stop; }
        else db.transportAlloc.push({studentId, routeId, stop});
        logAudit('transport.allocation', `${s.firstName} ${s.lastName} allocated to ${db.routes.find(r=>r.id===routeId).name}`);
        persist(); closeModal();
        toast('Transport allocated.');
        render();
      });
    },
  });
}

// ---- Maintenance ------------------------------------------------------

function transMaintenanceBody(){
  const logs = [...db.maintenanceLogs].sort((a,b)=>b.date.localeCompare(a.date));
  const due = db.maintenanceLogs.filter(m=>m.status==='DUE');

  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('sPending',40)}<div><div class="v">${due.length}</div><div class="l">Due / in progress</div></div></div>
    <div class="stat">${svg('expense',40)}<div><div class="v">${naira(db.maintenanceLogs.filter(m=>m.status==='DONE').reduce((t,m)=>t+m.cost,0))}</div><div class="l">Spent this term</div></div></div>
  </div>
  <div class="toolbar">
    <span class="spacer"></span>
    ${can('transport.create')&&db.vehicles.length?`<button class="btn btn-y btn-s" id="add-maint">Log maintenance</button>`:''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Vehicle</th><th>Type</th><th>Description</th><th>Date</th><th class="num">Cost</th><th>Status</th><th></th></tr></thead>
    <tbody>${logs.map(m=>{
      const v = db.vehicles.find(x=>x.id===m.vehicleId);
      return `<tr>
        <td style="font-family:var(--mono)">${v?esc(v.plate):'—'}</td>
        <td>${esc(m.type)}</td>
        <td style="font-size:12px;color:var(--muted)">${esc(m.description)}</td>
        <td>${fmtDate(m.date)}</td>
        <td class="num">${nairaFull(m.cost)}</td>
        <td><span class="pill ${m.status==='DONE'?'p-ok':'p-warn'}">${m.status}</span></td>
        <td>${m.status==='DUE'&&can('transport.edit')?`<button class="btn btn-p btn-s" data-maint-done="${m.id}">Mark done</button>`:''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${logs.length===0?'<p class="sub" style="margin-top:12px">No maintenance logged yet.</p>':''}`;
}

function wireTransMaintenance(){
  const add = $('#add-maint'); if(add) add.addEventListener('click',openMaintenanceForm);
  document.querySelectorAll('[data-maint-done]').forEach(b=>b.addEventListener('click',()=>{
    const m = db.maintenanceLogs.find(x=>x.id===b.dataset.maintDone);
    const v = db.vehicles.find(x=>x.id===m.vehicleId);
    m.status='DONE'; m.date=todayISO();
    const ref = `EXP/2026/${String(db.expenses.length+1).padStart(5,'0')}`;
    db.expenses.push({id:uid('exp'), category:'Maintenance & repairs', description:`${m.type} — ${v?v.plate:'—'}: ${m.description}`,
      amount:m.cost, at:todayISO(), ref, status:'APPROVED', recordedBy:ROLES[state.role].name});
    logAudit('transport.maintenance', `${m.type} completed for ${v?v.plate:'—'}`);
    persist();
    toast('Marked done.');
    render();
  }));
}

function openMaintenanceForm(){
  modal({
    title:'Log maintenance',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Vehicle</label><select id="mt-vehicle">${db.vehicles.map(v=>`<option value="${v.id}">${esc(v.plate)} — ${esc(v.model)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Type</label><select id="mt-type">${VEHICLE_MAINT_TYPES.map(t=>`<option>${t}</option>`).join('')}</select></div>
      <div class="f wide"><label class="req">Description</label><input type="text" id="mt-desc" placeholder="Brake pads replaced, front and rear"></div>
      <div class="f"><label class="req">Cost (₦)</label><input type="number" id="mt-cost" min="0"></div>
      <div class="f"><label>Status</label><select id="mt-status"><option value="DONE">Done</option><option value="DUE">Scheduled / due</option></select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="mt-save">Log</button>`,
    wire(){
      $('#mt-save').addEventListener('click',()=>{
        const vehicleId = $('#mt-vehicle').value, type = $('#mt-type').value, description = $('#mt-desc').value.trim();
        const cost = Math.round(Number($('#mt-cost').value)*100), status = $('#mt-status').value;
        if(!description){ toast('Enter a description.', true); return; }
        if(!cost||cost<=0){ toast('Enter a cost.', true); return; }
        const v = db.vehicles.find(x=>x.id===vehicleId);
        db.maintenanceLogs.push({id:uid('mnt'), vehicleId, type, description, cost, date:todayISO(), status});
        if(status==='DONE'){
          const ref = `EXP/2026/${String(db.expenses.length+1).padStart(5,'0')}`;
          db.expenses.push({id:uid('exp'), category:'Maintenance & repairs', description:`${type} — ${v.plate}: ${description}`,
            amount:cost, at:todayISO(), ref, status:'APPROVED', recordedBy:ROLES[state.role].name});
        }
        logAudit('transport.maintenance', `${type} logged for ${v.plate}`);
        persist(); closeModal();
        toast('Maintenance logged.');
        render();
      });
    },
  });
}

// ---- Fuel -----------------------------------------------------------

function transFuelBody(){
  const logs = [...db.fuelLogs].sort((a,b)=>b.date.localeCompare(a.date));
  const totalCost = db.fuelLogs.reduce((t,f)=>t+f.cost,0), totalLitres = db.fuelLogs.reduce((t,f)=>t+f.litres,0);

  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('expense',40)}<div><div class="v">${naira(totalCost)}</div><div class="l">Fuel spend</div></div></div>
    <div class="stat">${svg('transport',40)}<div><div class="v">${totalLitres}L</div><div class="l">Litres logged</div></div></div>
  </div>
  <div class="toolbar">
    <span class="spacer"></span>
    ${can('transport.create')&&db.vehicles.length?`<button class="btn btn-y btn-s" id="add-fuel">Log fuel</button>`:''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Vehicle</th><th>Date</th><th class="num">Litres</th><th class="num">Cost</th><th class="num">Odometer</th></tr></thead>
    <tbody>${logs.map(f=>{
      const v = db.vehicles.find(x=>x.id===f.vehicleId);
      return `<tr>
        <td style="font-family:var(--mono)">${v?esc(v.plate):'—'}</td>
        <td>${fmtDate(f.date)}</td>
        <td class="num">${f.litres}L</td>
        <td class="num">${nairaFull(f.cost)}</td>
        <td class="num">${f.odometer?f.odometer.toLocaleString()+' km':'—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${logs.length===0?'<p class="sub" style="margin-top:12px">No fuel logged yet.</p>':''}`;
}

function wireTransFuel(){
  const add = $('#add-fuel'); if(add) add.addEventListener('click',openFuelForm);
}

function openFuelForm(){
  modal({
    title:'Log fuel',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Vehicle</label><select id="fl-vehicle">${db.vehicles.map(v=>`<option value="${v.id}">${esc(v.plate)} — ${esc(v.model)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Litres</label><input type="number" id="fl-litres" min="1"></div>
      <div class="f"><label class="req">Cost (₦)</label><input type="number" id="fl-cost" min="0"></div>
      <div class="f"><label>Odometer (km)</label><input type="number" id="fl-odo" min="0"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="fl-save">Log</button>`,
    wire(){
      $('#fl-save').addEventListener('click',()=>{
        const vehicleId = $('#fl-vehicle').value, litres = Number($('#fl-litres').value);
        const cost = Math.round(Number($('#fl-cost').value)*100), odometer = Number($('#fl-odo').value)||null;
        if(!litres||litres<=0){ toast('Enter litres.', true); return; }
        if(!cost||cost<=0){ toast('Enter a cost.', true); return; }
        const v = db.vehicles.find(x=>x.id===vehicleId);
        db.fuelLogs.push({id:uid('fuel'), vehicleId, date:todayISO(), litres, cost, odometer, recordedBy:ROLES[state.role].name});
        const ref = `EXP/2026/${String(db.expenses.length+1).padStart(5,'0')}`;
        db.expenses.push({id:uid('exp'), category:'Transport & fuel', description:`Fuel — ${v.plate} (${litres}L)`,
          amount:cost, at:todayISO(), ref, status:'APPROVED', recordedBy:ROLES[state.role].name});
        logAudit('transport.fuel', `${litres}L logged for ${v.plate}`);
        persist(); closeModal();
        toast('Fuel logged.');
        render();
      });
    },
  });
}

function opsHostel(){
  return `
  <div class="grid-stats">
    ${db.hostels.map(h=>{
      const o = hostelOccupancy(h);
      return `<div class="stat">${svg('hostel',40)}<div><div class="v">${o.taken}/${o.total}</div><div class="l">${esc(h.name)}</div></div></div>`;
    }).join('')}
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${db.students.filter(s=>s.boarder).length}</div><div class="l">Boarders</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${naira(db.students.filter(s=>s.boarder).length*9_000_000)}</div><div class="l">Hostel fees billed</div></div></div>
  </div>

  ${db.hostels.map(h=>{
    const o = hostelOccupancy(h);
    return `<div class="block">
      <h2>${esc(h.name)} <small>${h.gender==='M'?'Boys':'Girls'} · ${o.taken} of ${o.total} beds</small></h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px">
        ${h.rooms.map(r=>{
          const taken = r.beds.filter(b=>b.studentId).length;
          const full = taken===r.beds.length;
          return `<div style="border:1px solid var(--rule);border-radius:9px;padding:11px;background:${full?'var(--lilac)':'var(--paper)'}">
            <div style="font-weight:600;font-size:12.5px">Room ${esc(r.number)}</div>
            <div style="font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-top:3px">${taken} / ${r.beds.length} beds</div>
            <div style="display:flex;gap:3px;margin-top:8px">${r.beds.map(b=>
              `<div title="${b.studentId?esc((db.students.find(s=>s.id===b.studentId)||{firstName:'?',lastName:''}).firstName+' '+(db.students.find(s=>s.id===b.studentId)||{lastName:''}).lastName):'Free'}"
                style="flex:1;height:7px;border-radius:3px;background:${b.studentId?'var(--navy)':'var(--rule)'}"></div>`).join('')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('')}

  <p class="note">Beds are allocated by gender automatically. A boarder with no free bed of the right gender is left unallocated and reported, rather than being placed somewhere that would have to be undone.</p>`;
}

/** Five tabs on one module. Catalog owns the item records (barcode, QR,
    kind, location); Transfers relocates an item without touching how much
    of it exists; Purchases is the only place stock ever enters through a
    supplier rather than an ad hoc receipt; Suppliers; Movements is the one
    append-only ledger all of Stock In / Stock Out / Transfer / a received
    PO ultimately write to. */
function opsInventory(){
  const low = lowStock();
  const value = db.items.reduce((t,i)=>t+i.qty*i.cost,0);
  const tabs = [['catalog','Catalog'],['transfers','Transfers'],['purchases','Purchases'],['suppliers','Suppliers'],['movements','Movements']];
  if(!tabs.some(t=>t[0]===state.invTab)) state.invTab = 'catalog';
  const bodies = {catalog:invCatalogBody, transfers:invTransfersBody, purchases:invPurchasesBody, suppliers:invSuppliersBody, movements:invMovementsBody};

  return `
  <div class="grid-stats">
    <div class="stat">${svg('hostel',40)}<div><div class="v">${db.items.length}</div><div class="l">Item lines</div></div></div>
    <div class="stat">${svg('income',40)}<div><div class="v">${naira(value)}</div><div class="l">Stock value</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${low.length}</div><div class="l">At or below reorder</div></div></div>
    <div class="stat">${svg('expense',40)}<div><div class="v">${db.movements.length}</div><div class="l">Movements logged</div></div></div>
  </div>

  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-invtab="${id}" aria-selected="${state.invTab===id}">${l}</button>`).join('')}</div>

  ${(bodies[state.invTab]||invCatalogBody)()}`;
}

// ---- Catalog ---------------------------------------------------------

function invCatalogBody(){
  let list = db.items;
  if(state.invQuery){
    const q = state.invQuery.toLowerCase();
    list = list.filter(i=>`${i.name} ${i.sku} ${i.barcode} ${i.qrCode}`.toLowerCase().includes(q));
  }
  if(state.invCat) list = list.filter(i=>i.cat===state.invCat);
  if(state.invKind) list = list.filter(i=>i.kind===state.invKind);

  return `
  <div class="toolbar" style="margin-top:14px">
    <input type="text" class="search" id="inv-q" placeholder="Search name, SKU, barcode or QR" value="${esc(state.invQuery)}">
    <select class="pick" id="inv-cat"><option value="">All categories</option>${ITEM_CATEGORIES.map(c=>`<option ${state.invCat===c?'selected':''}>${c}</option>`).join('')}</select>
    <select class="pick" id="inv-kind"><option value="">Assets &amp; consumables</option><option value="ASSET" ${state.invKind==='ASSET'?'selected':''}>Assets</option><option value="CONSUMABLE" ${state.invKind==='CONSUMABLE'?'selected':''}>Consumables</option></select>
    <input type="text" class="pick" id="inv-scan" placeholder="Scan barcode/QR, then Enter…" style="width:190px">
    <span class="spacer"></span>
    ${can('inventory.create')?`<button class="btn btn-y btn-s" id="add-item">Add item</button>`:''}
  </div>

  <div class="tw"><table>
    <thead><tr><th>Item</th><th>Category</th><th>Kind</th><th>Location</th><th class="num">In stock</th><th class="num">Reorder</th><th class="num">Value</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.map(i=>`<tr>
      <td><div style="font-weight:500">${esc(i.name)}</div>
        <div class="sm" style="font-family:var(--mono);font-size:10px;color:var(--muted)">${esc(i.sku)} · ${esc(i.barcode)}</div></td>
      <td>${esc(i.cat)}</td>
      <td><span class="pill p-info">${i.kind==='ASSET'?'Asset':'Consumable'}</span></td>
      <td style="font-size:12px;color:var(--muted)">${esc(i.location)}</td>
      <td class="num" style="font-weight:600">${i.qty} <span style="color:var(--muted);font-weight:400">${esc(i.unit)}</span></td>
      <td class="num">${i.reorder}</td>
      <td class="num">${naira(i.qty*i.cost)}</td>
      <td><span class="pill ${i.qty===0?'p-bad':i.qty<=i.reorder?'p-warn':'p-ok'}">${i.qty===0?'OUT':i.qty<=i.reorder?'REORDER':'OK'}</span></td>
      <td style="display:flex;gap:6px">
        ${can('inventory.create')?`<button class="btn btn-p btn-s" data-stock-in="${i.id}">In</button>
        <button class="btn btn-q btn-s" data-stock-out="${i.id}">Out</button>`:''}
        ${can('inventory.edit')?`<button class="btn btn-q btn-s" data-item-edit="${i.id}">Edit</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${list.length===0?'<p class="sub" style="margin-top:12px">No items match.</p>':''}
  <p class="note">Stock movements are append-only. A correction is a compensating movement, never an edit, so the running balance can always be reconstructed from the log — and a shortfall can be traced to the day it appeared.</p>`;
}

function wireInvCatalog(){
  const q = $('#inv-q');
  if(q) q.addEventListener('input',e=>{state.invQuery=e.target.value;const p=e.target.selectionStart;render();const n=$('#inv-q');if(n){n.focus();n.setSelectionRange(p,p);}});
  const cat = $('#inv-cat'); if(cat) cat.addEventListener('change',e=>{state.invCat=e.target.value;render();});
  const kind = $('#inv-kind'); if(kind) kind.addEventListener('change',e=>{state.invKind=e.target.value;render();});
  const scan = $('#inv-scan');
  if(scan) scan.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    const code = e.target.value.trim();
    const item = db.items.find(i=>i.barcode===code || i.qrCode===code || i.sku===code);
    if(!item){ toast('No item with that code.', true); return; }
    state.invQuery = item.name; state.invCat=''; state.invKind=''; render();
    toast(`Found: ${item.name}.`);
  });
  const add = $('#add-item'); if(add) add.addEventListener('click',()=>openItemForm());
  document.querySelectorAll('[data-item-edit]').forEach(b=>b.addEventListener('click',()=>openItemForm(b.dataset.itemEdit)));
  document.querySelectorAll('[data-stock-in]').forEach(b=>b.addEventListener('click',()=>openStockMove('RECEIPT',b.dataset.stockIn)));
  document.querySelectorAll('[data-stock-out]').forEach(b=>b.addEventListener('click',()=>openStockMove('ISSUE',b.dataset.stockOut)));
}

function openItemForm(editId){
  const existing = editId ? db.items.find(x=>x.id===editId) : null;
  modal({
    title: existing?'Edit item':'Add item', wide:true,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Name</label><input type="text" id="it-name" value="${existing?esc(existing.name):''}"><div class="err" id="e-itname"></div></div>
      <div class="f"><label class="req">Category</label><select id="it-cat">${ITEM_CATEGORIES.map(c=>`<option ${existing?.cat===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="f"><label>Kind</label><select id="it-kind">
        <option value="CONSUMABLE" ${existing?.kind!=='ASSET'?'selected':''}>Consumable</option>
        <option value="ASSET" ${existing?.kind==='ASSET'?'selected':''}>Asset</option></select></div>
      <div class="f"><label>Location</label><select id="it-loc">${INVENTORY_LOCATIONS.map(l=>`<option ${existing?.location===l?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Unit</label><input type="text" id="it-unit" value="${existing?esc(existing.unit):''}" placeholder="piece, box, set..."><div class="err" id="e-itunit"></div></div>
      <div class="f"><label class="req">Reorder level</label><input type="number" id="it-reorder" min="0" value="${existing?existing.reorder:0}"><div class="err" id="e-itreorder"></div></div>
      <div class="f"><label class="req">Unit cost (₦)</label><input type="number" id="it-cost" min="0" value="${existing?Math.round(existing.cost/100):''}"><div class="err" id="e-itcost"></div></div>
      <div class="f"><label>Barcode</label><input type="text" id="it-barcode" value="${existing?esc(existing.barcode):`FA-INV-${String(db.items.length+1).padStart(6,'0')}`}"></div>
      <div class="f"><label>QR code</label><input type="text" id="it-qr" value="${existing?esc(existing.qrCode):`QR-FA-${String(db.items.length+1).padStart(6,'0')}`}"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button>
      ${existing&&can('inventory.delete')?`<button class="btn btn-d" id="it-delete">Delete</button>`:''}
      <button class="btn btn-p" id="it-save">${existing?'Save changes':'Add item'}</button>`,
    wire(){
      $('#it-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const name = $('#it-name').value.trim(), unit = $('#it-unit').value.trim();
        const reorder = Number($('#it-reorder').value), cost = Math.round(Number($('#it-cost').value)*100);
        let bad=false;
        if(!name){ $('#e-itname').textContent='Enter a name.'; bad=true; }
        if(!unit){ $('#e-itunit').textContent='Enter a unit.'; bad=true; }
        if(reorder<0||isNaN(reorder)){ $('#e-itreorder').textContent='Enter a reorder level.'; bad=true; }
        if(!cost||cost<=0){ $('#e-itcost').textContent='Enter a unit cost.'; bad=true; }
        if(bad) return;
        const cat = $('#it-cat').value, kind = $('#it-kind').value, location = $('#it-loc').value;
        const barcode = $('#it-barcode').value.trim(), qrCode = $('#it-qr').value.trim();
        if(existing){
          Object.assign(existing, {name, cat, kind, location, unit, reorder, cost, barcode, qrCode});
          logAudit('inventory.item', `${name} updated`);
        } else {
          db.items.push({id:uid('it'), sku:`FA-${String(db.items.length+1).padStart(4,'0')}`,
            name, cat, kind, location, unit, reorder, cost, barcode, qrCode, qty:0});
          logAudit('inventory.item', `${name} added to inventory`);
        }
        persist(); closeModal();
        toast(existing?'Item updated.':'Item added.');
        render();
      });
      const del = $('#it-delete');
      if(del) del.addEventListener('click',()=>{
        if(existing.qty>0){ toast('Item still has stock on hand — issue or transfer it out first.', true); return; }
        db.items = db.items.filter(x=>x.id!==existing.id);
        logAudit('inventory.item', `${existing.name} removed from inventory`);
        persist(); closeModal();
        toast('Item removed.');
        render();
      });
    },
  });
}

function openStockMove(kind, itemId){
  const isIssue = kind==='ISSUE';
  const preset = db.items.find(i=>i.id===itemId);
  modal({
    title: isIssue?'Issue stock':'Receive stock',
    sub: preset?`${esc(preset.name)} · ${preset.qty} ${esc(preset.unit)} in stock`:undefined,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Item</label><select id="mv-item">
        ${db.items.map(i=>`<option value="${i.id}" ${i.id===itemId?'selected':''}>${esc(i.name)} — ${i.qty} ${esc(i.unit)} in stock</option>`).join('')}</select></div>
      <div class="f"><label class="req">Quantity</label><input type="number" id="mv-qty" min="1" value="1"><div class="err" id="e-qty"></div></div>
      <div class="f"><label>Reference</label><input type="text" id="mv-note" placeholder="${isIssue?'Issued to JSS 2 Gold':'Supplier invoice no.'}"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="mv-save">${isIssue?'Issue':'Receive'}</button>`,
    wire(){
      $('#mv-save').addEventListener('click',()=>{
        const item = db.items.find(i=>i.id===$('#mv-item').value);
        const qty = Number($('#mv-qty').value);
        const err = $('#e-qty'); err.textContent='';
        if(!qty || qty<1){ err.textContent='Enter a quantity of at least one.'; return; }
        if(isIssue && qty>item.qty){ err.textContent=`Only ${item.qty} ${item.unit} in stock.`; return; }

        item.qty += isIssue ? -qty : qty;
        db.movements.push({id:uid('mv'), itemId:item.id, kind, qty, at:todayISO(),
          note:$('#mv-note').value.trim()||'—', by:ROLES[state.role].name});
        logAudit('inventory.movement', `${qty} ${item.unit} of ${item.name} ${isIssue?'issued':'received'}`);
        persist(); closeModal();
        toast(`${qty} ${esc(item.unit)} of ${esc(item.name)} ${isIssue?'issued':'received'}. Balance now ${item.qty}.`);
        if(item.qty<=item.reorder){
          toast(`${esc(item.name)} is at or below its reorder level.`, true);
          notify('INVENTORY_OFFICER', 'Low stock', `${item.name} is at ${item.qty} ${item.unit}, at or below the reorder level of ${item.reorder}.`);
        }
        render();
      });
    },
  });
}

// ---- Transfers ------------------------------------------------------

function invTransfersBody(){
  const transfers = db.movements.filter(m=>m.kind==='TRANSFER').sort((a,b)=>b.at.localeCompare(a.at));
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('inventory.create')&&db.items.length?`<button class="btn btn-y btn-s" id="add-transfer">Transfer stock</button>`:''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Item</th><th>From</th><th>To</th><th>Date</th><th>Note</th></tr></thead>
    <tbody>${transfers.map(m=>{
      const it = db.items.find(x=>x.id===m.itemId);
      return `<tr><td>${it?esc(it.name):'—'}</td><td>${esc(m.fromLocation)}</td><td>${esc(m.toLocation)}</td>
        <td>${fmtDate(m.at)}</td><td style="font-size:12px;color:var(--muted)">${esc(m.note)}</td></tr>`;
    }).join('')}</tbody>
  </table></div>
  ${transfers.length===0?'<p class="sub" style="margin-top:12px">No transfers logged yet.</p>':''}
  <p class="note">A transfer moves an item's home location — it never changes how much of it the school owns, only where it is kept.</p>`;
}

function wireInvTransfers(){
  const add = $('#add-transfer'); if(add) add.addEventListener('click',openStockTransferForm);
}

function openStockTransferForm(){
  modal({
    title:'Transfer stock',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Item</label><select id="tr-item">${db.items.map(i=>`<option value="${i.id}">${esc(i.name)} — currently ${esc(i.location)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Move to</label><select id="tr-to">${INVENTORY_LOCATIONS.map(l=>`<option>${l}</option>`).join('')}</select></div>
      <div class="f wide"><label>Note</label><input type="text" id="tr-note" placeholder="Reason for the move"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="tr-save">Transfer</button>`,
    wire(){
      $('#tr-save').addEventListener('click',()=>{
        const item = db.items.find(i=>i.id===$('#tr-item').value);
        const to = $('#tr-to').value;
        if(to===item.location){ toast('Already at that location.', true); return; }
        const from = item.location;
        item.location = to;
        db.movements.push({id:uid('mv'), itemId:item.id, kind:'TRANSFER', qty:item.qty, fromLocation:from, toLocation:to,
          at:todayISO(), note:$('#tr-note').value.trim()||'—', by:ROLES[state.role].name});
        logAudit('inventory.transfer', `${item.name} moved from ${from} to ${to}`);
        persist(); closeModal();
        toast(`${esc(item.name)} moved to ${esc(to)}.`);
        render();
      });
    },
  });
}

// ---- Purchases ------------------------------------------------------

function invPurchasesBody(){
  const pos = [...db.purchaseOrders].sort((a,b)=>b.poNumber.localeCompare(a.poNumber));
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('inventory.create')&&db.suppliers.length?`<button class="btn btn-y btn-s" id="add-po">New purchase order</button>`:''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>PO number</th><th>Supplier</th><th class="num">Lines</th><th class="num">Total</th><th>Expected</th><th>Status</th><th></th></tr></thead>
    <tbody>${pos.map(po=>{
      const sup = db.suppliers.find(s=>s.id===po.supplierId);
      const total = po.items.reduce((t,x)=>t+x.qty*x.unitCost,0);
      return `<tr>
        <td style="font-family:var(--mono);font-size:11.5px">${esc(po.poNumber)}</td>
        <td>${sup?esc(sup.name):'—'}</td>
        <td class="num">${po.items.length}</td>
        <td class="num">${nairaFull(total)}</td>
        <td>${po.expectedDate?fmtDate(po.expectedDate):'—'}</td>
        <td><span class="pill ${po.status==='RECEIVED'?'p-ok':po.status==='ORDERED'?'p-info':po.status==='CANCELLED'?'p-bad':'p-warn'}">${po.status}</span></td>
        <td><button class="btn btn-q btn-s" data-po-view="${po.id}">View</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${pos.length===0?'<p class="sub" style="margin-top:12px">No purchase orders yet.</p>':''}`;
}

function wireInvPurchases(){
  const add = $('#add-po'); if(add) add.addEventListener('click',openPOForm);
  document.querySelectorAll('[data-po-view]').forEach(b=>b.addEventListener('click',()=>openPODetail(b.dataset.poView)));
}

function openPOForm(){
  modal({
    title:'New purchase order', wide:true,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Supplier</label><select id="po-supplier">${db.suppliers.filter(s=>s.status==='ACTIVE').map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Item</label><select id="po-item">${db.items.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select></div>
      <div class="f"><label class="req">Quantity</label><input type="number" id="po-qty" min="1" value="1"></div>
      <div class="f"><label class="req">Unit cost (₦)</label><input type="number" id="po-cost" min="0"></div>
      <div class="f"><label>Expected date</label><input type="date" id="po-expected"></div>
    </div>
    <p class="note">One line per purchase order for now — raise a second PO for a different item.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="po-save">Create draft</button>`,
    wire(){
      $('#po-save').addEventListener('click',()=>{
        const supplierId = $('#po-supplier').value, itemId = $('#po-item').value;
        const qty = Number($('#po-qty').value), unitCost = Math.round(Number($('#po-cost').value)*100);
        if(!qty||qty<1){ toast('Enter a quantity.', true); return; }
        if(!unitCost||unitCost<=0){ toast('Enter a unit cost.', true); return; }
        const poNumber = `PO/2026/${String(db.purchaseOrders.length+1).padStart(5,'0')}`;
        db.purchaseOrders.push({id:uid('po'), poNumber, supplierId, items:[{itemId,qty,unitCost}],
          status:'DRAFT', orderedOn:null, expectedDate:$('#po-expected').value||null, createdBy:ROLES[state.role].name, approvedBy:null});
        logAudit('inventory.purchase', `${poNumber} created`);
        persist(); closeModal();
        toast('Purchase order created as a draft.');
        render();
      });
    },
  });
}

function openPODetail(id){
  const po = db.purchaseOrders.find(x=>x.id===id);
  const sup = db.suppliers.find(s=>s.id===po.supplierId);
  const total = po.items.reduce((t,x)=>t+x.qty*x.unitCost,0);
  modal({
    title: po.poNumber, sub:`${sup?esc(sup.name):'—'} · ${po.status}`, wide:true,
    body:`<div class="tw"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line total</th></tr></thead>
      <tbody>${po.items.map(x=>{
        const it = db.items.find(i=>i.id===x.itemId);
        return `<tr><td>${it?esc(it.name):'—'}</td><td class="num">${x.qty}</td><td class="num">${nairaFull(x.unitCost)}</td><td class="num">${nairaFull(x.qty*x.unitCost)}</td></tr>`;
      }).join('')}
      <tr><td colspan="3" style="font-weight:600">Total</td><td class="num" style="font-weight:600">${nairaFull(total)}</td></tr>
      </tbody></table></div>
    <dl class="kv" style="margin-top:14px">
      <dt>Expected</dt><dd>${po.expectedDate?fmtDate(po.expectedDate):'—'}</dd>
      <dt>Created by</dt><dd>${esc(po.createdBy)}</dd>
      <dt>Approved by</dt><dd>${po.approvedBy?esc(po.approvedBy):'<span style="color:var(--muted)">Not yet approved</span>'}</dd>
    </dl>`,
    foot:`<button class="btn btn-q" data-close>Close</button>
      ${po.status==='DRAFT'&&can('inventory.approve')?`<button class="btn btn-p" id="po-approve">Approve &amp; order</button>`:''}
      ${['DRAFT','ORDERED'].includes(po.status)&&can('inventory.reject')?`<button class="btn btn-d" id="po-cancel">Cancel</button>`:''}
      ${po.status==='ORDERED'&&can('inventory.create')?`<button class="btn btn-p" id="po-receive">Receive delivery</button>`:''}`,
    wire(){
      const ap = $('#po-approve');
      if(ap) ap.addEventListener('click',()=>{
        po.status='ORDERED'; po.orderedOn=todayISO(); po.approvedBy=ROLES[state.role].name;
        logAudit('inventory.purchase', `${po.poNumber} approved and ordered`);
        persist(); closeModal();
        toast('Purchase order approved and marked as ordered.');
        render();
      });
      const cn = $('#po-cancel');
      if(cn) cn.addEventListener('click',()=>{
        po.status='CANCELLED';
        logAudit('inventory.purchase', `${po.poNumber} cancelled`);
        persist(); closeModal();
        toast('Purchase order cancelled.');
        render();
      });
      const rc = $('#po-receive');
      if(rc) rc.addEventListener('click',()=>{
        po.items.forEach(x=>{
          const it = db.items.find(i=>i.id===x.itemId);
          if(!it) return;
          it.qty += x.qty;
          db.movements.push({id:uid('mv'), itemId:it.id, kind:'RECEIPT', qty:x.qty, at:todayISO(),
            note:`${po.poNumber} — ${sup?sup.name:'supplier'}`, by:ROLES[state.role].name});
        });
        po.status='RECEIVED';
        logAudit('inventory.purchase', `${po.poNumber} received into stock`);
        persist(); closeModal();
        toast('Delivery received — stock updated.');
        render();
      });
    },
  });
}

// ---- Suppliers ------------------------------------------------------

function invSuppliersBody(){
  const active = db.suppliers.filter(s=>s.status==='ACTIVE');
  const archived = db.suppliers.filter(s=>s.status==='ARCHIVED');
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('inventory.create')?`<button class="btn btn-y btn-s" id="add-supplier">Add supplier</button>`:''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Category</th><th></th></tr></thead>
    <tbody>${active.map(s=>`<tr>
      <td style="font-weight:500">${esc(s.name)}</td><td>${esc(s.contact)}</td>
      <td style="font-family:var(--mono);font-size:12px">${esc(s.phone)}</td><td>${esc(s.category)}</td>
      <td style="display:flex;gap:6px">
        ${can('inventory.edit')?`<button class="btn btn-q btn-s" data-supplier-edit="${s.id}">Edit</button>`:''}
        ${can('inventory.delete')?`<button class="btn btn-d btn-s" data-supplier-archive="${s.id}">Archive</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${active.length===0?'<p class="sub" style="margin-top:12px">No suppliers yet.</p>':''}
  ${archived.length?`<div class="block"><h2>Archived <small>${archived.length}</small></h2>
    <div class="tw"><table><thead><tr><th>Name</th><th>Category</th><th></th></tr></thead>
    <tbody>${archived.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.category)}</td>
      <td>${can('inventory.restore')?`<button class="btn btn-q btn-s" data-supplier-restore="${s.id}">Restore</button>`:''}</td></tr>`).join('')}</tbody>
    </table></div></div>`:''}`;
}

function wireInvSuppliers(){
  const add = $('#add-supplier'); if(add) add.addEventListener('click',()=>openSupplierForm());
  document.querySelectorAll('[data-supplier-edit]').forEach(b=>b.addEventListener('click',()=>openSupplierForm(b.dataset.supplierEdit)));
  document.querySelectorAll('[data-supplier-archive]').forEach(b=>b.addEventListener('click',()=>{
    const s = db.suppliers.find(x=>x.id===b.dataset.supplierArchive);
    s.status='ARCHIVED';
    logAudit('inventory.supplier', `${s.name} archived`);
    persist();
    toast('Supplier archived.');
    render();
  }));
  document.querySelectorAll('[data-supplier-restore]').forEach(b=>b.addEventListener('click',()=>{
    const s = db.suppliers.find(x=>x.id===b.dataset.supplierRestore);
    s.status='ACTIVE';
    logAudit('inventory.supplier', `${s.name} restored`);
    persist();
    toast('Supplier restored.');
    render();
  }));
}

function openSupplierForm(editId){
  const existing = editId ? db.suppliers.find(x=>x.id===editId) : null;
  modal({
    title: existing?'Edit supplier':'Add supplier',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Name</label><input type="text" id="sp-name" value="${existing?esc(existing.name):''}"><div class="err" id="e-spname"></div></div>
      <div class="f"><label class="req">Contact person</label><input type="text" id="sp-contact" value="${existing?esc(existing.contact):''}"><div class="err" id="e-spcontact"></div></div>
      <div class="f"><label class="req">Phone</label><input type="text" id="sp-phone" value="${existing?esc(existing.phone):''}" placeholder="08012345678"><div class="err" id="e-spphone"></div></div>
      <div class="f"><label>Email</label><input type="text" id="sp-email" value="${existing?esc(existing.email):''}"></div>
      <div class="f"><label>Category</label><select id="sp-cat">${ITEM_CATEGORIES.map(c=>`<option ${existing?.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="sp-save">${existing?'Save changes':'Add supplier'}</button>`,
    wire(){
      $('#sp-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const name = $('#sp-name').value.trim(), contact = $('#sp-contact').value.trim(), phone = $('#sp-phone').value.trim();
        let bad=false;
        if(!name){ $('#e-spname').textContent='Enter a name.'; bad=true; }
        if(!contact){ $('#e-spcontact').textContent='Enter a contact person.'; bad=true; }
        if(!phone){ $('#e-spphone').textContent='Enter a phone number.'; bad=true; }
        if(bad) return;
        const email = $('#sp-email').value.trim(), category = $('#sp-cat').value;
        if(existing){
          Object.assign(existing, {name, contact, phone, email, category});
          logAudit('inventory.supplier', `${name} updated`);
        } else {
          db.suppliers.push({id:uid('sup'), name, contact, phone, email, category, status:'ACTIVE'});
          logAudit('inventory.supplier', `${name} added`);
        }
        persist(); closeModal();
        toast(existing?'Supplier updated.':'Supplier added.');
        render();
      });
    },
  });
}

// ---- Movements --------------------------------------------------------

function invMovementsBody(){
  const rows = [...db.movements].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,200);
  return `
  <div class="toolbar" style="margin-top:14px;justify-content:flex-end">${can('inventory.print')?`<button class="btn btn-q" id="print-inv-mv">Print</button>`:''}</div>
  <div class="tw"><table>
    <thead><tr><th>Item</th><th>Kind</th><th class="num">Qty</th><th>Date</th><th>Note</th><th>By</th></tr></thead>
    <tbody>${rows.map(m=>{
      const it = db.items.find(x=>x.id===m.itemId);
      return `<tr>
        <td>${it?esc(it.name):'—'}</td>
        <td><span class="pill ${m.kind==='RECEIPT'?'p-ok':m.kind==='ISSUE'?'p-warn':'p-info'}">${m.kind}</span></td>
        <td class="num">${m.qty}</td>
        <td>${fmtDate(m.at)}</td>
        <td style="font-size:12px;color:var(--muted)">${esc(m.note)}${m.kind==='TRANSFER'?` (${esc(m.fromLocation)} → ${esc(m.toLocation)})`:''}</td>
        <td style="font-size:12px">${esc(m.by)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${db.movements.length>200?`<p class="note">Showing the latest 200 of ${db.movements.length}.</p>`:''}
  ${rows.length===0?'<p class="sub" style="margin-top:12px">No movements logged yet.</p>':''}`;
}

function wireInvMovements(){
  const b = $('#print-inv-mv'); if(b) b.addEventListener('click',()=>window.print());
}

PAGES.operations_wire = () => {
  document.querySelectorAll('[data-otab]').forEach(b=>b.addEventListener('click',()=>{state.opsTab=b.dataset.otab;render();}));
  document.querySelectorAll('[data-libtab]').forEach(b=>b.addEventListener('click',()=>{state.libTab=b.dataset.libtab;render();}));
  wireLibCatalog(); wireLibLoans(); wireLibReservations(); wireLibFines();

  document.querySelectorAll('[data-transtab]').forEach(b=>b.addEventListener('click',()=>{state.transTab=b.dataset.transtab;render();}));
  wireTransRoutes(); wireTransVehicles(); wireTransDrivers(); wireTransAllocation(); wireTransMaintenance(); wireTransFuel();

  document.querySelectorAll('[data-invtab]').forEach(b=>b.addEventListener('click',()=>{state.invTab=b.dataset.invtab;render();}));
  wireInvCatalog(); wireInvTransfers(); wireInvPurchases(); wireInvSuppliers(); wireInvMovements();
};

// ----------------------------------------------------------- communication --

/** Seven tabs on one module. Announcements is open to anyone with
    communication.view; the broadcast/push/messaging tabs need
    communication.create (a parent holds it too, scoped to their own
    children via visibleStudents() — the same scoping every other module
    already relies on, not a special case built for this one); Emergency
    Alerts needs communication.approve, the same bar the app already sets
    for "acts on behalf of the whole school" elsewhere. */
PAGES.communication = () => {
  const canMessage = can('communication.create');
  const isParentRole = ROLES[state.role].scope === 'OWN_RECORDS';
  const tabs = [
    ['announcements','Announcements'],
    ...(canMessage && !isParentRole ? [['sms','SMS Broadcast'],['email','Email Broadcast'],['push','Push Notifications'],['teachermsg','Teacher Messages']] : []),
    ...(canMessage ? [['parentmsg','Parent Messages']] : []),
    ...(can('communication.approve') ? [['emergency','Emergency Alerts']] : []),
  ];
  if(!tabs.some(t=>t[0]===state.commTab)) state.commTab = 'announcements';
  const bodies = {announcements:commAnnouncementsBody, sms:commSmsBody, email:commEmailBody, push:commPushBody,
    parentmsg:commParentMsgBody, teachermsg:commTeacherMsgBody, emergency:commEmergencyBody};

  return `
  <div class="phead">
    <div><h1>Communication</h1><p>Announcements reach the notice board and the parent portal. Messages between parents and staff stay visible to management, which is a safeguarding requirement, not a surveillance one.</p></div>
  </div>

  <div class="grid-stats">
    <div class="stat">${svg('notice',40)}<div><div class="v">${db.notices.length}</div><div class="l">Notices posted</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${new Set(db.students.map(s=>s.guardianPhone)).size}</div><div class="l">Parent contacts</div></div></div>
    <div class="stat">${svg('attendance',40)}<div><div class="v">${db.students.filter(s=>{const r=attendanceRate(s.id);return r!==null&&r<75;}).length}</div><div class="l">Attendance alerts due</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${db.students.filter(s=>feeSummary(s).balance>0).length}</div><div class="l">Fee reminders due</div></div></div>
  </div>

  <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" data-commtab="${id}" aria-selected="${state.commTab===id}">${l}</button>`).join('')}</div>

  ${(bodies[state.commTab]||commAnnouncementsBody)()}`;
};

PAGES.communication_wire = () => {
  document.querySelectorAll('[data-commtab]').forEach(b=>b.addEventListener('click',()=>{state.commTab=b.dataset.commtab;render();}));
  const wireFns = {announcements:wireCommAnnouncements, sms:wireCommSms, email:wireCommEmail, push:wireCommPush,
    parentmsg:wireCommParentMsg, teachermsg:wireCommTeacherMsg, emergency:wireCommEmergency};
  (wireFns[state.commTab]||wireCommAnnouncements)();
};

// ---- Announcements -----------------------------------------------------

function commAnnouncementsBody(){
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('communication.create')?'<button class="btn btn-y btn-s" id="new-notice">Post a notice</button>':''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Title</th><th>Details</th><th>When</th></tr></thead>
    <tbody>${db.notices.map(n=>`<tr>
      <td style="font-weight:500">${esc(n.title)}</td>
      <td style="font-size:12.5px;color:var(--muted);max-width:340px">${esc(n.body)}</td>
      <td style="white-space:nowrap">${esc(n.when)}</td></tr>`).join('')}</tbody>
  </table></div>
  ${db.notices.length===0?'<p class="sub" style="margin-top:12px">No notices posted.</p>':''}`;
}

function wireCommAnnouncements(){
  const nn = $('#new-notice'); if(nn) nn.addEventListener('click',()=>openNoticeForm());
}

// ---- SMS / Email broadcast ---------------------------------------------

const BROADCAST_AUDIENCES = [
  ['all','All parents'],['owing','Parents with an outstanding balance'],
  ['lowatt','Parents of students below 75% attendance'],['boarders','Parents of boarders'],
];
function broadcastAudienceCount(a){
  if(a==='owing')    return db.students.filter(s=>feeSummary(s).balance>0).length;
  if(a==='lowatt')   return db.students.filter(s=>{const r=attendanceRate(s.id);return r!==null&&r<75;}).length;
  if(a==='boarders') return db.students.filter(s=>s.boarder).length;
  return db.students.length;
}

function commSmsBody(){
  const sent = db.messages.filter(m=>m.channel==='sms').sort((a,b)=>b.at.localeCompare(a.at));
  return `
  <div class="block" style="margin-top:14px">
    <h2>SMS Broadcast <small>₦4.00 a page, every send is estimated first</small></h2>
    <p class="sub">Pick an audience and see what it will cost before anything is sent.</p>
    <div class="fgrid">
      <div class="f"><label>Audience</label><select id="sms-aud">${BROADCAST_AUDIENCES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="f wide"><label>Message</label><textarea id="sms-msg" rows="3" placeholder="Keep it under 160 characters to stay within one SMS page."></textarea></div>
    </div>
    <div id="sms-est" class="note" style="margin-top:12px"></div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-p" id="sms-send">Estimate and send</button></div>
  </div>
  <div class="block">
    <h2>Sent <small>${sent.length}</small></h2>
    ${sent.length?`<div class="tw"><table><thead><tr><th>Message</th><th>Audience</th><th class="num">Recipients</th><th>Date</th></tr></thead>
    <tbody>${sent.map(m=>`<tr><td style="font-size:12.5px;max-width:300px">${esc(m.body)}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(m.audience)}</td><td class="num">${m.count}</td><td>${fmtDate(m.at)}</td></tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No SMS broadcasts sent yet.</p>'}
  </div>`;
}

function wireCommSms(){
  const estimate = () => {
    const audEl = $('#sms-aud'), msgEl = $('#sms-msg');
    if(!audEl) return;
    const n = broadcastAudienceCount(audEl.value);
    const pages = Math.max(1, Math.ceil((msgEl.value.length||1)/160));
    const cost = n*pages*400;
    const out = $('#sms-est');
    if(out) out.innerHTML = `<b>${n}</b> recipient${n===1?'':'s'} · ${msgEl.value.length} character${msgEl.value.length===1?'':'s'} · ${pages} page${pages===1?'':'s'} each · estimated cost <b>${naira(cost)}</b>` +
      (pages>1?' — shortening the message below 160 characters would halve the cost.':'');
  };
  const aud = $('#sms-aud'); if(aud) aud.addEventListener('change',estimate);
  const msg = $('#sms-msg'); if(msg) msg.addEventListener('input',estimate);
  estimate();
  const send = $('#sms-send');
  if(send) send.addEventListener('click',()=>{
    const body = $('#sms-msg').value.trim();
    if(!body){ toast('Write the message before sending.', true); return; }
    const aud = $('#sms-aud').value, n = broadcastAudienceCount(aud);
    db.messages.push({id:uid('msg'), body, audience:aud, channel:'sms', count:n, at:todayISO()});
    logAudit('communication.broadcast', `SMS sent to ${n} recipient${n===1?'':'s'} (${aud})`);
    persist();
    toast(`Queued to ${n} recipient${n===1?'':'s'}. Delivery runs on the worker, so a slow gateway will not hold up the school.`);
    render();
  });
}

function commEmailBody(){
  const sent = db.messages.filter(m=>m.channel==='email').sort((a,b)=>b.at.localeCompare(a.at));
  return `
  <div class="block" style="margin-top:14px">
    <h2>Email Broadcast <small>No per-send cost</small></h2>
    <div class="fgrid">
      <div class="f"><label>Audience</label><select id="em-aud">${BROADCAST_AUDIENCES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="f wide"><label class="req">Subject</label><input type="text" id="em-subject"><div class="err" id="e-emsubject"></div></div>
      <div class="f wide"><label class="req">Message</label><textarea id="em-msg" rows="5"></textarea><div class="err" id="e-emmsg"></div></div>
    </div>
    <div id="em-est" class="note" style="margin-top:12px"></div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-p" id="em-send">Send email</button></div>
  </div>
  <div class="block">
    <h2>Sent <small>${sent.length}</small></h2>
    ${sent.length?`<div class="tw"><table><thead><tr><th>Subject</th><th>Audience</th><th class="num">Recipients</th><th>Date</th></tr></thead>
    <tbody>${sent.map(m=>`<tr><td style="font-size:12.5px;max-width:300px">${esc(m.subject)}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(m.audience)}</td><td class="num">${m.count}</td><td>${fmtDate(m.at)}</td></tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No emails sent yet.</p>'}
  </div>`;
}

function wireCommEmail(){
  const estimate = () => {
    const audEl = $('#em-aud'); if(!audEl) return;
    const n = broadcastAudienceCount(audEl.value);
    const out = $('#em-est'); if(out) out.innerHTML = `<b>${n}</b> recipient${n===1?'':'s'} on file.`;
  };
  const aud = $('#em-aud'); if(aud) aud.addEventListener('change',estimate);
  estimate();
  const send = $('#em-send');
  if(send) send.addEventListener('click',()=>{
    document.querySelectorAll('.err').forEach(e=>e.textContent='');
    const subject = $('#em-subject').value.trim(), body = $('#em-msg').value.trim();
    let bad=false;
    if(!subject){ $('#e-emsubject').textContent='Enter a subject.'; bad=true; }
    if(!body){ $('#e-emmsg').textContent='Write the message.'; bad=true; }
    if(bad) return;
    const aud = $('#em-aud').value, n = broadcastAudienceCount(aud);
    db.messages.push({id:uid('msg'), subject, body, audience:aud, channel:'email', count:n, at:todayISO()});
    logAudit('communication.broadcast', `Email sent to ${n} recipient${n===1?'':'s'} — ${subject}`);
    persist();
    toast(`Queued to ${n} recipient${n===1?'':'s'}.`);
    render();
  });
}

// ---- Push notifications --------------------------------------------------

function commPushBody(){
  const recent = [...db.notifications].slice(0,50);
  return `
  <div class="block" style="margin-top:14px">
    <h2>Send push notification</h2>
    <p class="sub">Delivered straight to the bell icon for whoever holds the chosen role — no gateway, no cost, no delay.</p>
    <div class="fgrid">
      <div class="f"><label>To</label><select id="pn-to">
        <option value="ALL">Everyone</option>
        ${Object.keys(ROLES).map(r=>`<option value="${r}">${esc(ROLES[r].title)}</option>`).join('')}
      </select></div>
      <div class="f wide"><label class="req">Title</label><input type="text" id="pn-title"><div class="err" id="e-pntitle"></div></div>
      <div class="f wide"><label class="req">Body</label><textarea id="pn-body" rows="2"></textarea><div class="err" id="e-pnbody"></div></div>
    </div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-p" id="pn-send">Send</button></div>
  </div>
  <div class="block">
    <h2>Recent <small>${db.notifications.length} total</small></h2>
    <div class="tw"><table><thead><tr><th>To</th><th>Title</th><th>Body</th><th>Sent</th><th></th></tr></thead>
    <tbody>${recent.map(n=>`<tr>
      <td><span class="pill p-info">${n.to==='ALL'?'Everyone':esc(ROLES[n.to]?.title||n.to)}</span></td>
      <td style="font-weight:500">${esc(n.title)}</td>
      <td style="font-size:12px;color:var(--muted);max-width:260px">${esc(n.body)}</td>
      <td>${fmtDateTime(n.at)}</td>
      <td>${n.read?'<span class="pill p-mute">READ</span>':'<span class="pill p-warn">UNREAD</span>'}</td>
    </tr>`).join('')}</tbody></table></div>
    ${db.notifications.length===0?'<p class="sub" style="margin-top:12px">Nothing sent yet.</p>':''}
  </div>`;
}

function wireCommPush(){
  const send = $('#pn-send');
  if(send) send.addEventListener('click',()=>{
    document.querySelectorAll('.err').forEach(e=>e.textContent='');
    const title = $('#pn-title').value.trim(), body = $('#pn-body').value.trim();
    let bad=false;
    if(!title){ $('#e-pntitle').textContent='Enter a title.'; bad=true; }
    if(!body){ $('#e-pnbody').textContent='Write the notification.'; bad=true; }
    if(bad) return;
    const to = $('#pn-to').value;
    notify(to, title, body);
    logAudit('communication.push', `Push notification sent to ${to} — ${title}`);
    persist();
    toast('Notification sent.');
    render();
  });
}

// ---- Parent / teacher messaging ------------------------------------------

const threadsFor = kind => db.messageThreads.filter(t=>t.kind===kind).sort((a,b)=>b.lastAt.localeCompare(a.lastAt));

function commParentMsgBody(){
  const mine = visibleStudents();
  const threads = threadsFor('PARENT').filter(t=>mine.some(s=>s.id===t.studentId))
    .map(t=>({t, s:db.students.find(s=>s.id===t.studentId)})).filter(x=>x.s);

  return `
  <div class="toolbar" style="margin-top:14px">
    <select class="pick" id="pmsg-student"><option value="">Start a thread about…</option>${mine.map(s=>`<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} — ${esc(s.admissionNo)}</option>`).join('')}</select>
    <button class="btn btn-p btn-s" id="pmsg-new">Start thread</button>
  </div>
  <div class="tw"><table>
    <thead><tr><th>Student</th><th>Subject</th><th class="num">Messages</th><th>Last activity</th><th></th></tr></thead>
    <tbody>${threads.map(({t,s})=>`<tr>
      <td><div class="who-cell">${avatar(s)}<div><div class="nm">${esc(s.firstName)} ${esc(s.lastName)}</div><div class="sm">${esc(s.admissionNo)}</div></div></div></td>
      <td>${esc(t.subject)}</td>
      <td class="num">${t.posts.length}</td>
      <td>${fmtDateTime(t.lastAt)}</td>
      <td><button class="btn btn-q btn-s" data-thread-open="${t.id}">Open</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${threads.length===0?'<p class="sub" style="margin-top:12px">No conversations yet.</p>':''}`;
}

function commTeacherMsgBody(){
  const threads = threadsFor('TEACHER').map(t=>({t, m:db.staff.find(x=>x.id===t.staffId)})).filter(x=>x.m);
  const eligible = db.staff.filter(m=>m.status==='ACTIVE');
  return `
  <div class="toolbar" style="margin-top:14px">
    <select class="pick" id="tmsg-staff"><option value="">Start a thread with…</option>${eligible.map(m=>`<option value="${m.id}">${esc(m.firstName)} ${esc(m.lastName)} — ${esc(m.position)}</option>`).join('')}</select>
    <button class="btn btn-p btn-s" id="tmsg-new">Start thread</button>
  </div>
  <div class="tw"><table>
    <thead><tr><th>Staff</th><th>Subject</th><th class="num">Messages</th><th>Last activity</th><th></th></tr></thead>
    <tbody>${threads.map(({t,m})=>`<tr>
      <td><div class="who-cell">${avatar(m)}<div><div class="nm">${esc(m.firstName)} ${esc(m.lastName)}</div><div class="sm">${esc(m.position)}</div></div></div></td>
      <td>${esc(t.subject)}</td>
      <td class="num">${t.posts.length}</td>
      <td>${fmtDateTime(t.lastAt)}</td>
      <td><button class="btn btn-q btn-s" data-thread-open="${t.id}">Open</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${threads.length===0?'<p class="sub" style="margin-top:12px">No conversations yet.</p>':''}`;
}

function wireCommParentMsg(){
  const btn = $('#pmsg-new');
  if(btn) btn.addEventListener('click',()=>{
    const sel = $('#pmsg-student');
    if(!sel || !sel.value){ toast('Choose who this is about first.', true); return; }
    openThreadForm('PARENT', sel.value);
  });
  document.querySelectorAll('[data-thread-open]').forEach(b=>b.addEventListener('click',()=>openThreadView(b.dataset.threadOpen)));
}

function wireCommTeacherMsg(){
  const btn = $('#tmsg-new');
  if(btn) btn.addEventListener('click',()=>{
    const sel = $('#tmsg-staff');
    if(!sel || !sel.value){ toast('Choose a staff member first.', true); return; }
    openThreadForm('TEACHER', sel.value);
  });
  document.querySelectorAll('[data-thread-open]').forEach(b=>b.addEventListener('click',()=>openThreadView(b.dataset.threadOpen)));
}

function openThreadForm(kind, targetId){
  const isParent = kind==='PARENT';
  modal({
    title: isParent?'Start a conversation':'Message a staff member',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Subject</label><input type="text" id="th-subject"><div class="err" id="e-thsubject"></div></div>
      <div class="f wide"><label class="req">Message</label><textarea id="th-body" rows="4"></textarea><div class="err" id="e-thbody"></div></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="th-save">Send</button>`,
    wire(){
      $('#th-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const subject = $('#th-subject').value.trim(), body = $('#th-body').value.trim();
        let bad=false;
        if(!subject){ $('#e-thsubject').textContent='Enter a subject.'; bad=true; }
        if(!body){ $('#e-thbody').textContent='Write a message.'; bad=true; }
        if(bad) return;
        const post = {id:uid('tp'), by:ROLES[state.role].name, byRole:state.role, body, at:new Date().toISOString()};
        const thread = {id:uid('th'), kind, subject, posts:[post], lastAt:post.at,
          ...(isParent?{studentId:targetId}:{staffId:targetId})};
        db.messageThreads.unshift(thread);
        if(isParent){
          const s = db.students.find(x=>x.id===targetId);
          if((ROLES.PARENT.childIds||[]).includes(targetId)) notify('PARENT', subject, body);
          logAudit('communication.message', `Thread started about ${s.firstName} ${s.lastName} — ${subject}`);
        } else {
          const m = db.staff.find(x=>x.id===targetId);
          logAudit('communication.message', `Thread started with ${m.firstName} ${m.lastName} — ${subject}`);
        }
        persist(); closeModal();
        toast('Message sent.');
        render();
      });
    },
  });
}

function openThreadView(threadId){
  const t = db.messageThreads.find(x=>x.id===threadId);
  const isParent = t.kind==='PARENT';
  const who = isParent ? db.students.find(s=>s.id===t.studentId) : db.staff.find(m=>m.id===t.staffId);
  modal({
    title: t.subject, sub: who?`${esc(who.firstName)} ${esc(who.lastName)}`:undefined, wide:true,
    body:`<div style="display:flex;flex-direction:column;gap:12px;max-height:340px;overflow-y:auto">
      ${t.posts.map(p=>`<div style="background:var(--tint);border-radius:9px;padding:10px 12px">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:11.5px;color:var(--muted)">
          <b style="color:var(--ink)">${esc(p.by)}</b><span>${fmtDateTime(p.at)}</span></div>
        <div style="font-size:12.5px;margin-top:4px">${esc(p.body)}</div>
      </div>`).join('')}
    </div>
    ${can('communication.create')?`<div class="fgrid" style="margin-top:14px">
      <div class="f wide"><label>Reply</label><textarea id="th-reply" rows="3"></textarea></div>
    </div>`:''}`,
    foot:`<button class="btn btn-q" data-close>Close</button>
      ${can('communication.create')?`<button class="btn btn-p" id="th-reply-save">Reply</button>`:''}`,
    wire(){
      const r = $('#th-reply-save');
      if(r) r.addEventListener('click',()=>{
        const body = $('#th-reply').value.trim();
        if(!body){ toast('Write a reply first.', true); return; }
        const post = {id:uid('tp'), by:ROLES[state.role].name, byRole:state.role, body, at:new Date().toISOString()};
        t.posts.push(post); t.lastAt = post.at;
        if(isParent && (ROLES.PARENT.childIds||[]).includes(t.studentId)) notify('PARENT', t.subject, body);
        logAudit('communication.message', `Reply added to "${t.subject}"`);
        persist(); closeModal();
        toast('Reply sent.');
        render();
      });
    },
  });
}

// ---- Emergency alerts ------------------------------------------------

function commEmergencyBody(){
  const sent = [...db.emergencyAlerts].sort((a,b)=>b.at.localeCompare(a.at));
  return `
  <div class="block" style="margin-top:14px;border-color:#EBCECC;background:var(--clay-soft)">
    <h2 style="color:var(--clay)">Send emergency alert</h2>
    <p class="sub" style="color:#7A2420">Reaches every parent and every staff member at once, by SMS and push notification, immediately — no cost estimate, no audience picker.</p>
    <div class="fgrid" style="background:var(--paper);border-radius:9px;padding:14px">
      <div class="f wide"><label class="req">Title</label><input type="text" id="ea-title"><div class="err" id="e-eatitle"></div></div>
      <div class="f wide"><label class="req">Message</label><textarea id="ea-body" rows="3"></textarea><div class="err" id="e-eabody"></div></div>
    </div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-d" id="ea-send">Send emergency alert now</button></div>
  </div>
  <div class="block">
    <h2>Sent <small>${sent.length}</small></h2>
    ${sent.length?`<div class="tw"><table><thead><tr><th>Title</th><th>Message</th><th>Sent by</th><th>When</th></tr></thead>
    <tbody>${sent.map(a=>`<tr><td style="font-weight:600">${esc(a.title)}</td>
      <td style="font-size:12.5px;max-width:320px">${esc(a.body)}</td><td>${esc(a.sentBy)}</td><td>${fmtDateTime(a.at)}</td></tr>`).join('')}</tbody>
    </table></div>`:'<p class="sub">No emergency alerts sent — hopefully it stays that way.</p>'}
  </div>`;
}

function wireCommEmergency(){
  const send = $('#ea-send');
  if(send) send.addEventListener('click',()=>{
    document.querySelectorAll('.err').forEach(e=>e.textContent='');
    const title = $('#ea-title').value.trim(), body = $('#ea-body').value.trim();
    let bad=false;
    if(!title){ $('#e-eatitle').textContent='Enter a title.'; bad=true; }
    if(!body){ $('#e-eabody').textContent='Write the alert.'; bad=true; }
    if(bad) return;
    const at = new Date().toISOString();
    db.emergencyAlerts.unshift({id:uid('ea'), title, body, sentBy:ROLES[state.role].name, at});
    notify('ALL', `EMERGENCY: ${title}`, body);
    const n = db.students.length;
    db.messages.push({id:uid('msg'), body:`EMERGENCY: ${title} — ${body}`, audience:'all', channel:'sms', count:n, at:todayISO()});
    logAudit('communication.emergency', `Emergency alert sent — ${title}`);
    persist();
    toast('Emergency alert sent to everyone.');
    render();
  });
}

// ------------------------------------------------------------------ website --
/*  Module 13. The brief was explicit: the school already has a website, and it
    must not be replaced. So this is a content editor bolted onto the existing
    site, not a rebuild of it.

    `isLegacy` marks a path that already exists and is linked from Google, a
    printed prospectus, or a WhatsApp group. Those URLs are locked — the CMS
    will not let anyone rename them, because the traffic they carry took years
    to earn and vanishes the moment the path changes.                          */

/** Seven tabs on one module. Every page's Homepage/Admissions/Academics/
    Leadership/Downloads/Contact content lives under one "Pages" tab as
    distinct page types sharing one editor, rather than a separate screen
    per type — SEO fields live there too, since a page's search listing is
    a property of the page, not a separate settings surface. */
PAGES.website = () => {
  const tabs = [['pages','Pages'],['news','News'],['events','Events'],['gallery','Gallery'],
    ['media','Media Library'],['testimonials','Testimonials'],['enquiries','Enquiries']];
  if(!tabs.some(t=>t[0]===state.webTab)) state.webTab='pages';
  const newEnq = db.enquiries.filter(e=>!e.handled).length;
  const bodies = {pages:webPagesBody, news:webNewsBody, events:webEventsBody, gallery:webGalleryBody,
    media:webMediaBody, testimonials:webTestimonialsBody, enquiries:webEnquiriesBody};

  return `
  <div class="phead">
    <div><h1>Website</h1>
      <p>Fadesrek Academy's public site, edited here. Existing pages keep their addresses — the ERP adds pages alongside them rather than replacing the site.</p></div>
    <a class="btn btn-q" href="#" id="view-site">View live site</a>
  </div>
  <div class="tabs">${tabs.map(([id,l])=>
    `<button class="tab" data-webtab="${id}" aria-selected="${state.webTab===id}">${l}${id==='enquiries'&&newEnq?` <span class="pill p-bad" style="margin-left:5px">${newEnq}</span>`:''}</button>`).join('')}</div>
  ${(bodies[state.webTab]||webPagesBody)()}`;
};

// ---- Pages (Homepage / Admissions / Academics / Leadership / Downloads / Contact) --

function webPagesBody(){
  const live = db.pages.filter(p=>p.status==='PUBLISHED');
  const totalViews = db.pages.reduce((t,p)=>t+p.views,0);

  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('scores',40)}<div><div class="v">${db.pages.length}</div><div class="l">Pages</div></div></div>
    <div class="stat">${svg('notice',40)}<div><div class="v">${live.length}</div><div class="l">Published</div></div></div>
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${totalViews.toLocaleString()}</div><div class="l">Views this term</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${db.pages.filter(p=>p.isLegacy).length}</div><div class="l">Locked addresses</div></div></div>
  </div>

  <div class="toolbar">
    <span class="spacer"></span>
    ${can('website.create')?`<button class="btn btn-y btn-s" id="add-page">Add page</button>`:''}
  </div>

  <div class="tw"><table>
    <thead><tr><th>Page</th><th>Type</th><th>Address</th><th class="num">Views</th><th>Updated</th><th>Status</th><th></th></tr></thead>
    <tbody>${db.pages.map(pg=>`<tr>
      <td style="font-weight:500">${esc(pg.title)}</td>
      <td><span class="pill p-info">${esc(PAGE_TYPES[pg.type]||pg.type)}</span></td>
      <td><span style="font-family:var(--mono);font-size:11.5px">${esc(pg.path)}</span>
        ${pg.isLegacy?'<span class="pill p-info" style="margin-left:6px">LOCKED</span>':''}</td>
      <td class="num">${pg.views.toLocaleString()}</td>
      <td>${fmtDate(pg.updated)}</td>
      <td><span class="pill ${pg.status==='PUBLISHED'?'p-ok':'p-mute'}">${pg.status}</span></td>
      <td><button class="btn btn-q btn-s" data-page="${pg.id}">Edit</button></td>
    </tr>`).join('')}</tbody>
  </table></div>

  <p class="note"><b>Locked addresses cannot be renamed.</b> ${db.pages.filter(p=>p.isLegacy).map(p=>`<code>${esc(p.path)}</code>`).join(', ')} already exist on the live site and are linked from search results and printed material. Changing one silently breaks every link pointing at it, so the field is disabled rather than merely discouraged.</p>`;
}

/** Every type shares heading/subheading/body/CTA/SEO; LEADERSHIP additionally
    picks featured staff and DOWNLOADS additionally lists files. Called with
    no id to create a new page, which is always type GENERAL — the other six
    types are fixed, singular slots seeded once, editable but not cloned. */
function openPageEditor(id){
  const pg = id ? db.pages.find(x=>x.id===id) : null;
  const type = pg ? pg.type : 'GENERAL';
  modal({
    title: pg?'Edit page':'Add page', sub: pg?`${esc(pg.title)} · ${esc(pg.path)}`:undefined, wide:true,
    body:`<div class="fgrid">
      <div class="f"><label class="req">Title</label><input type="text" id="pg-title" value="${pg?esc(pg.title):''}"><div class="err" id="e-pgtitle"></div></div>
      <div class="f"><label>Address</label>
        <input type="text" id="pg-path" value="${pg?esc(pg.path):''}" ${pg?.isLegacy?'disabled':''} placeholder="/example"
          style="${pg?.isLegacy?'background:#F4F6FA;color:var(--muted)':''}">
        ${pg?.isLegacy?`<div class="hint" style="font-size:11px;color:var(--amber);margin-top:5px">
          Locked. This address is already live and linked from search results and printed material.
          Renaming it would break every one of those links.</div>`:''}<div class="err" id="e-pgpath"></div></div>
      <div class="f"><label>Status</label><select id="pg-status">
        <option value="PUBLISHED" ${pg?.status==='PUBLISHED'?'selected':''}>Published</option>
        <option value="DRAFT" ${pg?.status!=='PUBLISHED'?'selected':''}>Draft</option></select></div>
      <div class="f"><label>Type</label><input type="text" value="${esc(PAGE_TYPES[type]||type)}" disabled style="background:#F4F6FA;color:var(--muted)"></div>

      <div class="f wide"><label>Heading</label><input type="text" id="pg-heading" value="${pg?esc(pg.heading||''):''}"></div>
      <div class="f wide"><label>Subheading</label><input type="text" id="pg-subheading" value="${pg?esc(pg.subheading||''):''}"></div>
      <div class="f wide"><label>Body</label><textarea id="pg-body" rows="4">${pg?esc(pg.body||''):''}</textarea></div>
      <div class="f"><label>Call-to-action text</label><input type="text" id="pg-ctatext" value="${pg?esc(pg.ctaText||''):''}"></div>
      <div class="f"><label>Call-to-action link</label><input type="text" id="pg-ctalink" value="${pg?esc(pg.ctaLink||''):''}" placeholder="/apply"></div>

      ${type==='LEADERSHIP'?`<div class="f wide"><label>Featured staff</label>
        <select id="pg-leaders" multiple size="6" style="height:auto">
          ${db.staff.filter(m=>m.status==='ACTIVE').map(m=>`<option value="${m.id}" ${(pg?.leadershipStaffIds||[]).includes(m.id)?'selected':''}>${esc(m.firstName)} ${esc(m.lastName)} — ${esc(m.position)}</option>`).join('')}
        </select>
        <div class="hint" style="font-size:11px;color:var(--muted);margin-top:4px">Ctrl/Cmd-click to select more than one.</div></div>`:''}
      ${type==='DOWNLOADS'?`<div class="f wide"><label>Files <small style="color:var(--muted)">one per line: Name — description</small></label>
        <textarea id="pg-files" rows="4">${(pg?.downloadFiles||[]).map(f=>`${f.name} — ${f.description}`).join('\n')}</textarea></div>`:''}

      <div class="f wide"><label>SEO title</label><input type="text" id="pg-seotitle" value="${pg?esc(pg.seoTitle||''):''}" maxlength="70"></div>
      <div class="f wide"><label>SEO description</label><input type="text" id="pg-seo" value="${pg?esc(pg.seoDescription||''):''}"
        placeholder="Shown under the title in Google results" maxlength="160"></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="pg-save">${pg?'Save page':'Add page'}</button>`,
    wire(){
      $('#pg-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const title = $('#pg-title').value.trim();
        const path = pg?.isLegacy ? pg.path : $('#pg-path').value.trim();
        let bad=false;
        if(!title){ $('#e-pgtitle').textContent='Enter a title.'; bad=true; }
        if(!pg?.isLegacy){
          if(!path || !path.startsWith('/')){ $('#e-pgpath').textContent='Enter an address starting with /.'; bad=true; }
          else if(db.pages.some(x=>x.path===path && x.id!==pg?.id)){ $('#e-pgpath').textContent='That address is already in use.'; bad=true; }
        }
        if(bad) return;

        const fields = {
          title, path, status: $('#pg-status').value,
          heading: $('#pg-heading').value.trim(), subheading: $('#pg-subheading').value.trim(),
          body: $('#pg-body').value.trim(), ctaText: $('#pg-ctatext').value.trim(), ctaLink: $('#pg-ctalink').value.trim(),
          seoTitle: $('#pg-seotitle').value.trim(), seoDescription: $('#pg-seo').value.trim(),
          updated: todayISO(),
        };
        if(type==='LEADERSHIP') fields.leadershipStaffIds = [...$('#pg-leaders').selectedOptions].map(o=>o.value);
        if(type==='DOWNLOADS') fields.downloadFiles = $('#pg-files').value.split('\n').map(l=>l.trim()).filter(Boolean)
          .map(l=>{ const [name,...rest] = l.split('—'); return {name:(name||l).trim(), description:rest.join('—').trim()}; });

        if(pg){
          Object.assign(pg, fields);
          logAudit('website.page', `${title} updated`);
        } else {
          db.pages.push({id:uid('pg'), type:'GENERAL', isLegacy:false, views:0, ...fields});
          logAudit('website.page', `${title} added`);
        }
        persist(); closeModal();
        toast(`${esc(title)} saved${fields.status==='PUBLISHED'?' and published':' as a draft'}.`);
        render();
      });
    },
  });
}

// ---- News -----------------------------------------------------------

function webNewsBody(){
  const posts = [...db.posts].sort((a,b)=>b.at.localeCompare(a.at));
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('website.create')?'<button class="btn btn-y btn-s" id="new-post">Write a post</button>':''}
  </div>
  <div class="block">
    <h2>News <small>${db.posts.filter(p=>p.status==='PUBLISHED').length} published</small></h2>
    ${posts.map(post=>`<div style="border:1px solid var(--rule);border-radius:11px;padding:14px 16px;margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:14px">${esc(post.title)}</div>
          <div style="font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-top:3px">${esc(post.slug)}</div>
          <p style="font-size:12.5px;color:var(--muted);margin:8px 0 0;max-width:70ch">${esc(post.excerpt)}</p>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <span class="pill ${post.status==='PUBLISHED'?'p-ok':'p-mute'}">${post.status}</span>
          <div style="font-size:11.5px;color:var(--muted);margin-top:6px">${fmtDate(post.at)}</div>
          <div style="font-size:11.5px;color:var(--muted)">${post.views.toLocaleString()} views</div>
        </div>
      </div>
      <div class="toolbar" style="margin-top:10px;justify-content:flex-end">
        ${can('website.edit')?`<button class="btn btn-q btn-s" data-post-edit="${post.id}">Edit</button>`:''}
        ${post.status==='DRAFT'&&can('website.edit')?`<button class="btn btn-p btn-s" data-publish="${post.id}">Publish</button>`:''}
      </div>
    </div>`).join('')}
    ${posts.length===0?'<p class="sub">No posts yet.</p>':''}
  </div>`;
}

function openPostForm(editId){
  const post = editId ? db.posts.find(x=>x.id===editId) : null;
  modal({
    title: post?'Edit post':'Write a post', wide:true,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Title</label><input type="text" id="ps-title" value="${post?esc(post.title):''}"><div class="err" id="e-pstitle"></div></div>
      <div class="f wide"><label class="req">Slug</label><input type="text" id="ps-slug" value="${post?esc(post.slug):''}" placeholder="/news/example"><div class="err" id="e-psslug"></div></div>
      <div class="f wide"><label class="req">Excerpt</label><textarea id="ps-excerpt" rows="2">${post?esc(post.excerpt):''}</textarea><div class="err" id="e-psexcerpt"></div></div>
      <div class="f wide"><label>Body</label><textarea id="ps-body" rows="5">${post?esc(post.body||''):''}</textarea></div>
      <div class="f"><label>Status</label><select id="ps-status">
        <option value="DRAFT" ${post?.status!=='PUBLISHED'?'selected':''}>Draft</option>
        <option value="PUBLISHED" ${post?.status==='PUBLISHED'?'selected':''}>Published</option></select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="ps-save">${post?'Save changes':'Save post'}</button>`,
    wire(){
      const titleEl = $('#ps-title'), slugEl = $('#ps-slug');
      if(!post) titleEl.addEventListener('input',()=>{
        if(!slugEl.dataset.touched) slugEl.value = '/news/'+titleEl.value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
      });
      slugEl.addEventListener('input',()=>{ slugEl.dataset.touched='1'; });
      $('#ps-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const title = titleEl.value.trim(), slug = slugEl.value.trim(), excerpt = $('#ps-excerpt').value.trim();
        let bad=false;
        if(!title){ $('#e-pstitle').textContent='Enter a title.'; bad=true; }
        if(!slug||!slug.startsWith('/')){ $('#e-psslug').textContent='Enter a slug starting with /.'; bad=true; }
        else if(db.posts.some(p=>p.slug===slug && p.id!==post?.id)){ $('#e-psslug').textContent='That slug is already in use.'; bad=true; }
        if(!excerpt){ $('#e-psexcerpt').textContent='Enter an excerpt.'; bad=true; }
        if(bad) return;
        const status = $('#ps-status').value, body = $('#ps-body').value.trim();
        if(post){
          Object.assign(post, {title, slug, excerpt, body, status, at: status==='PUBLISHED'&&post.status!=='PUBLISHED'?todayISO():post.at});
          logAudit('website.post', `${title} updated`);
        } else {
          db.posts.unshift({id:uid('ps'), title, slug, excerpt, body, status, at:todayISO(), views:0});
          logAudit('website.post', `${title} ${status==='PUBLISHED'?'published':'saved as a draft'}`);
        }
        persist(); closeModal();
        toast(status==='PUBLISHED'?`"${esc(title)}" is live at ${esc(slug)}.`:'Draft saved.');
        render();
      });
    },
  });
}

// ---- Events -----------------------------------------------------------

function webEventsBody(){
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('website.create')?'<button class="btn btn-y btn-s" id="add-event">Add event</button>':''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Event</th><th>Date</th><th>Where</th><th>On the site</th><th></th></tr></thead>
    <tbody>${db.events.map(ev=>`<tr>
      <td style="font-weight:500">${esc(ev.title)}</td>
      <td>${fmtDate(ev.at)}</td>
      <td style="color:var(--muted)">${esc(ev.where)}</td>
      <td>${ev.published?'<span class="pill p-ok">VISIBLE</span>':'<span class="pill p-mute">HIDDEN</span>'}</td>
      <td style="display:flex;gap:6px">
        ${can('website.edit')?`<button class="btn btn-q btn-s" data-event-edit="${ev.id}">Edit</button>
        <button class="btn btn-q btn-s" data-ev="${ev.id}">${ev.published?'Hide':'Show'}</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${db.events.length===0?'<p class="sub" style="margin-top:12px">No events yet.</p>':''}`;
}

function openEventForm(editId){
  const ev = editId ? db.events.find(x=>x.id===editId) : null;
  modal({
    title: ev?'Edit event':'Add event',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Title</label><input type="text" id="ev-title" value="${ev?esc(ev.title):''}"><div class="err" id="e-evtitle"></div></div>
      <div class="f"><label class="req">Date</label><input type="date" id="ev-date" value="${ev?ev.at:''}"><div class="err" id="e-evdate"></div></div>
      <div class="f"><label class="req">Where</label><input type="text" id="ev-where" value="${ev?esc(ev.where):''}"><div class="err" id="e-evwhere"></div></div>
      <div class="f wide"><label>Description</label><textarea id="ev-desc" rows="2">${ev?esc(ev.description||''):''}</textarea></div>
      <div class="f"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="ev-pub" style="width:auto" ${ev?.published!==false?'checked':''}> Visible on the public site</label></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="ev-save">${ev?'Save changes':'Add event'}</button>`,
    wire(){
      $('#ev-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const title = $('#ev-title').value.trim(), at = $('#ev-date').value, where = $('#ev-where').value.trim();
        let bad=false;
        if(!title){ $('#e-evtitle').textContent='Enter a title.'; bad=true; }
        if(!at){ $('#e-evdate').textContent='Enter a date.'; bad=true; }
        if(!where){ $('#e-evwhere').textContent='Enter a location.'; bad=true; }
        if(bad) return;
        const description = $('#ev-desc').value.trim(), published = $('#ev-pub').checked;
        if(ev){
          Object.assign(ev, {title, at, where, description, published});
          logAudit('website.event', `${title} updated`);
        } else {
          db.events.push({id:uid('ev'), title, at, where, description, published});
          logAudit('website.event', `${title} added`);
        }
        persist(); closeModal();
        toast(ev?'Event updated.':'Event added.');
        render();
      });
    },
  });
}

// ---- Gallery ----------------------------------------------------------

function webGalleryBody(){
  return `
  <div class="toolbar" style="margin-top:14px"><span class="spacer"></span>
    ${can('website.create')?'<button class="btn btn-y btn-s" id="new-album">New album</button>':''}</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
    ${db.gallery.map(al=>{
      const count = db.mediaLibrary.filter(m=>m.album===al.album).length;
      return `<div style="border:1px solid var(--rule);border-radius:12px;overflow:hidden;cursor:pointer" data-album-view="${al.id}">
      <div style="height:112px;background:var(--blue-wash);display:grid;place-items:center">
        ${svg(al.cover==='sports'?'transport':al.cover==='science'?'scores':al.cover==='lab'?'hostel':'scholarship',46)}
      </div>
      <div style="padding:12px 14px">
        <div style="font-weight:600;font-size:13px">${esc(al.album)}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${count} photograph${count===1?'':'s'}</div>
      </div>
    </div>`;
    }).join('')}
  </div>
  ${db.gallery.length===0?'<p class="sub" style="margin-top:12px">No albums yet.</p>':''}
  <p class="note">Every photograph of a child needs recorded consent from a guardian before it goes on a public page. The gallery reads that consent from the student record — a child whose guardian has not consented is filtered out of publishing, not merely left out by whoever picked the pictures.</p>`;
}

function openAlbumForm(){
  modal({
    title:'New album',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Name</label><input type="text" id="al-name"><div class="err" id="e-alname"></div></div>
      <div class="f"><label>Cover icon</label><select id="al-cover">
        <option value="sports">Sports</option><option value="science">Science</option>
        <option value="graduation">Graduation</option><option value="lab">Laboratory</option></select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="al-save">Create album</button>`,
    wire(){
      $('#al-save').addEventListener('click',()=>{
        const name = $('#al-name').value.trim();
        if(!name){ $('#e-alname').textContent='Enter a name.'; return; }
        if(db.gallery.some(a=>a.album===name)){ toast('An album with that name already exists.', true); return; }
        db.gallery.push({id:uid('gl'), album:name, cover:$('#al-cover').value});
        logAudit('website.gallery', `Album "${name}" created`);
        persist(); closeModal();
        toast('Album created.');
        render();
      });
    },
  });
}

function openAlbumView(id){
  const al = db.gallery.find(x=>x.id===id);
  const media = db.mediaLibrary.filter(m=>m.album===al.album);
  modal({
    title: al.album, sub:`${media.length} photograph${media.length===1?'':'s'}`,
    body: media.length ? `<div class="tw"><table><thead><tr><th>Label</th><th>Uploaded</th><th>By</th></tr></thead>
      <tbody>${media.map(m=>`<tr><td>${esc(m.label)}</td><td>${fmtDate(m.uploadedOn)}</td><td>${esc(m.uploadedBy)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="sub">No photographs in this album yet — add some from the Media Library.</p>',
    foot:`<button class="btn btn-q" data-close>Close</button>`,
  });
}

// ---- Media Library ----------------------------------------------------

function webMediaBody(){
  const items = [...db.mediaLibrary].sort((a,b)=>b.uploadedOn.localeCompare(a.uploadedOn));
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('website.create')&&db.gallery.length?'<button class="btn btn-y btn-s" id="add-media">Add media</button>':''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Label</th><th>Album</th><th>Uploaded</th><th>By</th><th></th></tr></thead>
    <tbody>${items.map(m=>`<tr>
      <td style="font-weight:500">${esc(m.label)}</td>
      <td>${esc(m.album)}</td><td>${fmtDate(m.uploadedOn)}</td><td style="font-size:12px;color:var(--muted)">${esc(m.uploadedBy)}</td>
      <td>${can('website.edit')?`<button class="btn btn-d btn-s" data-media-remove="${m.id}">Remove</button>`:''}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${items.length===0?'<p class="sub" style="margin-top:12px">Nothing in the media library yet.</p>':''}
  <p class="note">This demo never stores real image bytes — each entry is a labelled pointer to what a real upload would hand back, the same shortcut biometric enrolment and barcode scanning already take elsewhere in this app.</p>`;
}

function openMediaForm(){
  modal({
    title:'Add media',
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">Label</label><input type="text" id="md-label" placeholder="What does this show?"><div class="err" id="e-mdlabel"></div></div>
      <div class="f wide"><label class="req">Album</label><select id="md-album">${db.gallery.map(a=>`<option value="${esc(a.album)}">${esc(a.album)}</option>`).join('')}</select></div>
    </div>
    <p class="note">This demo never stores real image bytes — adding an entry here is the same pointer a real upload would hand back.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="md-save">Add</button>`,
    wire(){
      $('#md-save').addEventListener('click',()=>{
        const label = $('#md-label').value.trim();
        if(!label){ $('#e-mdlabel').textContent='Enter a label.'; return; }
        db.mediaLibrary.unshift({id:uid('md'), label, album:$('#md-album').value, uploadedOn:todayISO(), uploadedBy:ROLES[state.role].name});
        logAudit('website.media', `"${label}" added to media library`);
        persist(); closeModal();
        toast('Media added.');
        render();
      });
    },
  });
}

// ---- Testimonials -------------------------------------------------------

function webTestimonialsBody(){
  return `
  <div class="toolbar" style="margin-top:14px">
    <span class="spacer"></span>
    ${can('website.create')?'<button class="btn btn-y btn-s" id="add-testimonial">Add testimonial</button>':''}
  </div>
  <div class="tw"><table>
    <thead><tr><th>Name</th><th>Role</th><th>Quote</th><th>Status</th><th></th></tr></thead>
    <tbody>${db.testimonials.map(t=>`<tr>
      <td style="font-weight:500">${esc(t.name)}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(t.role)}</td>
      <td style="font-size:12.5px;max-width:340px">${esc(t.quote)}</td>
      <td><span class="pill ${t.status==='PUBLISHED'?'p-ok':'p-mute'}">${t.status}</span></td>
      <td>${can('website.edit')?`<button class="btn btn-q btn-s" data-testimonial-toggle="${t.id}">${t.status==='PUBLISHED'?'Unpublish':'Publish'}</button>`:''}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${db.testimonials.length===0?'<p class="sub" style="margin-top:12px">No testimonials yet.</p>':''}`;
}

function openTestimonialForm(){
  modal({
    title:'Add testimonial',
    body:`<div class="fgrid">
      <div class="f"><label class="req">Name</label><input type="text" id="tm-name"><div class="err" id="e-tmname"></div></div>
      <div class="f"><label class="req">Role</label><input type="text" id="tm-role" placeholder="Parent, JSS 2"><div class="err" id="e-tmrole"></div></div>
      <div class="f wide"><label class="req">Quote</label><textarea id="tm-quote" rows="3"></textarea><div class="err" id="e-tmquote"></div></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="tm-save">Add</button>`,
    wire(){
      $('#tm-save').addEventListener('click',()=>{
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const name = $('#tm-name').value.trim(), role = $('#tm-role').value.trim(), quote = $('#tm-quote').value.trim();
        let bad=false;
        if(!name){ $('#e-tmname').textContent='Enter a name.'; bad=true; }
        if(!role){ $('#e-tmrole').textContent='Enter a role.'; bad=true; }
        if(!quote){ $('#e-tmquote').textContent='Enter the quote.'; bad=true; }
        if(bad) return;
        db.testimonials.push({id:uid('tm'), name, role, quote, status:'DRAFT'});
        logAudit('website.testimonial', `Testimonial from ${name} added`);
        persist(); closeModal();
        toast('Testimonial added as a draft.');
        render();
      });
    },
  });
}

// ---- Enquiries (contact form inbox) -------------------------------------

function webEnquiriesBody(){
  const open_ = db.enquiries.filter(e=>!e.handled);
  return `
  <div class="grid-stats" style="margin-top:14px">
    <div class="stat">${svg('notice',40)}<div><div class="v">${db.enquiries.length}</div><div class="l">Enquiries received</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v" style="color:${open_.length?'var(--clay)':'inherit'}">${open_.length}</div><div class="l">Awaiting a reply</div></div></div>
    <div class="stat">${svg('admissions',40)}<div><div class="v">${db.applications.length}</div><div class="l">Turned into applications</div></div></div>
    <div class="stat">${svg('collectFees',40)}<div><div class="v">${db.pages.find(p=>p.path==='/admission')?.views.toLocaleString()||0}</div><div class="l">Admissions page views</div></div></div>
  </div>

  <div class="tw"><table>
    <thead><tr><th>From</th><th>Subject</th><th>Received</th><th>Status</th><th></th></tr></thead>
    <tbody>${db.enquiries.map(e=>`<tr>
      <td><div style="font-weight:500">${esc(e.name)}</div>
        <div style="font-family:var(--mono);font-size:10.5px;color:var(--muted)">${esc(e.email)} · ${esc(e.phone)}</div></td>
      <td style="max-width:280px">${esc(e.subject)}</td>
      <td>${fmtDate(e.at)}</td>
      <td>${e.handled?'<span class="pill p-ok">ANSWERED</span>':'<span class="pill p-warn">OPEN</span>'}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-q btn-s" data-enq-view="${e.id}">View</button>
        ${!e.handled?`<button class="btn btn-p btn-s" data-enq="${e.id}">Mark answered</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>

  <p class="note">The contact form on the public site writes straight into this table. An enquiry about admission can be turned into an application without the parent filling the same details twice — which is the whole point of the site and the ERP being one system rather than two.</p>`;
}

function openEnquiryView(id){
  const e = db.enquiries.find(x=>x.id===id);
  modal({
    title: e.subject, sub:`${esc(e.name)} · ${fmtDate(e.at)}`,
    body:`<dl class="kv">
      <dt>Email</dt><dd style="font-family:var(--mono);font-size:12px">${esc(e.email)}</dd>
      <dt>Phone</dt><dd style="font-family:var(--mono);font-size:12px">${esc(e.phone)}</dd>
    </dl>
    <p style="font-size:13px;margin-top:12px;line-height:1.6">${esc(e.message||'—')}</p>`,
    foot:`<button class="btn btn-q" data-close>Close</button>
      ${!e.handled?`<button class="btn btn-p" id="enq-answer">Mark answered</button>`:''}`,
    wire(){
      const b = $('#enq-answer');
      if(b) b.addEventListener('click',()=>{
        e.handled = true; persist(); closeModal();
        toast(`Enquiry from ${esc(e.name)} marked answered.`);
        render();
      });
    },
  });
}

PAGES.website_wire = () => {
  document.querySelectorAll('[data-webtab]').forEach(b=>b.addEventListener('click',()=>{state.webTab=b.dataset.webtab;render();}));

  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>openPageEditor(b.dataset.page)));
  const addPage = $('#add-page'); if(addPage) addPage.addEventListener('click',()=>openPageEditor());

  document.querySelectorAll('[data-publish]').forEach(b=>b.addEventListener('click',()=>{
    const post = db.posts.find(x=>x.id===b.dataset.publish);
    post.status='PUBLISHED'; post.at=todayISO(); persist();
    toast(`"${esc(post.title)}" is live at ${esc(post.slug)}.`);
    render();
  }));
  document.querySelectorAll('[data-post-edit]').forEach(b=>b.addEventListener('click',()=>openPostForm(b.dataset.postEdit)));
  const np = $('#new-post'); if(np) np.addEventListener('click',()=>openPostForm());

  document.querySelectorAll('[data-ev]').forEach(b=>b.addEventListener('click',()=>{
    const ev = db.events.find(x=>x.id===b.dataset.ev);
    ev.published = !ev.published; persist();
    toast(`${esc(ev.title)} is now ${ev.published?'visible on':'hidden from'} the public calendar.`);
    render();
  }));
  document.querySelectorAll('[data-event-edit]').forEach(b=>b.addEventListener('click',()=>openEventForm(b.dataset.eventEdit)));
  const ae = $('#add-event'); if(ae) ae.addEventListener('click',()=>openEventForm());

  document.querySelectorAll('[data-album-view]').forEach(b=>b.addEventListener('click',()=>openAlbumView(b.dataset.albumView)));
  const na = $('#new-album'); if(na) na.addEventListener('click',()=>openAlbumForm());

  document.querySelectorAll('[data-media-remove]').forEach(b=>b.addEventListener('click',()=>{
    db.mediaLibrary = db.mediaLibrary.filter(m=>m.id!==b.dataset.mediaRemove);
    persist();
    toast('Removed from the media library.');
    render();
  }));
  const am = $('#add-media'); if(am) am.addEventListener('click',()=>openMediaForm());

  document.querySelectorAll('[data-testimonial-toggle]').forEach(b=>b.addEventListener('click',()=>{
    const t = db.testimonials.find(x=>x.id===b.dataset.testimonialToggle);
    t.status = t.status==='PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    logAudit('website.testimonial', `${t.name}'s testimonial ${t.status==='PUBLISHED'?'published':'unpublished'}`);
    persist();
    toast(t.status==='PUBLISHED'?'Testimonial published.':'Testimonial unpublished.');
    render();
  }));
  const at = $('#add-testimonial'); if(at) at.addEventListener('click',()=>openTestimonialForm());

  document.querySelectorAll('[data-enq-view]').forEach(b=>b.addEventListener('click',()=>openEnquiryView(b.dataset.enqView)));
  document.querySelectorAll('[data-enq]').forEach(b=>b.addEventListener('click',()=>{
    const e = db.enquiries.find(x=>x.id===b.dataset.enq);
    e.handled = true; persist();
    toast(`Enquiry from ${esc(e.name)} marked answered.`);
    render();
  }));

  const vs = $('#view-site');
  if(vs) vs.addEventListener('click',ev=>{ ev.preventDefault(); openSitePreview(); });
};

function openSitePreview(){
  const live = db.pages.filter(p=>p.status==='PUBLISHED');
  const home = db.pages.find(p=>p.type==='HOME');
  const leadership = db.pages.find(p=>p.type==='LEADERSHIP' && p.status==='PUBLISHED');
  const downloads = db.pages.find(p=>p.type==='DOWNLOADS' && p.status==='PUBLISHED');
  const news = db.posts.filter(p=>p.status==='PUBLISHED').slice(0,3);
  const events = db.events.filter(e=>e.published);
  const testimonials = db.testimonials.filter(t=>t.status==='PUBLISHED').slice(0,3);
  const leaders = leadership ? (leadership.leadershipStaffIds||[]).map(id=>db.staff.find(m=>m.id===id)).filter(Boolean) : [];

  modal({
    title:'Live site', sub:'How the public pages read, drawn from the same records', wide:true,
    body:`<div style="border:1px solid var(--rule);border-radius:12px;overflow:hidden">
      <div style="background:var(--navy);color:#fff;padding:16px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <span data-crest="42" style="flex:none"></span>
        <div><div style="font-family:var(--word);font-size:20px">Fadesrek Academy</div>
          <div style="font-family:var(--word);font-style:italic;font-size:12px;opacity:.75">Soaring to Excellence</div></div>
        <span class="spacer" style="flex:1"></span>
        <div style="display:flex;gap:14px;font-size:12px;flex-wrap:wrap">
          ${live.slice(0,6).map(p=>`<span style="opacity:.85">${esc(p.title)}</span>`).join('')}
        </div>
      </div>

      ${home?`<div style="padding:22px 20px;background:var(--blue-wash)">
        <div style="font-family:var(--word);font-size:26px;color:var(--navy)">${esc(home.heading)}</div>
        ${home.subheading?`<p style="font-size:13px;color:#33507A;max-width:60ch;margin:8px 0 14px">${esc(home.subheading)}</p>`:''}
        ${home.ctaText?`<span class="btn btn-y btn-s">${esc(home.ctaText)}</span>`:''}
      </div>`:''}

      <div style="padding:20px">
        <h3 style="font-size:14px;margin-bottom:10px">Latest news</h3>
        ${news.map(n=>`<div style="padding:10px 0;border-bottom:1px solid var(--rule)">
          <div style="font-weight:600;font-size:13px">${esc(n.title)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(n.excerpt)}</div>
          <div style="font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-top:4px">${fmtDate(n.at)}</div>
        </div>`).join('')}
        ${news.length===0?'<p class="sub" style="margin:0">Nothing published yet.</p>':''}

        <h3 style="font-size:14px;margin:18px 0 10px">What's on</h3>
        ${events.map(e=>`<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--rule)">
          <div style="font-family:var(--mono);font-size:11px;color:var(--blue);width:76px;flex:none">${fmtDate(e.at)}</div>
          <div style="font-size:12.5px">${esc(e.title)} <span style="color:var(--muted)">· ${esc(e.where)}</span></div>
        </div>`).join('')}
        ${events.length===0?'<p class="sub" style="margin:0">Nothing on the calendar right now.</p>':''}

        ${leaders.length?`<h3 style="font-size:14px;margin:18px 0 10px">Leadership</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
          ${leaders.map(m=>`<div style="text-align:center">${avatar(m,52)}
            <div style="font-size:12px;font-weight:600;margin-top:6px">${esc(m.firstName)} ${esc(m.lastName)}</div>
            <div style="font-size:11px;color:var(--muted)">${esc(m.position)}</div></div>`).join('')}
        </div>`:''}

        ${testimonials.length?`<h3 style="font-size:14px;margin:18px 0 10px">What families say</h3>
        ${testimonials.map(t=>`<div style="padding:10px 0;border-bottom:1px solid var(--rule)">
          <p style="font-size:12.5px;font-style:italic;margin:0">"${esc(t.quote)}"</p>
          <div style="font-size:11.5px;color:var(--muted);margin-top:4px">${esc(t.name)}, ${esc(t.role)}</div>
        </div>`).join('')}`:''}

        ${downloads&&downloads.downloadFiles?.length?`<h3 style="font-size:14px;margin:18px 0 10px">Downloads</h3>
        ${downloads.downloadFiles.map(f=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--rule);font-size:12.5px">
          <span>${esc(f.name)}</span><span style="color:var(--muted)">${esc(f.description)}</span></div>`).join('')}`:''}
      </div>
    </div>
    <p class="note">Nothing here is a second copy. The news, the events and the apply link all read the same records the office works from, which is why the public page cannot drift out of date with the school.</p>`,
    foot:`<button class="btn btn-q" data-close>Close</button>`,
  });
}

// ---------------------------------------------------------------- settings --

/** Illustrative only — Fadesrek runs as a static front end with no server, so
    there is nothing here for a gateway to actually route to. This is the map
    from bounded context to the service the rest of the code's comments
    already imagine (the "NestJS API" referenced throughout), kept as
    documentation rather than as a working control. Request counts are fixed,
    not simulated live, on purpose — a status panel whose numbers drift on
    every render can't be checked against anything. */
const GATEWAY_SERVICES = [
  {context:'Authentication', path:'/api/auth/*',          rpm:31},
  {context:'Admissions',     path:'/api/admissions/*',    rpm:38},
  {context:'Academics',      path:'/api/academics/*',     rpm:64},
  {context:'Students',       path:'/api/students/*',      rpm:112},
  {context:'Attendance',     path:'/api/attendance/*',    rpm:57},
  {context:'Examinations',   path:'/api/examinations/*',  rpm:41},
  {context:'Finance',        path:'/api/finance/*',       rpm:96},
  {context:'Payroll',        path:'/api/payroll/*',       rpm:9},
  {context:'HR',             path:'/api/hr/*',            rpm:6},
  {context:'Communication',  path:'/api/communication/*', rpm:22},
  {context:'Files',          path:'/api/files/*',         rpm:14},
  {context:'Notification',   path:'/api/notifications/*', rpm:19},
  {context:'Audit',          path:'/api/audit/*',         rpm:47},
];

PAGES.settings = () => `
  <div class="phead">
    <div><h1>Settings</h1><p>The things a school changes without needing a developer. Grading, weighting and fees all live here as data.</p></div>
  </div>

  <div class="block">
    <h2>School</h2>
    <div class="fgrid">
      <div class="f"><label>Name</label><input type="text" value="Fadesrek Academy" id="set-name"></div>
      <div class="f"><label>Address</label><input type="text" value="Kubwa, Bwari Area Council, FCT" id="set-addr"></div>
      <div class="f"><label>Session</label><input type="text" value="${SESSION}" id="set-session"></div>
      <div class="f"><label>Current term</label><select id="set-term">
        <option>First Term</option><option>Second Term</option><option>Third Term</option></select></div>
    </div>
  </div>

  <div class="block">
    <h2>Assessment weighting <small>must total 100</small></h2>
    <p class="sub">Change these and every total, grade and position recomputes from the stored components. Nothing is migrated, because no total was ever saved.</p>
    <div class="fgrid">
      ${COMPONENTS.map(c=>`<div class="f"><label>${c.label}</label>
        <input type="number" min="0" max="100" value="${c.max}" data-weight="${c.key}"></div>`).join('')}
    </div>
    <div id="weight-msg" class="note" style="margin-top:12px"></div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-p" id="save-weights">Save weighting</button></div>
  </div>

  <div class="block">
    <h2>Grading scale <small>${BANDS.length} bands</small></h2>
    <div class="tw"><table>
      <thead><tr><th>Grade</th><th class="num">From</th><th>Remark</th></tr></thead>
      <tbody>${BANDS.map(b=>`<tr><td style="font-weight:600">${b.g}</td><td class="num">${b.min}</td><td>${b.r}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="note">This is the WAEC nine-point scale. If Fadesrek uses its own, it is edited here rather than in code — that is the whole reason the bands are a table.</p>
  </div>

  <div class="block">
    <h2>Fee structure <small>per term</small></h2>
    <p class="sub">Editing here changes what every new invoice bills. Payments already recorded are untouched — a fee change is never retroactive.</p>
    <div class="tw"><table>
      <thead><tr><th>Item</th><th>Applies to</th><th class="num">Amount (₦)</th><th></th></tr></thead>
      <tbody id="fee-rows">${db.feeItems.map(f=>`<tr>
        <td><input type="text" data-fi-name="${f.id}" value="${esc(f.name)}"></td>
        <td><select data-fi-applies="${f.id}">
          <option value="ALL" ${f.applies==='ALL'?'selected':''}>All students</option>
          <option value="BOARDER" ${f.applies==='BOARDER'?'selected':''}>Boarders</option>
          <option value="TRANSPORT" ${f.applies==='TRANSPORT'?'selected':''}>Transport users</option>
        </select></td>
        <td class="num"><input type="number" min="0" data-fi-amount="${f.id}" value="${Math.round(f.amount/100)}" style="text-align:right"></td>
        <td><button class="btn btn-d btn-s" data-fi-remove="${f.id}">Remove</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="toolbar" style="margin-top:12px">
      <button class="btn btn-q btn-s" id="fi-add">Add item</button>
      <span class="spacer"></span>
      <button class="btn btn-p" id="save-fees">Save fee structure</button>
    </div>
  </div>

  <div class="block">
    <h2>Policy</h2>
    <label style="display:flex;gap:10px;align-items:flex-start;font-size:13px;cursor:pointer">
      <input type="checkbox" id="set-withhold" style="width:auto;margin-top:3px">
      <span><b>Withhold report cards from parents with an outstanding balance</b>
      <div style="color:var(--muted);font-size:12px;margin-top:2px">Currently off. This is a policy decision with real consequences for a child, so it is left explicit rather than defaulted on.</div></span>
    </label>
  </div>

  <div class="block">
    <h2>API Gateway <small>conceptual</small></h2>
    <p class="sub">Fadesrek runs as a single static front end — there is no server, so there is no real gateway to configure. This table is the map from bounded context to service that a production deployment would route through it, kept here as documentation rather than as a working control.</p>
    <div class="tw"><table>
      <thead><tr><th>Bounded context</th><th>Route</th><th>Status</th><th class="num">Req / min</th></tr></thead>
      <tbody>${GATEWAY_SERVICES.map(s=>`<tr>
        <td>${esc(s.context)}</td>
        <td style="font-family:var(--mono);font-size:11.5px">${esc(s.path)}</td>
        <td><span class="pill p-ok">HEALTHY</span></td>
        <td class="num" style="font-family:var(--mono)">${s.rpm}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;

PAGES.settings_wire = () => {
  const check = () => {
    const total = [...document.querySelectorAll('[data-weight]')].reduce((t,i)=>t+(Number(i.value)||0),0);
    const msg = $('#weight-msg');
    const ok = total===100;
    msg.innerHTML = ok ? `Total <b>100</b>. Saving will recompute every result in the school.`
      : `Total is <b>${total}</b>, not 100. ${total>100?'Reduce':'Increase'} a component by ${Math.abs(100-total)}.`;
    msg.style.color = ok ? 'var(--moss)' : 'var(--clay)';
    $('#save-weights').disabled = !ok;
    return ok;
  };
  document.querySelectorAll('[data-weight]').forEach(i=>i.addEventListener('input',check));
  check();

  $('#save-weights').addEventListener('click',()=>{
    if(!check()) return;
    document.querySelectorAll('[data-weight]').forEach(i=>{
      const comp = COMPONENTS.find(c=>c.key===i.dataset.weight);
      if(comp) comp.max = Number(i.value);
    });
    // Clamp any stored component that now exceeds its new maximum.
    let clamped = 0;
    for(const key of Object.keys(db.scores)){
      for(const c of COMPONENTS){
        if(db.scores[key][c.key] > c.max){ db.scores[key][c.key] = c.max; clamped++; }
      }
    }
    persist();
    toast(clamped ? `Weighting saved. ${clamped} stored score${clamped===1?'':'s'} clamped to the new maximum.`
                  : 'Weighting saved. Every result recomputed.');
    render();
  });

  const wh = $('#set-withhold');
  if(wh) wh.addEventListener('change',e=>toast(e.target.checked
    ? 'Report cards will now be withheld where fees are outstanding.'
    : 'Report cards will be released regardless of fees.'));

  const feeAdd = $('#fi-add');
  if(feeAdd) feeAdd.addEventListener('click',()=>{
    db.feeItems.push({id:uid('fi'), name:'New item', amount:0, applies:'ALL'});
    render();
  });
  document.querySelectorAll('[data-fi-remove]').forEach(b=>b.addEventListener('click',()=>{
    db.feeItems = db.feeItems.filter(f=>f.id!==b.dataset.fiRemove);
    render();
  }));
  const saveFees = $('#save-fees');
  if(saveFees) saveFees.addEventListener('click',()=>{
    document.querySelectorAll('[data-fi-name]').forEach(inp=>{
      const f = db.feeItems.find(x=>x.id===inp.dataset.fiName);
      if(f) f.name = inp.value.trim() || f.name;
    });
    document.querySelectorAll('[data-fi-applies]').forEach(sel=>{
      const f = db.feeItems.find(x=>x.id===sel.dataset.fiApplies);
      if(f) f.applies = sel.value;
    });
    document.querySelectorAll('[data-fi-amount]').forEach(inp=>{
      const f = db.feeItems.find(x=>x.id===inp.dataset.fiAmount);
      if(f) f.amount = Math.max(0, Math.round(Number(inp.value)||0)*100);
    });
    logAudit('finance.feeStructure', 'Fee structure updated.');
    persist();
    toast('Fee structure saved. Every invoice recomputes from these amounts.');
    render();
  });
};

// ------------------------------------------------------------- permissions --
/* A read view over GRANTS, not a second copy of it — every cell below is
   computed from can()'s own data, so this page can never claim a role holds
   something the app itself would refuse to render. Rendered as a tab inside
   the Admin Panel (PAGES.accounts). */

function permissionsBody(){
  const roleKey = ROLES[state.permRole] ? state.permRole : state.role;
  const held = GRANTS[roleKey];
  const heldSet = new Set(held);

  return `
  <div class="toolbar">
    <select class="pick" id="perm-role" style="max-width:280px">
      ${Object.entries(ROLES).map(([k,r])=>`<option value="${k}" ${k===roleKey?'selected':''}>${esc(r.title)}</option>`).join('')}
    </select>
    <span class="spacer"></span>
    <span style="font-size:12px;color:var(--muted)">${held.length} of ${PERMISSIONS.length} held · scope <code>${ROLES[roleKey].scope}</code></span>
  </div>

  <div class="tw"><table>
    <thead><tr><th>Module</th>${VERBS.map(v=>`<th style="text-align:center;text-transform:capitalize">${v}</th>`).join('')}</tr></thead>
    <tbody>
      <tr><td style="font-weight:500">Portal <span class="sm" style="font-family:var(--mono);font-size:10px;color:var(--muted)">(landing page, not a record type)</span></td>
        <td style="text-align:center" colspan="${VERBS.length}">${heldSet.has('portal.view')?'<span class="pill p-ok">VIEW</span>':'<span style="color:var(--muted)">—</span>'}</td></tr>
      ${MODULES.map(m=>`<tr>
        <td style="font-weight:500">${m==='hr'?'HR':m[0].toUpperCase()+m.slice(1).replace(/_/g,' ')}</td>
        ${VERBS.map(v=>{
          const has = heldSet.has(`${m}.${v}`);
          return `<td style="text-align:center">${has?'<span style="color:var(--moss);font-weight:700">✓</span>':'<span style="color:var(--rule)">·</span>'}</td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table></div>

  <p class="note">Rows with every column empty are modules this role never touches, not modules the school lacks — ${roleKey==='STUDENT'||roleKey==='PARENT'?'a self-service account only ever needs a handful of view permissions.':'compare against a broader role like Super Administrator to see the full catalogue granted.'}</p>`;
}

// ------------------------------------------------------------- admin panel --
// Account provisioning for staff. Two halves: a pending queue only the Super
// Administrator can clear, and a directory of every account already decided.
// An approval mints a real sign-in credential (added to AUTH_USERS so it
// works on the login screen) and, for a new hire, an HR staff record.

const POSITION_LABEL = {
  PRINCIPAL:'Principal', VICE_PRINCIPAL:'Vice Principal', ACADEMIC_COORDINATOR:'Academic Coordinator',
  BURSAR:'Bursar', SECRETARY:'Secretary', REGISTRAR:'Registrar', ICT_ADMIN:'ICT Administrator',
  HR_MANAGER:'HR Manager', LIBRARIAN:'Librarian', TRANSPORT_OFFICER:'Transport Officer',
  HOSTEL_ADMIN:'Hostel Administrator', STORE_KEEPER:'Store Keeper', INVENTORY_OFFICER:'Inventory Officer',
  RECEPTIONIST:'Receptionist', SECURITY_OFFICER:'Security Officer',
  TEACHER:'Teacher', CLASS_TEACHER:'Class Teacher', SUBJECT_TEACHER:'Subject Teacher',
};
const accountRoleLabel = k => POSITION_LABEL[k] || (ROLES[k] ? ROLES[k].title : k);
const acctTypePill = a => `<span class="pill ${a.category==='TEACHING'?'p-info':'p-mute'}">${a.category==='TEACHING'?'Teaching':'Admin'}</span>`;
const acctNameCell = a => `<div style="font-weight:600;font-size:13px">${esc(a.firstName)} ${esc(a.lastName)}</div>
  <div style="font-family:var(--mono);font-size:10.5px;color:var(--muted)">${esc(a.email)}</div>`;

// Which tabs a role sees. Account tabs need canAdminAccounts(); the audit
// trail and permissions matrix keep the gates they had as standalone pages.
function accountsTabs(){
  return [
    ['pending',     'Pending approval', canAdminAccounts()],
    ['directory',   'Directory',        canAdminAccounts()],
    ['audit',       'Audit trail',      can('audit.view')],
    ['permissions', 'Permissions',      can('settings.view')],
  ].filter(t=>t[2]);
}
const ACCT_TAB_INTRO = {
  pending:     'Account provisioning for administrative and teaching staff. A new account goes live only once the Super Administrator approves it.',
  directory:   'Every account that has been decided, with its role, type and current status.',
  audit:       'Every screen that changes a record writes a line here — newest first, nothing summarised or sampled.',
  permissions: 'What each role\'s can() actually resolves to — read straight from the grants the app enforces.',
};

PAGES.accounts = () => {
  const all = db.accounts || [];
  const pending = all.filter(a=>a.status==='PENDING');
  const decided = all.filter(a=>a.status!=='PENDING');
  const tabs = accountsTabs();
  const tab = tabs.some(t=>t[0]===state.acctTab) ? state.acctTab : (tabs[0] ? tabs[0][0] : 'pending');
  const canApprove = canApproveAccounts();

  const count = id => id==='pending' ? (pending.length ? ` · ${pending.length}` : '')
                    : id==='directory' ? ` · ${decided.length}` : '';
  const head = `
  <div class="phead">
    <div><h1>Admin Panel</h1><p>${ACCT_TAB_INTRO[tab]}</p></div>
    ${canAdminAccounts()?'<button class="btn btn-y" id="acc-new">New account</button>':''}
  </div>
  <div class="tabs">${tabs.map(([id,label])=>
    `<button class="tab" data-acctab="${id}" aria-selected="${tab===id}">${label}${count(id)}</button>`).join('')}</div>`;

  if(tab==='audit')       return head + auditBody();
  if(tab==='permissions') return head + permissionsBody();

  if(tab==='pending'){
    if(!pending.length){
      return head + `<div class="empty"><b>No accounts waiting</b>New account requests land here for the Super Administrator to approve.</div>`;
    }
    return head + `
    <div class="tw"><table>
      <thead><tr><th>Name</th><th>Requested role</th><th>Type</th><th>Raised by</th><th>When</th><th></th></tr></thead>
      <tbody>${pending.map(a=>`<tr>
        <td>${acctNameCell(a)}</td>
        <td>${esc(accountRoleLabel(a.roleKey))}</td>
        <td>${acctTypePill(a)}</td>
        <td style="font-size:12px">${esc(a.requestedBy)}${a.requestedByRole?`<div style="font-size:10.5px;color:var(--muted)">${esc(ROLES[a.requestedByRole]?.title||a.requestedByRole)}</div>`:''}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">${fmtDate(a.requestedAt)}</td>
        <td style="display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-q btn-s" data-acc-open="${a.id}">Review</button>
          ${canApprove?`<button class="btn btn-p btn-s" data-acc-approve="${a.id}">Approve</button>
          <button class="btn btn-d btn-s" data-acc-reject="${a.id}">Reject</button>`:''}
        </td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${canApprove?'':'<p class="note">Approval and rejection are the Super Administrator\'s alone. You can raise a request and review what is in the queue.</p>'}`;
  }

  const catF = state.acctCat, q = state.acctQuery.trim().toLowerCase();
  let rows = decided;
  if(catF) rows = rows.filter(a=>a.category===catF);
  if(q) rows = rows.filter(a=>`${a.firstName} ${a.lastName} ${a.email} ${accountRoleLabel(a.roleKey)} ${a.department||''}`.toLowerCase().includes(q));

  return head + `
  <div class="toolbar">
    <input class="search" id="acc-q" placeholder="Search name, email, role" value="${esc(state.acctQuery)}">
    <select class="pick" id="acc-cat">
      <option value="">All types</option>
      <option value="ADMIN" ${catF==='ADMIN'?'selected':''}>Administrative</option>
      <option value="TEACHING" ${catF==='TEACHING'?'selected':''}>Teaching</option>
    </select>
    <span class="spacer"></span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${rows.length} account${rows.length===1?'':'s'}</span>
  </div>
  ${rows.length?`<div class="tw"><table>
    <thead><tr><th>Name</th><th>Role</th><th>Type</th><th>Department</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(a=>`<tr>
      <td>${acctNameCell(a)}</td>
      <td>${esc(accountRoleLabel(a.roleKey))}</td>
      <td>${acctTypePill(a)}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(a.department||'—')}</td>
      <td><span class="pill ${ACCT_STATUS_PILL[a.status]}">${a.status}</span></td>
      <td style="text-align:right"><button class="btn btn-q btn-s" data-acc-open="${a.id}">Open</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`:'<div class="empty"><b>Nothing matches</b>Adjust the search or the type filter.</div>'}`;
};

PAGES.accounts_wire = () => {
  document.querySelectorAll('[data-acctab]').forEach(b=>b.addEventListener('click',()=>{ state.acctTab=b.dataset.acctab; render(); }));
  const nw=$('#acc-new'); if(nw) nw.addEventListener('click',openAccountForm);
  const q=$('#acc-q'); if(q) q.addEventListener('input',e=>{state.acctQuery=e.target.value;const p=e.target.selectionStart;render();const n=$('#acc-q');if(n){n.focus();n.setSelectionRange(p,p);}});
  const cat=$('#acc-cat'); if(cat) cat.addEventListener('change',e=>{ state.acctCat=e.target.value; render(); });
  document.querySelectorAll('[data-acc-open]').forEach(b=>b.addEventListener('click',()=>openAccountProfile(b.dataset.accOpen)));
  document.querySelectorAll('[data-acc-approve]').forEach(b=>b.addEventListener('click',()=>approveAccount(b.dataset.accApprove)));
  document.querySelectorAll('[data-acc-reject]').forEach(b=>b.addEventListener('click',()=>rejectAccount(b.dataset.accReject)));
  // audit-trail tab
  const aq=$('#audit-q'); if(aq) aq.addEventListener('input',e=>{state.auditQuery=e.target.value;const p=e.target.selectionStart;render();const n=$('#audit-q');if(n){n.focus();n.setSelectionRange(p,p);}});
  // permissions tab
  const pr=$('#perm-role'); if(pr) pr.addEventListener('change',e=>{ state.permRole=e.target.value; render(); });
};

function openAccountForm(){
  const creatorName = ROLES[state.role].name;
  const roleOpts = cat => rolesForCategory(cat).map(k=>`<option value="${k}">${esc(accountRoleLabel(k))}</option>`).join('');
  const deptOpts = ACCOUNT_DEPARTMENTS.map(d=>`<option>${d}</option>`).join('');
  const subjBoxes = SUBJECTS.map(s=>`<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;margin:2px 12px 2px 0"><input type="checkbox" value="${s.id}" class="af-subj"> ${esc(s.name)}</label>`).join('');

  modal({
    title:'New account', sub:'Creates an account profile and submits it for the Super Administrator to approve.', wide:true,
    body:`
      <div class="fgrid">
        <div class="f"><label class="req">Staff type</label>
          <select id="af-cat"><option value="ADMIN">Administrative</option><option value="TEACHING">Teaching</option></select></div>
        <div class="f"><label class="req">Role</label><select id="af-role">${roleOpts('ADMIN')}</select></div>
        <div class="f"><label class="req">First name</label><input type="text" id="af-first"><div class="err" id="e-affirst"></div></div>
        <div class="f"><label class="req">Surname</label><input type="text" id="af-last"><div class="err" id="e-aflast"></div></div>
        <div class="f"><label class="req">Sign-in email</label><input type="text" id="af-email" placeholder="first.last@fadesrek.edu.ng"><div class="err" id="e-afemail"></div></div>
        <div class="f"><label class="req">Phone</label><input type="text" id="af-phone" placeholder="08012345678"><div class="err" id="e-afphone"></div></div>
        <div class="f"><label>Department</label><select id="af-dept">${deptOpts}</select></div>
      </div>
      <div id="af-teaching" hidden>
        <h3 style="font-size:12.5px;margin:16px 0 9px">Teaching details</h3>
        <div class="fgrid">
          <div class="f"><label class="req">TRCN licence number</label><input type="text" id="af-trcn" placeholder="TRCN/123456"><div class="err" id="e-aftrcn"></div></div>
        </div>
        <label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 4px">Subjects taught</label>
        <div style="line-height:2.1">${subjBoxes}</div>
      </div>
      <div class="f wide" style="margin-top:14px"><label>Note for the approver</label><textarea id="af-note" rows="2" placeholder="Why this account is needed."></textarea></div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button>
      ${canApproveAccounts()?'<button class="btn btn-q" id="af-approve">Create &amp; approve now</button>':''}
      <button class="btn btn-p" id="af-save">Submit for approval</button>`,
    wire(){
      const catSel=$('#af-cat'), roleSel=$('#af-role'), teach=$('#af-teaching');
      catSel.addEventListener('change',()=>{ const c=catSel.value; roleSel.innerHTML=roleOpts(c); teach.hidden = c!=='TEACHING'; });
      const first=$('#af-first'), last=$('#af-last'), email=$('#af-email');
      const syncEmail=()=>{ if(!email.dataset.touched && first.value.trim() && last.value.trim()) email.value = slugEmail(first.value, last.value); };
      first.addEventListener('input',syncEmail); last.addEventListener('input',syncEmail);
      email.addEventListener('input',()=>{ email.dataset.touched='1'; });

      const build=()=>{
        const v=id=>($('#'+id)?.value||'').trim();
        document.querySelectorAll('.err').forEach(e=>e.textContent='');
        const errs={};
        if(!v('af-first')) errs['e-affirst']='Enter the first name.';
        if(!v('af-last')) errs['e-aflast']='Enter the surname.';
        const em=v('af-email').toLowerCase();
        if(!em) errs['e-afemail']='Enter a sign-in email.';
        else if(!/^[a-z0-9.]+@fadesrek\.edu\.ng$/.test(em)) errs['e-afemail']='Use a @fadesrek.edu.ng address.';
        else if(db.accounts.some(x=>x.email===em && x.status!=='REJECTED') || AUTH_USERS.some(u=>u.username===em)) errs['e-afemail']='That email already has an account.';
        const ph=v('af-phone');
        if(!ph) errs['e-afphone']='Enter a phone number.';
        else if(!/^0[789][01]\d{8}$/.test(ph)) errs['e-afphone']='Use an 11-digit Nigerian number.';
        const cat=v('af-cat');
        if(cat==='TEACHING' && !v('af-trcn')) errs['e-aftrcn']='Teaching staff must carry a TRCN licence number.';
        if(Object.keys(errs).length){ for(const [k,m] of Object.entries(errs)){ const n=$('#'+k); if(n) n.textContent=m; } return null; }
        return {
          id:uid('acc'), staffId:null, firstName:v('af-first'), lastName:v('af-last'),
          email:em, phone:ph, category:cat, roleKey:v('af-role'),
          department:v('af-dept'), trcn: cat==='TEACHING' ? v('af-trcn') : null,
          subjectIds: cat==='TEACHING' ? [...document.querySelectorAll('.af-subj:checked')].map(c=>c.value) : [],
          status:'PENDING', credential:null, note:v('af-note'),
          requestedBy:creatorName, requestedByRole:state.role, requestedAt:new Date().toISOString(),
          decidedBy:null, decidedByRole:null, decidedAt:null, decisionNote:'',
        };
      };

      $('#af-save').addEventListener('click',()=>{
        const rec=build(); if(!rec) return;
        db.accounts.unshift(rec);
        logAudit('accounts.create', `${rec.firstName} ${rec.lastName} requested as ${accountRoleLabel(rec.roleKey)} (${rec.email})`);
        notify('SUPER_ADMIN','Account awaiting approval',`${rec.firstName} ${rec.lastName} — ${accountRoleLabel(rec.roleKey)}, raised by ${creatorName}.`);
        persist(); closeModal(); state.acctTab='pending'; render();
        toast(`<b>${esc(rec.firstName)} ${esc(rec.lastName)}</b> submitted for approval.`);
      });
      const approveBtn=$('#af-approve');
      if(approveBtn) approveBtn.addEventListener('click',()=>{
        const rec=build(); if(!rec) return;
        db.accounts.unshift(rec);
        logAudit('accounts.create', `${rec.firstName} ${rec.lastName} created as ${accountRoleLabel(rec.roleKey)} (${rec.email})`);
        persist(); closeModal(); state.acctTab='pending'; render();
        approveAccount(rec.id);
      });
    },
  });
}

/** New hire with no existing HR row — approval creates a minimal but valid
    staff record (payslip defaults, blank banking) so the person shows up in
    Staff and Payroll straight away, to be completed there. */
function createStaffFromAccount(a){
  const staffNo = `FA/STF/${String(db.staff.length+1).padStart(3,'0')}`;
  const m = {
    id:uid('sf'), staffNo, status:'ACTIVE',
    firstName:a.firstName, lastName:a.lastName, gender:'M',
    position:accountRoleLabel(a.roleKey), department:a.department||'Administration',
    phone:a.phone, trcn:a.trcn||null,
    gradeId: a.category==='TEACHING' ? 'g5' : 'g6',
    bank:BANKS[0], accountNo:'0000000000', pfa:PFAS[0], annualRent:0,
  };
  db.staff.push(m);
  logAudit('staff.create', `${m.firstName} ${m.lastName} added as ${m.position} (${staffNo}) via account approval`);
  return m.id;
}

function approveAccount(id){
  const a = (db.accounts||[]).find(x=>x.id===id);
  if(!a || a.status!=='PENDING') return;
  if(!canApproveAccounts()){ toast('Only the Super Administrator can approve accounts.', true); return; }
  let cred = tempPassword();

  modal({
    title:'Approve account', sub:`${a.firstName} ${a.lastName} · ${accountRoleLabel(a.roleKey)}`,
    body:`
      <dl class="kv">
        <dt>Sign-in email</dt><dd style="font-family:var(--mono);font-size:12px">${esc(a.email)}</dd>
        <dt>Role</dt><dd>${esc(accountRoleLabel(a.roleKey))} · ${a.category==='TEACHING'?'Teaching':'Administrative'}</dd>
        <dt>Department</dt><dd>${esc(a.department||'—')}</dd>
        ${a.category==='TEACHING'?`<dt>TRCN</dt><dd>${a.trcn?esc(a.trcn):'<span style="color:var(--muted)">—</span>'}</dd>`:''}
        <dt>HR record</dt><dd>${a.staffId?esc(db.staff.find(s=>s.id===a.staffId)?.staffNo||'linked'):'will be created on approval'}</dd>
      </dl>
      <div class="f" style="margin-top:14px"><label>Temporary password</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="ap-cred" value="${esc(cred)}" style="font-family:var(--mono)">
          <button class="btn btn-q btn-s" id="ap-regen" type="button">Regenerate</button>
        </div>
      </div>
      <p class="note">Approving issues the sign-in credential${a.staffId?'':' and an HR staff record'}, and adds the account to the login screen. The holder should change this password on first sign-in.</p>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="ap-go">Approve &amp; provision</button>`,
    wire(){
      $('#ap-regen').addEventListener('click',()=>{ cred=tempPassword(); $('#ap-cred').value=cred; });
      $('#ap-go').addEventListener('click',()=>{
        a.status='ACTIVE';
        a.credential = ($('#ap-cred').value||'').trim() || cred;
        a.decidedBy = ROLES[state.role].name; a.decidedByRole = state.role;
        a.decidedAt = new Date().toISOString(); a.decisionNote = '';
        if(!a.staffId) a.staffId = createStaffFromAccount(a);
        provisionLogin(a);
        if(typeof buildAuthScreen==='function') buildAuthScreen();
        logAudit('accounts.approve', `${a.firstName} ${a.lastName} approved as ${accountRoleLabel(a.roleKey)} (${a.email})`);
        notify(a.roleKey, 'Account approved', `A ${accountRoleLabel(a.roleKey)} account for ${a.firstName} ${a.lastName} is now active.`);
        if(a.requestedByRole && a.requestedByRole!=='SUPER_ADMIN') notify(a.requestedByRole, 'Account request approved', `${a.firstName} ${a.lastName}'s account was approved.`);
        persist(); closeModal(); render();
        showCredentialModal(a);
      });
    },
  });
}

function showCredentialModal(a){
  modal({
    title:'Account provisioned', sub:`${a.firstName} ${a.lastName}`,
    body:`<dl class="kv">
      <dt>Sign-in email</dt><dd style="font-family:var(--mono);font-size:12px">${esc(a.email)}</dd>
      <dt>Temporary password</dt><dd style="font-family:var(--mono);font-size:12px">${esc(a.credential)}</dd>
      <dt>Role</dt><dd>${esc(accountRoleLabel(a.roleKey))}</dd>
    </dl>
    <p class="note">This account is now on the sign-in screen's list. Pass the credentials to the holder over a secure channel — they will not be shown in full again.</p>`,
    foot:`<button class="btn btn-q" data-close>Close</button><button class="btn btn-p" id="cred-copy">Copy credentials</button>`,
    wire(){
      $('#cred-copy').addEventListener('click',()=>{
        const text = `${a.email}\n${a.credential}`;
        const done = () => toast('Credentials copied.');
        const fail = () => toast('Copy failed — select the text manually.', true);
        try { (navigator.clipboard && navigator.clipboard.writeText(text) || Promise.reject()).then(done, fail); }
        catch(e){ fail(); }
      });
    },
  });
}

function rejectAccount(id){
  const a = (db.accounts||[]).find(x=>x.id===id);
  if(!a || a.status!=='PENDING') return;
  if(!canApproveAccounts()){ toast('Only the Super Administrator can reject accounts.', true); return; }
  modal({
    title:'Reject request', sub:`${a.firstName} ${a.lastName} · ${accountRoleLabel(a.roleKey)}`,
    body:`<div class="f wide"><label class="req">Reason</label><textarea id="rj-note" rows="3" placeholder="Recorded on the request and sent to whoever raised it."></textarea><div class="err" id="e-rjnote"></div></div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-d" id="rj-go">Reject request</button>`,
    wire(){
      $('#rj-go').addEventListener('click',()=>{
        const note=($('#rj-note').value||'').trim();
        if(!note){ $('#e-rjnote').textContent='Give a reason so the request can be resubmitted correctly.'; return; }
        a.status='REJECTED'; a.decisionNote=note;
        a.decidedBy=ROLES[state.role].name; a.decidedByRole=state.role; a.decidedAt=new Date().toISOString();
        logAudit('accounts.reject', `${a.firstName} ${a.lastName} (${a.email}) rejected: ${note}`);
        if(a.requestedByRole && a.requestedByRole!=='SUPER_ADMIN') notify(a.requestedByRole,'Account request rejected',`${a.firstName} ${a.lastName}: ${note}`);
        persist(); closeModal(); render();
        toast(`Request for ${esc(a.firstName)} ${esc(a.lastName)} rejected.`);
      });
    },
  });
}

function setAccountStatus(id, status){
  const a = (db.accounts||[]).find(x=>x.id===id);
  if(!a) return;
  if(!canApproveAccounts()){ toast('Only the Super Administrator can change an account\'s status.', true); return; }
  a.status = status;
  if(status==='SUSPENDED') deprovisionLogin(a.email);
  if(status==='ACTIVE' && a.credential){ provisionLogin(a); if(typeof buildAuthScreen==='function') buildAuthScreen(); }
  logAudit('accounts.'+(status==='SUSPENDED'?'suspend':'reactivate'), `${a.firstName} ${a.lastName} (${a.email})`);
  persist(); closeModal(); render();
  toast(`${esc(a.firstName)} ${esc(a.lastName)} ${status==='SUSPENDED'?'suspended':'reactivated'}.`);
}

function openAccountProfile(id){
  const a = (db.accounts||[]).find(x=>x.id===id);
  if(!a) return;
  const subjects = (a.subjectIds||[]).map(sid=>{ const s=SUBJECTS.find(x=>x.id===sid); return s?s.name:null; }).filter(Boolean);
  const canApprove = canApproveAccounts();
  const staff = a.staffId ? db.staff.find(s=>s.id===a.staffId) : null;

  modal({
    title:`${a.firstName} ${a.lastName}`,
    sub:`${accountRoleLabel(a.roleKey)} · ${a.category==='TEACHING'?'Teaching staff':'Administrative staff'}`,
    wide:true,
    body:`
      <div class="fgrid" style="align-items:start">
        <dl class="kv">
          <dt>Status</dt><dd><span class="pill ${ACCT_STATUS_PILL[a.status]}">${a.status}</span></dd>
          <dt>Sign-in email</dt><dd style="font-family:var(--mono);font-size:12px">${esc(a.email)}</dd>
          <dt>Phone</dt><dd style="font-family:var(--mono);font-size:12px">${esc(a.phone)}</dd>
          <dt>Department</dt><dd>${esc(a.department||'—')}</dd>
          ${a.category==='TEACHING'?`<dt>TRCN licence</dt><dd>${a.trcn?esc(a.trcn):'<span style="color:var(--muted)">—</span>'}</dd>
          <dt>Subjects</dt><dd>${subjects.length?subjects.map(s=>`<span class="pill p-info">${esc(s)}</span>`).join(' '):'<span style="color:var(--muted)">—</span>'}</dd>`:''}
          ${staff?`<dt>HR record</dt><dd><a href="#" id="ap-staff">${esc(staff.staffNo)}</a></dd>`:''}
        </dl>
        <dl class="kv">
          <dt>Raised by</dt><dd>${esc(a.requestedBy)}${a.requestedByRole?` · ${esc(ROLES[a.requestedByRole]?.title||a.requestedByRole)}`:''}</dd>
          <dt>Raised</dt><dd>${fmtDateTime(a.requestedAt)}</dd>
          ${a.decidedAt?`<dt>Decision</dt><dd>${a.status==='REJECTED'?'Rejected':'Approved'} by ${esc(a.decidedBy||'—')}</dd>
          <dt>Decided</dt><dd>${fmtDateTime(a.decidedAt)}</dd>`:''}
          ${a.decisionNote?`<dt>Note</dt><dd>${esc(a.decisionNote)}</dd>`:''}
          ${a.status==='ACTIVE'&&a.credential&&canApprove?`<dt>Temp password</dt><dd style="font-family:var(--mono);font-size:12px">${esc(a.credential)}</dd>`:''}
          ${a.status==='ACTIVE'&&!a.credential?`<dt>Sign-in</dt><dd style="color:var(--muted)">Provisioned via the staff register</dd>`:''}
        </dl>
      </div>
      ${a.note?`<p class="note"><b>Request note.</b> ${esc(a.note)}</p>`:''}`,
    foot:`<button class="btn btn-q" data-close>Close</button>
      ${a.status==='PENDING'&&canApprove?`<button class="btn btn-d" id="ap-reject">Reject</button><button class="btn btn-p" id="ap-approve">Approve</button>`:''}
      ${a.status==='ACTIVE'&&canApprove?`<button class="btn btn-d" id="ap-suspend">Suspend</button>`:''}
      ${a.status==='SUSPENDED'&&canApprove?`<button class="btn btn-p" id="ap-reactivate">Reactivate</button>`:''}
      ${a.status==='REJECTED'&&canApprove?`<button class="btn btn-q" id="ap-requeue">Move back to pending</button>`:''}`,
    wire(){
      const s=$('#ap-staff'); if(s) s.addEventListener('click',e=>{ e.preventDefault(); closeModal(); openStaffProfile(a.staffId); });
      const ap=$('#ap-approve'); if(ap) ap.addEventListener('click',()=>{ closeModal(); approveAccount(a.id); });
      const rj=$('#ap-reject'); if(rj) rj.addEventListener('click',()=>{ closeModal(); rejectAccount(a.id); });
      const su=$('#ap-suspend'); if(su) su.addEventListener('click',()=>setAccountStatus(a.id,'SUSPENDED'));
      const re=$('#ap-reactivate'); if(re) re.addEventListener('click',()=>setAccountStatus(a.id,'ACTIVE'));
      const rq=$('#ap-requeue'); if(rq) rq.addEventListener('click',()=>{
        a.status='PENDING'; a.decidedAt=null; a.decidedBy=null; a.decidedByRole=null; a.decisionNote='';
        persist(); closeModal(); render(); toast('Request moved back to pending.');
      });
    },
  });
}

// ----------------------------------------------------------------- reports --

// -------------------------------------------------------- real reporting ---
// Reporting & Analytics — like the portal, this is real backend data, cached
// and re-rendered the same way (render() is synchronous, so a fetch needs
// somewhere to land before the page can show it). Every other route stays
// on the mock db exactly as before.

const reportsCache = { data:null, loading:false, error:false };
function invalidateReportsCache(){ reportsCache.data = null; reportsCache.error = false; }

async function loadReportsData(){
  if(reportsCache.loading) return;
  reportsCache.loading = true; reportsCache.error = false;
  try{
    // fees-summary/academic-report 400 with no current term set — caught
    // individually so one missing term doesn't blank the whole dashboard.
    const [enrollment, fees, attendance, academic, inventory, hr, revenueTrend] = await Promise.all([
      apiGet('/api/reports/enrollment-summary'),
      apiGet('/api/reports/fees-summary').catch(()=>null),
      apiGet('/api/reports/attendance-summary'),
      apiGet('/api/reports/academic-report').catch(()=>null),
      apiGet('/api/reports/inventory-report'),
      apiGet('/api/reports/hr-report'),
      apiGet('/api/reports/revenue-trend'),
    ]);
    reportsCache.data = { enrollment, fees, attendance, academic, inventory, hr, revenueTrend };
  } catch(e){ reportsCache.error = true; }
  finally{ reportsCache.loading = false; if(state.route==='reports') render(); }
}

/** Minimal hand-rolled bar chart — no charting library, the same raw-inline-
    SVG approach already used for icons (see ICONS/svg()). */
function svgBarChart(items, {width=600, height=180, valueKey='value', labelKey='label', color='var(--accent)'}={}){
  if(!items.length) return '<p class="sub">No data yet.</p>';
  const max = Math.max(1, ...items.map(i=>i[valueKey]));
  const barW = width/items.length, pad = barW*0.2, innerW = barW-pad*2;
  const bars = items.map((it,i)=>{
    const h = Math.max(1, Math.round((it[valueKey]/max)*(height-30)));
    const x = i*barW+pad, y = height-24-h;
    return `<g>
      <rect x="${x}" y="${y}" width="${innerW}" height="${h}" rx="3" fill="${color}"></rect>
      <text x="${x+innerW/2}" y="${height-8}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(String(it[labelKey]).slice(0,9))}</text>
      <text x="${x+innerW/2}" y="${y-4}" text-anchor="middle" font-size="9" fill="var(--ink)">${Math.round(it[valueKey])}</text>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${bars}</svg>`;
}

/** Minimal hand-rolled line/sparkline chart, same rationale as the bar
    chart above. */
function svgLineChart(items, {width=600, height=140, valueKey='value', labelKey='label', color='var(--accent)'}={}){
  if(items.length<2) return '<p class="sub">Not enough data yet for a trend.</p>';
  const max = Math.max(1, ...items.map(i=>i[valueKey])), min = Math.min(0, ...items.map(i=>i[valueKey]));
  const stepX = width/(items.length-1);
  const scaleY = v => height-24 - ((v-min)/((max-min)||1))*(height-40);
  const points = items.map((it,i)=>`${i*stepX},${scaleY(it[valueKey])}`).join(' ');
  const dots = items.map((it,i)=>`<circle cx="${i*stepX}" cy="${scaleY(it[valueKey])}" r="3" fill="${color}"></circle>`).join('');
  const labels = items.map((it,i)=>`<text x="${i*stepX}" y="${height-6}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(String(it[labelKey]))}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"></polyline>${dots}${labels}
  </svg>`;
}

function exportLinks(report){
  const fmt = (f,label) => `<a class="btn btn-q btn-s" href="${AI_API}/api/reports/${report}/export?format=${f}" target="_blank" rel="noopener">${label}</a>`;
  return `<div style="display:flex;gap:6px">${fmt('csv','CSV')}${fmt('xlsx','Excel')}${fmt('pdf','PDF')}</div>`;
}

PAGES.reports = () => {
  if(reportsCache.error){
    return `<div class="empty"><b>Couldn't load reports</b>Check that the backend (npm run dev:server) is running, then <a href="#" id="rep-retry">try again</a>.</div>`;
  }
  if(!reportsCache.data){
    loadReportsData();
    return `<div class="empty"><b>Loading reports…</b>Fetching real numbers from the school's records.</div>`;
  }
  const { enrollment, fees, attendance, academic, inventory, hr, revenueTrend } = reportsCache.data;

  return `
  <div class="phead"><div><h1>Reports</h1>
    <p>Computed live from Postgres, not from cached summaries — every figure below can be traced to the rows behind it. Export any table as CSV, Excel or PDF.</p></div></div>

  ${academic?`<div class="block">
    <h2>Class performance <small>${esc(academic.term)}</small></h2>
    ${svgBarChart(academic.rows.map(r=>({label:r.class, value:r.average})))}
    <div class="tw"><table>
      <thead><tr><th>Class</th><th class="num">Students</th><th class="num">Average</th><th class="num">Passing (≥50)</th><th class="num">Pass rate</th></tr></thead>
      <tbody>${academic.rows.map(r=>`<tr>
        <td>${esc(r.class)}</td><td class="num">${r.count}</td>
        <td class="num" style="font-weight:600">${r.average}</td>
        <td class="num">${r.passing}</td><td class="num">${r.passRate}%</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="margin-top:10px">${exportLinks('academic')}</div>
  </div>

  <div class="block">
    <h2>Subject performance <small>ranked by average</small></h2>
    ${svgBarChart(academic.subjectPerformance.slice(0,10).map(r=>({label:r.name, value:r.average})))}
    <div class="tw"><table>
      <thead><tr><th>Subject</th><th class="num">Entries</th><th class="num">Average</th><th class="num">Pass rate</th><th>Grade</th></tr></thead>
      <tbody>${academic.subjectPerformance.map(r=>`<tr>
        <td>${esc(r.name)} <span style="font-family:var(--mono);font-size:10px;color:var(--muted)">${esc(r.code)}</span></td>
        <td class="num">${r.entries}</td><td class="num" style="font-weight:600">${r.average}</td>
        <td class="num">${r.passRate}%</td>
        <td><span class="pill ${r.average>=55?'p-ok':r.average>=45?'p-warn':'p-bad'}">${gradeOf(r.average).g}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`:'<div class="block"><p class="sub">No current academic term is set — class and subject performance need one.</p></div>'}

  <div class="block">
    <h2>Revenue trend <small>monthly payments received</small></h2>
    ${svgLineChart(revenueTrend.rows.map(r=>({label:r.month.slice(2), value:r.totalNaira})))}
    <div style="margin-top:10px">${exportLinks('revenue-trend')}</div>
  </div>

  <div class="grid-bottom">
    <section class="block">
      <h2>Fees ${fees?`<small>${esc(fees.term)}</small>`:''}</h2>
      ${fees?`<div class="grid-stats">
        <div class="stat"><div style="flex:1"><div class="v">${nairaAmount(fees.invoicedNaira)}</div><div class="l">Invoiced</div></div></div>
        <div class="stat"><div style="flex:1"><div class="v">${nairaAmount(fees.paidNaira)}</div><div class="l">Collected</div></div></div>
        <div class="stat"><div style="flex:1"><div class="v" style="color:${fees.outstandingNaira>0?'var(--clay)':'var(--moss)'}">${nairaAmount(fees.outstandingNaira)}</div><div class="l">Outstanding</div></div></div>
      </div>`:'<p class="sub">No current term set.</p>'}
      <div style="margin-top:10px">${exportLinks('fees')}</div>
    </section>

    <section class="block">
      <h2>Attendance <small>${esc(attendance.date)}</small></h2>
      <div class="grid-stats">
        <div class="stat"><div style="flex:1"><div class="v">${attendance.registersMarked}/${attendance.registersTotal}</div><div class="l">Registers marked</div></div></div>
        <div class="stat"><div style="flex:1"><div class="v">${attendance.byMark.PRESENT||0}</div><div class="l">Present</div></div></div>
        <div class="stat"><div style="flex:1"><div class="v">${attendance.byMark.ABSENT||0}</div><div class="l">Absent</div></div></div>
      </div>
      <div style="margin-top:10px">${exportLinks('attendance')}</div>
    </section>
  </div>

  <div class="block">
    <h2>Inventory <small>${inventory.belowReorderCount} item${inventory.belowReorderCount===1?'':'s'} below reorder level</small></h2>
    <div class="tw"><table>
      <thead><tr><th>Item</th><th>Category</th><th class="num">Quantity</th><th class="num">Reorder level</th><th></th></tr></thead>
      <tbody>${inventory.rows.slice(0,15).map(r=>`<tr>
        <td>${esc(r.name)}</td><td>${esc(r.category)}</td><td class="num">${r.quantity}</td><td class="num">${r.reorderLevel}</td>
        <td>${r.belowReorder==='Yes'?'<span class="pill p-bad">LOW STOCK</span>':''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="margin-top:10px">${exportLinks('inventory')}</div>
  </div>

  <div class="block">
    <h2>HR <small>${hr.staffCount} staff</small></h2>
    ${svgBarChart(hr.rows.map(r=>({label:r.department, value:r.headcount})))}
    <div class="tw"><table><thead><tr><th>Department</th><th class="num">Headcount</th></tr></thead>
      <tbody>${hr.rows.map(r=>`<tr><td>${esc(r.department)}</td><td class="num">${r.headcount}</td></tr>`).join('')}</tbody>
    </table></div>
    <div style="margin-top:10px">${exportLinks('hr')}</div>
  </div>

  <div class="grid-stats">
    <div class="stat">${svg('sStudents',40)}<div><div class="v">${enrollment.byGender.MALE||0}/${enrollment.byGender.FEMALE||0}</div><div class="l">Male / female</div></div></div>
    <div class="stat">${svg('hostel',40)}<div><div class="v">${enrollment.boarders}</div><div class="l">Boarders</div></div></div>
    <div class="stat">${svg('sPending',40)}<div><div class="v">${enrollment.total}</div><div class="l">Total students</div></div></div>
    <div class="stat">${svg('notice',40)}<div><div class="v">${enrollment.byLifecycleStatus.ENROLLED||0}</div><div class="l">Currently enrolled</div></div></div>
  </div>
  <div style="margin-top:10px">${exportLinks('enrollment')}</div>`;
};

PAGES.reports_wire = () => {
  const retry = $('#rep-retry');
  if(retry) retry.addEventListener('click', e=>{ e.preventDefault(); invalidateReportsCache(); render(); });
};

// --------------------------------------------------------------- audit log --
/* Every entry here is written at the same call site that mutates the record
   and calls persist() — an audit line and the change it describes can never
   drift apart, because nothing writes one without the other. A real backend
   would generate this from request middleware instead of call-site by
   call-site, but the guarantee it has to meet is the same one. */

/* Rendered as a tab inside the Admin Panel (PAGES.accounts). */
function auditBody(){
  const q = (state.auditQuery||'').toLowerCase();
  const rows = db.auditLog.filter(a =>
    !q || a.action.toLowerCase().includes(q) || a.detail.toLowerCase().includes(q) || a.actor.toLowerCase().includes(q));

  return `
  <div class="toolbar">
    <input type="text" class="search" id="audit-q" placeholder="Filter by action, actor or detail" value="${esc(state.auditQuery||'')}">
    <span class="spacer"></span>
    <span style="font-size:12px;color:var(--muted)">${rows.length} of ${db.auditLog.length}</span>
  </div>
  <div class="tw"><table>
    <thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>${rows.length ? rows.map(a=>`<tr>
      <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${fmtDateTime(a.at)}</td>
      <td>${esc(a.actor)}</td>
      <td><span class="pill p-mute">${esc(a.role)}</span></td>
      <td style="font-family:var(--mono);font-size:11px">${esc(a.action)}</td>
      <td>${esc(a.detail)}</td>
    </tr>`).join('') : `<tr><td colspan="5"><div class="empty"><b>No events yet</b>Create, edit or approve something elsewhere in the system and it will appear here.</div></td></tr>`}
    </tbody>
  </table></div>`;
}

// ------------------------------------------------------------------- files --
/* Stored as data URLs, same as photos — fine for a demo, wrong for
   production. A real deployment swaps readGenericFile()'s FileReader for an
   upload to object storage and keeps only the returned URL; nothing in
   PAGES.files or the audit trail would need to change, because both already
   treat dataUrl as an opaque link a browser can open. */

const MAX_FILE_MB = 5;
const FILE_CATEGORIES = ['Admissions','Academics','Finance','HR','Policy','Other'];

function readGenericFile(file){
  return new Promise((resolve, reject) => {
    if(!file) return reject(new Error('Choose a file.'));
    if(file.size > MAX_FILE_MB*1024*1024)
      return reject(new Error(`That file is ${(file.size/1048576).toFixed(1)}MB. The limit is ${MAX_FILE_MB}MB.`));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

/** Data URLs are ~4/3 the size of the original bytes (base64 overhead) — this
    undoes that to show the size a person actually picked. */
function fileSizeLabel(dataUrl){
  const bytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
  return bytes > 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB`;
}

PAGES.files = () => {
  const q = (state.filesQuery||'').toLowerCase();
  const rows = db.files.filter(f => !q || f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));

  return `
  <div class="phead">
    <div><h1>Files</h1><p>${db.files.length} document${db.files.length===1?'':'s'} on record — admission letters, policies, circulars, anything that belongs to the school rather than to one screen.</p></div>
    ${can('files.create')?'<button class="btn btn-y" id="upload-file">Upload file</button>':''}
  </div>
  <div class="toolbar">
    <input type="text" class="search" id="files-q" placeholder="Search name or category" value="${esc(state.filesQuery||'')}">
    <span class="spacer"></span>
    <span style="font-size:12px;color:var(--muted)">${rows.length} of ${db.files.length}</span>
  </div>
  <div class="tw"><table>
    <thead><tr><th>Name</th><th>Category</th><th>Uploaded by</th><th>Date</th><th class="num">Size</th><th></th></tr></thead>
    <tbody>${rows.length ? rows.map(f=>`<tr>
      <td>${esc(f.name)}</td>
      <td><span class="pill p-info">${esc(f.category)}</span></td>
      <td>${esc(f.uploadedBy)}</td>
      <td style="font-family:var(--mono);font-size:11px">${fmtDate(f.at)}</td>
      <td class="num" style="font-family:var(--mono);font-size:11.5px">${f.size}</td>
      <td style="display:flex;gap:6px;justify-content:flex-end">
        <a class="btn btn-q btn-s" href="${f.dataUrl}" download="${esc(f.name)}">Download</a>
        ${can('files.delete')?`<button class="btn btn-d btn-s" data-file-del="${f.id}">Delete</button>`:''}
      </td>
    </tr>`).join('') : `<tr><td colspan="6"><div class="empty"><b>No files yet</b>${can('files.create')?'Upload the first document to get started.':'Nothing has been shared here yet.'}</div></td></tr>`}
    </tbody>
  </table></div>`;
};

PAGES.files_wire = () => {
  const q = $('#files-q');
  if(q) q.addEventListener('input', e=>{
    state.filesQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const n = $('#files-q'); if(n){ n.focus(); n.setSelectionRange(pos,pos); }
  });
  const up = $('#upload-file');
  if(up) up.addEventListener('click', ()=>openFileUpload());
  document.querySelectorAll('[data-file-del]').forEach(b=>b.addEventListener('click', ()=>{
    const f = db.files.find(x=>x.id===b.dataset.fileDel);
    if(!f) return;
    db.files = db.files.filter(x=>x.id!==f.id);
    logAudit('files.delete', `${f.name} deleted`);
    persist();
    toast(`${esc(f.name)} deleted.`);
    render();
  }));
};

function openFileUpload(){
  modal({
    title:'Upload file', sub:`Up to ${MAX_FILE_MB}MB.`,
    body:`<div class="fgrid">
      <div class="f wide"><label class="req">File</label><input type="file" id="fl-file"><div class="err" id="e-flfile"></div></div>
      <div class="f"><label>Category</label><select id="fl-cat">${FILE_CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div>
    </div>`,
    foot:`<button class="btn btn-q" data-close>Cancel</button><button class="btn btn-p" id="fl-save">Upload</button>`,
    wire(){
      $('#fl-save').addEventListener('click', async ()=>{
        const err = $('#e-flfile'); err.textContent='';
        const file = $('#fl-file').files[0];
        try{
          const dataUrl = await readGenericFile(file);
          const rec = {id:uid('fl'), name:file.name, category:$('#fl-cat').value,
            uploadedBy:ROLES[state.role].name, at:todayISO(), dataUrl, size:fileSizeLabel(dataUrl)};
          db.files.unshift(rec);
          logAudit('files.upload', `${rec.name} uploaded (${rec.category})`);
          persist(); closeModal();
          toast(`<b>${esc(rec.name)}</b> uploaded.`);
          render();
        } catch(ex){
          err.textContent = ex.message;
        }
      });
    },
  });
}

// ------------------------------------------------------------------ modal ---

function modal({title, sub, body, foot, wide, wire}){
  const root = $('#modal-root');
  root.innerHTML = `<div class="scrim" id="scrim"><div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="mhead"><div><h2>${esc(title)}</h2>${sub?`<p>${sub}</p>`:''}</div><button class="mx" data-close aria-label="Close">×</button></div>
    <div class="mbody">${body}</div>
    ${foot?`<div class="mfoot">${foot}</div>`:''}
  </div></div>`;

  root.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  $('#scrim').addEventListener('mousedown',e=>{ if(e.target.id==='scrim') closeModal(); });
  document.addEventListener('keydown', escClose);
  paintCrests();
  if(wire) wire();
  wirePhotoPickers(()=>{ closeModal(); render(); });
  const first = root.querySelector('input,select,textarea,button:not([data-close])');
  if(first) first.focus();
}
function escClose(e){ if(e.key==='Escape') closeModal(); }
function closeModal(){
  // A test left open in a closed modal must not keep ticking in the background.
  if(typeof cbtTimer !== 'undefined') clearInterval(cbtTimer);
  // A camera left open in a closed modal is a live recording device pointed
  // at nothing — the stream must die with the dialog, not linger until the tab closes.
  if(bioCameraStream){ bioCameraStream.getTracks().forEach(t=>t.stop()); bioCameraStream = null; }
  $('#modal-root').innerHTML='';
  document.removeEventListener('keydown', escClose);
}

// -------------------------------------------------------------- persistence -

let saveTimer = null;
function persist(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    await Store.set('fadesrek:db', {
      students:db.students, staff:db.staff, applications:db.applications,
      attendance:db.attendance, staffAttendance:db.staffAttendance, scores:db.scores, payments:db.payments,
      notices:db.notices, ledger:db.ledger, biometrics:db.biometrics,
      feeItems:db.feeItems, scholarships:db.scholarships, discounts:db.discounts, installmentPlans:db.installmentPlans,
      income:db.income, expenses:db.expenses, budgets:db.budgets, reconciledRefs:db.reconciledRefs,
      books:db.books, borrowings:db.borrowings, reservations:db.reservations,
      routes:db.routes, transportAlloc:db.transportAlloc, vehicles:db.vehicles, drivers:db.drivers,
      maintenanceLogs:db.maintenanceLogs, fuelLogs:db.fuelLogs,
      items:db.items, movements:db.movements, suppliers:db.suppliers, purchaseOrders:db.purchaseOrders,
      messages:db.messages, messageThreads:db.messageThreads, emergencyAlerts:db.emergencyAlerts,
      pages:db.pages, posts:db.posts, events:db.events, gallery:db.gallery, mediaLibrary:db.mediaLibrary,
      testimonials:db.testimonials, enquiries:db.enquiries,
      auditLog:db.auditLog, notifications:db.notifications, files:db.files, accounts:db.accounts,
    });
  }, 400);
}

/** The student role is a real enrolment, not a stub — SELF scope has to point
    at a record with marks, fees and a timetable, or the portal proves nothing. */
function bindStudentRole(){
  const me = db.students.find(s=>s.id===ROLES.PARENT.childIds?.[0])
          || db.students.find(s=>s.classId==='c3');
  if(!me) return;
  ROLES.STUDENT.studentId = me.id;
  ROLES.STUDENT.name  = `${me.firstName} ${me.lastName}`;
  ROLES.STUDENT.title = `Student · ${className(CLASSES.find(c=>c.id===me.classId))}`;
}

/** Builds the login card once and wires its submit handler once. Shown and
    hidden afterwards by toggling display — rebuilding it on every sign-out
    would mean re-wiring the listener each time too. */
function buildAuthScreen(){
  $('#auth-screen').innerHTML = `<div class="auth-card">
    <button class="icon-btn auth-theme-btn" id="auth-theme-toggle" type="button" data-theme-toggle aria-label="Toggle dark mode"></button>
    <div class="crest" data-crest="48"></div>
    <h1>Fadesrek Academy</h1>
    <p class="sub">Sign in to the school management system</p>
    <form id="auth-form">
      <div class="f"><label>Account</label>
        <select id="au-user">${AUTH_USERS.map(u=>`<option value="${esc(u.username)}">${esc(ROLES[u.role].title)} — ${esc(u.username)}</option>`).join('')}</select>
      </div>
      <div class="f"><label>Password</label><input type="password" id="au-pass" autocomplete="current-password"></div>
      <div class="err" id="au-err"></div>
      <button type="submit" class="btn btn-p" style="width:100%">Sign in</button>
    </form>
    <p class="hint">Demo environment — every account signs in with the password <code>fadesrek2026</code>.</p>
  </div>`;
  paintCrests();
  Theme.apply(Theme.current);
  $('#auth-theme-toggle').addEventListener('click', () => Theme.toggle());
  $('#auth-form').addEventListener('submit', async e=>{
    e.preventDefault();
    const ok = await Auth.login($('#au-user').value, $('#au-pass').value);
    if(!ok){ $('#au-err').textContent = 'Incorrect password for that account.'; return; }
    enterApp(Auth.session.role);
  });
}

function showAuthScreen(){
  const p = $('#au-pass'); if(p) p.value = '';
  const err = $('#au-err'); if(err) err.textContent = '';
  $('.app').style.display = 'none';
  $('#auth-screen').style.display = 'flex';
  if(p) p.focus();
}

/** Portal roles open on their portal, not an admin dashboard they'd have to
    find their way out of. Same rule the old role switcher used. */
function enterApp(role){
  state.role = role;
  const r = ROLES[role];
  state.route = (r.scope==='OWN_RECORDS' || r.scope==='SELF') ? 'portal' : 'dashboard';
  $('#auth-screen').style.display = 'none';
  $('.app').style.display = 'grid';
  // A fresh account needs a fresh API session — a stale cookie, leftover
  // conversation, or cached portal data from whoever was signed in before
  // has no business here.
  apiState.loggedIn = false; aiState.conversationId = null; aiState.messages = [];
  invalidatePortalCache(); invalidateReportsCache();
  render();
}

async function boot(){
  await Theme.init();
  $('#theme-toggle').addEventListener('click', () => Theme.toggle());
  $('#notif-bell').addEventListener('click', () => openNotifications());
  $('#ai-assistant-btn').addEventListener('click', () => openAssistant());
  $('#sign-out').addEventListener('click', async () => {
    await Auth.logout();
    if(apiState.loggedIn){ try{ await fetch(`${AI_API}/api/auth/logout`, {method:'POST', credentials:'include', headers:csrfHeader()}); } catch(e){} }
    apiState.loggedIn = false; aiState.conversationId = null; aiState.messages = [];
    invalidatePortalCache(); invalidateReportsCache();
    showAuthScreen();
  });
  seed();
  bindStudentRole();
  await loadPhotos();
  const saved = await Store.get('fadesrek:db');
  if(saved && saved.students && saved.students.length){
    Object.assign(db, saved);
    // childIds are derived, not stored — rebuild them against the loaded data.
    const kids = db.students.filter(s=>s.guardian==='Ibrahim Musa').slice(0,2);
    if(kids.length) ROLES.PARENT.childIds = kids.map(k=>k.id);
    bindStudentRole();
  }
  // Accounts approved through the Admin Panel in an earlier session carry
  // their own credential — re-add them to AUTH_USERS so they can still sign in.
  (db.accounts||[]).forEach(provisionLogin);
  buildAuthScreen();
  await Auth.init();
  if(Auth.session) enterApp(Auth.session.role);
  else showAuthScreen();
  if(Store.backed) toast('Records will persist between visits.');
}

boot();
