import type {CSSProperties} from 'react';
export function Icon({name,size=20,className='',style}:{name:string;size?:number;className?:string;style?:CSSProperties}) {
 const paths:Record<string,React.ReactNode>={
  route:<><circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h7a4 4 0 0 1 0 8h-4a3 3 0 0 0 0 6h7"/></>,
  pin:<><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  swap:<><path d="M7 4v16m-4-4 4 4 4-4M17 20V4m-4 4 4-4 4 4"/></>,
  bus:<><rect x="3" y="4" width="18" height="15" rx="4"/><path d="M3 12h18M7 4v8m10-8v8M7 19v2m10-2v2M7 16h1m8 0h1"/></>,
  seat:<><path d="M7 3h8a2 2 0 0 1 2 2v8H5V5a2 2 0 0 1 2-2Zm-2 10v5h14v-7M6 18v3m12-3v3"/></>,
  shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
  chevron:<path d="m6 9 6 6 6-6"/>,check:<path d="m5 12 4 4L19 6"/>,
  menu:<path d="M4 6h16M4 12h16M4 18h16"/>,close:<path d="m6 6 12 12M18 6 6 18"/>,
  users:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4m1-17a3 3 0 0 1 0 6m3 3a6 6 0 0 1 2 4v4"/></>,
  lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  warning:<><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/></>,
  lab:<><path d="M9 3h6m-5 0v7L4 20h16l-6-10V3M7 15h10"/></>,
  back:<path d="M20 12H4m6-6-6 6 6 6"/>,refresh:<><path d="M20 4v6h-6M4 20v-6h6"/><path d="M19 10a7 7 0 0 0-12-5L4 8m1 6a7 7 0 0 0 12 5l3-3"/></>
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{paths[name]??paths.info}</svg>;
}
