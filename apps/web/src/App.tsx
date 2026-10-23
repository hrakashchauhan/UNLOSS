import {useEffect, useRef, useState} from 'react';
import {Link, Navigate, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {Bell, ChevronRight, ClipboardList, FileBarChart2, LayoutDashboard, LogOut, Menu, RotateCcw, Settings, Shield, Truck, User, Users, Wallet, X} from 'lucide-react';
import {ErrorBox, errText, pretty} from './ui/common';
import {OrdersPage} from './features/orders/Orders';
import {Dashboard, RewardsPage, NotificationsPage, ReportsPage} from './features/reports/Reporting';
import {PartnerDemo, DemoHome} from './features/demo/PartnerDemo';
import {SettingsPage} from './features/settings/Settings';
import {PublicFlow} from './features/public/PublicFlow';
import {DeliveryDashboard} from './features/delivery/DeliveryDashboard';
import {CustomerDashboard} from './features/customer/CustomerDashboard';
import {AdminDashboard} from './features/admin/AdminDashboard';
import {AuthProvider, LoginRoute, RequireRole, RequireSeller, useAuth} from './features/auth/Auth';
import {DEMO_ENABLED} from './config';
import {LiveIndicator} from './ui/LiveIndicator';

export function App(){
 return <Routes>
  <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
  <Route path="/delivery/:token" element={<PublicRoute kind="delivery"/>}/>
  <Route path="/customer/:token" element={<PublicRoute kind="customer"/>}/>
  {DEMO_ENABLED && <><Route path="/demo" element={<DemoHome/>}/>
  <Route path="/demo/partners" element={<PartnerDemo/>}/>
  <Route path="/demo/delivery" element={<PublicFlow key="demo-delivery" kind="delivery" token="" demo/>}/>
  <Route path="/demo/customer" element={<PublicFlow key="demo-customer" kind="customer" token="" demo/>}/></>}
  <Route element={<AuthProvider/>}>
   <Route path="/login" element={<LoginRoute/>}/>
   {/* Delivery Person Dashboard */}
   <Route element={<RequireRole allowedRoles={['DELIVERY']}/>}>
    <Route path="/delivery-portal" element={<DeliveryDashboard/>}/>
   </Route>
   {/* Customer Dashboard */}
   <Route element={<RequireRole allowedRoles={['CUSTOMER']}/>}>
    <Route path="/customer-portal" element={<CustomerDashboard/>}/>
   </Route>
   {/* Administrator Dashboard */}
   <Route element={<RequireRole allowedRoles={['ADMIN']}/>}>
    <Route path="/admin" element={<AdminDashboard/>}/>
   </Route>
   {/* Seller Dashboard & Subroutes */}
   <Route element={<RequireSeller/>}>
    <Route path="/dashboard" element={<SellerApp/>}/>
    <Route path="/orders" element={<SellerApp/>}/>
    <Route path="/orders/new" element={<SellerApp/>}/>
    <Route path="/orders/:id" element={<SellerApp/>}/>
    <Route path="/rewards" element={<SellerApp/>}/>
    <Route path="/notifications" element={<SellerApp/>}/>
    <Route path="/reports" element={<SellerApp/>}/>
    <Route path="/returns" element={<SellerApp/>}/>
    <Route path="/partners" element={<SellerApp/>}/>
    <Route path="/settings" element={<SellerApp/>}/>
   </Route>
  </Route>
  <Route path="*" element={<div className="recovery-screen"><h1>Page not found</h1><p>This UNLOSS page does not exist.</p><Link className="button primary" to="/dashboard">Go to dashboard</Link></div>}/>
 </Routes>;
}

function PublicRoute({kind}:{kind:'delivery'|'customer'}){const {token=''}=useParams();return <PublicFlow key={kind+token} kind={kind} token={token}/>}

function SellerApp(){
 const location=useLocation();
 const menuButton=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null),navigation=useRef<HTMLElement>(null);
 const {seller,mode,signOut,switchRole}=useAuth();
 const [mobileNav,setMobileNav]=useState(false),[signOutBusy,setSignOutBusy]=useState(false),[signOutError,setSignOutError]=useState('');
 useEffect(()=>{
  if(!mobileNav)return;
  closeButton.current?.focus();
  const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){setMobileNav(false);menuButton.current?.focus()}
   if(event.key==='Tab'){
    const controls=navigation.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)');
    const first=controls?.[0],last=controls?.[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  };
  window.addEventListener('keydown',onKeyDown);return()=>{window.removeEventListener('keydown',onKeyDown);document.body.style.overflow=previousOverflow};
 },[mobileNav]);
 useEffect(()=>{document.title=`${pretty(location.pathname.split('/')[1]||'dashboard')} · UNLOSS`;document.getElementById('main-content')?.focus()},[location.pathname]);
 useEffect(()=>{
  if(!window.matchMedia)return;
  const desktop=window.matchMedia('(min-width: 761px)');
  const closeOnDesktop=()=>{if(desktop.matches)setMobileNav(false)};
  desktop.addEventListener('change',closeOnDesktop);return()=>desktop.removeEventListener('change',closeOnDesktop);
 },[]);
 async function handleSignOut(){if(signOutBusy)return;setSignOutBusy(true);setSignOutError('');try{await signOut()}catch(error){setSignOutError(errText(error))}finally{setSignOutBusy(false)}}
 if(!seller)return null;
 const current=location.pathname.split('/').filter(Boolean); const section=current[0]||'dashboard';
 const nav=[['dashboard','Overview',LayoutDashboard],['orders','Orders',ClipboardList],['returns','Returns',RotateCcw],['partners','Partners',Users],['rewards','Rewards',Wallet],['notifications','Notifications',Bell],['reports','Reports',FileBarChart2],['settings','Settings',Settings]] as const;
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to main content</a>
   <aside ref={navigation} className={`sidebar ${mobileNav?'open':''}`} aria-label="Workspace navigation"><div className="brand"><div className="brand-mark">u</div><span>unloss<span className="brand-dot">.</span></span><button ref={closeButton} className="icon-btn mobile-close" aria-label="Close navigation" onClick={()=>{setMobileNav(false);menuButton.current?.focus()}}><X size={18}/></button></div><div className="workspace-label">SELLER WORKSPACE</div><nav aria-label="Main navigation">{nav.map(([id,label,Icon])=><Link key={id} to={`/${id}`} onClick={()=>setMobileNav(false)} aria-current={section===id?'page':undefined} className={`nav-link ${section===id?'active':''}`}><Icon size={18}/><span>{label}</span></Link>)}</nav><div className="sidebar-bottom"><div className="user-card"><div className="avatar">{seller.name?.slice(0,1)||'S'}</div><div className="user-info"><b>{seller.name}</b><small>{seller.email}</small></div><button className="icon-btn" aria-label={signOutBusy?"Signing out":"Sign out"} title="Sign out" disabled={signOutBusy} onClick={handleSignOut}><LogOut size={16}/></button></div></div></aside>
  {mobileNav&&<button aria-label="Close navigation" className="nav-scrim" onClick={()=>{setMobileNav(false);menuButton.current?.focus()}}/>}
   <main className="main-area" id="main-content" tabIndex={-1} inert={mobileNav}><header className="topbar"><button ref={menuButton} className="icon-btn mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="crumb">Workspace <ChevronRight size={14}/><b>{pretty(section)}</b></div>
   <div className="top-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><LiveIndicator />
     {mode==='demo' && (
       <div style={{ display: 'flex', gap: '4px' }}>
         <button className="button" style={{ minHeight: '30px', fontSize: '.78rem', padding: '2px 8px' }} title="Switch to Delivery Person" onClick={() => switchRole('DELIVERY')}>
           <Truck size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />Delivery
         </button>
         <button className="button" style={{ minHeight: '30px', fontSize: '.78rem', padding: '2px 8px' }} title="Switch to Customer" onClick={() => switchRole('CUSTOMER')}>
           <User size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />Customer
         </button>
         <button className="button" style={{ minHeight: '30px', fontSize: '.78rem', padding: '2px 8px' }} title="Switch to Admin" onClick={() => switchRole('ADMIN')}>
           <Shield size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />Admin
         </button>
       </div>
     )}
     <Link className="icon-btn" aria-label="Notifications" title="Notifications" to="/notifications"><Bell size={18}/></Link>
     <div className="avatar small" aria-hidden="true">{seller.name?.slice(0,1)||'S'}</div>
   </div></header>
   <div className="page-wrap">{mode==='demo'&&<p className="demo-banner">DATABASE-BACKED LOCAL DEMO · Records persist here. Test OTP only; no SMS, official partner identity, courier integration, or payout.</p>}{signOutError&&<ErrorBox message={signOutError}/>} {section==='returns'?<OrdersPage returns/>:section==='partners'?<PartnerDemo embedded/>:section==='settings'?<SettingsPage/>:section==='orders'?<OrdersPage id={current[1]}/>:section==='rewards'?<RewardsPage/>:section==='notifications'?<NotificationsPage/>:section==='reports'?<ReportsPage/>:<Dashboard/>}</div><footer className="footer"><span>© {new Date().getFullYear()} UNLOSS</span><span>Seller delivery records · Manual and demo activity is labelled in event history.</span></footer></main>
 </div>
}
